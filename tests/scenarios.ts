/**
 * End-to-end multiplayer scenarios against a real server over real WebSockets.
 * Covers the 17 testing requirements from the specification.
 *
 *   npm run test:e2e
 */
import { io as connect, type Socket } from 'socket.io-client'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer } from '../src/server/index'
import type { CmdResult, PublicState, TeamCode } from '../src/shared/types'
import { TEAM_CODES } from '../src/shared/types'
import { minNextBid } from '../src/shared/rules'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iplwr-'))
const DB = path.join(tmp, 'test.db')
let srv = createServer({ dbFile: DB })
let port = 0
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let passed = 0
const results: string[] = []

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg)
}

async function listen() {
  await new Promise<void>((r) => srv.server.listen(port, () => r()))
  port = (srv.server.address() as { port: number }).port
}
const base = () => `http://localhost:${port}`
async function post(p: string, body: unknown) {
  const r = await fetch(base() + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: r.status, json: (await r.json()) as Record<string, string> }
}

class Client {
  socket!: Socket
  state: PublicState | null = null
  gate: { status: string } | null = null
  notices: string[] = []
  constructor(public name: string, public code: string, public token: string, public memberId: string) {}
  async connect() {
    this.state = null
    this.socket = connect(base(), { auth: { code: this.code, token: this.token }, transports: ['websocket'], forceNew: true, reconnection: false })
    this.socket.on('state', (s: PublicState) => (this.state = s))
    this.socket.on('gate', (g: { status: string }) => (this.gate = g))
    this.socket.on('notice', (n: { text: string }) => this.notices.push(n.text))
    await new Promise<void>((res, rej) => {
      this.socket.once('connect', () => res())
      this.socket.once('connect_error', rej)
    })
  }
  cmd(type: string, payload: Record<string, unknown> = {}): Promise<CmdResult> {
    return new Promise((r) => this.socket.emit('cmd', { type, ...payload }, r))
  }
  async ok(type: string, payload: Record<string, unknown> = {}) {
    const r = await this.cmd(type, payload)
    assert(r.ok, `${this.name} ${type} failed: ${!r.ok && r.error}`)
    await sleep(40)
    return r
  }
  async until(pred: (s: PublicState) => boolean, ms = 4000) {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (this.state && pred(this.state)) return this.state
      await sleep(25)
    }
    throw new Error(`${this.name}: condition not met in ${ms}ms`)
  }
  close() {
    this.socket.close()
  }
}

async function scenario(n: number, title: string, fn: () => Promise<void>) {
  const t = Date.now()
  try {
    await fn()
    passed++
    results.push(`  ✔ ${String(n).padStart(2)}. ${title} (${Date.now() - t}ms)`)
  } catch (e) {
    results.push(`  ✘ ${String(n).padStart(2)}. ${title}\n      ${(e as Error).message}`)
  }
}

async function main() {
  await listen()
  const created = await post('/api/rooms', { roomName: 'Friends League', hostName: 'Adi', password: 'secret1' })
  const code = created.json.code
  const host = new Client('host', code, created.json.token, created.json.memberId)
  await host.connect()
  await host.until((s) => !!s.you?.isHost)
  await host.ok('claimTeam', { team: 'MI' })
  const clients: Record<TeamCode, Client> = { MI: host } as Record<TeamCode, Client>
  const pid = (short: string) => {
    // ids are slugs of the Cricsheet short name
    return short.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  }
  let roundTwoUnsold = ''
  const totals = (s: PublicState) => TEAM_CODES.reduce((n, c) => n + s.teams[c].purse + s.teams[c].spent, 0)

  await scenario(1, 'All 10 franchises join the same room', async () => {
    const wrong = await post(`/api/rooms/${code}/join`, { name: 'Intruder', password: 'nope' })
    assert(wrong.status === 403, 'wrong password must be rejected')
    for (const t of TEAM_CODES.slice(1)) {
      const j = await post(`/api/rooms/${code}/join`, { name: `Owner ${t}`, password: 'secret1' })
      assert(j.status === 200, 'join ok')
      const c = new Client(t, code, j.json.token, j.json.memberId)
      await c.connect()
      await sleep(30)
      assert(c.gate?.status === 'pending', 'joiner waits for approval')
      await host.ok('approveMember', { memberId: c.memberId })
      await c.until((s) => s.members[c.memberId].status === 'approved')
      await c.ok('claimTeam', { team: t })
      clients[t] = c
    }
    const s = await host.until((s) => Object.values(s.members).filter((m) => m.teamIds.length).length === 10)
    assert(s.online.length === 10, `10 online, got ${s.online.length}`)
    // an 11th owner cannot take a franchise; spectator via invite link works without password
    const inv = (await host.cmd('getInvite')) as { ok: true; data: { inviteKey: string } }
    const spec = await post(`/api/rooms/${code}/join`, { name: 'Spectator', role: 'spectator', invite: inv.data.inviteKey })
    assert(spec.status === 200, 'spectator joins via invite')
    const extra = await post(`/api/rooms/${code}/join`, { name: 'Eleventh', password: 'secret1' })
    const r = await host.cmd('approveMember', { memberId: extra.json.memberId })
    assert(!r.ok && /10 franchise/.test(r.error), '11th owner refused')
    await host.ok('approveMember', { memberId: spec.json.memberId, role: 'spectator' })
  })

  await host.ok('updateConfig', { patch: { pools: ['current', 'legend'], maxSquad: 4, minSquad: 0, maxOverseas: 1, timerSeconds: 4, bidTimerSeconds: 3, reservePurseForMinSquad: false } })
  await host.ok('startAuction')

  await scenario(2, 'Two participants bid simultaneously', async () => {
    await host.ok('nominate', { playerId: pid('V Kohli') })
    const s = await host.until((s) => s.current?.playerId === pid('V Kohli'))
    const lotKey = s.current!.lotKey
    const amount = s.lots[pid('V Kohli')].basePrice
    const [a, b] = await Promise.all([clients.CSK.cmd('bid', { team: 'CSK', amount, lotKey }), clients.RCB.cmd('bid', { team: 'RCB', amount, lotKey })])
    assert([a, b].filter((r) => r.ok).length === 1, 'exactly one of two identical bids is accepted')
    const loser = a.ok ? b : a
    assert(!loser.ok && /Outbid/.test(loser.error), 'loser told they were outbid')
    const st = await host.until((s) => s.current?.bids.length === 1)
    assert(st.current!.high!.amount === amount, 'single high bid')
  })

  await scenario(5, 'The timer expires during bidding', async () => {
    const s = await host.until((s) => s.current === null && s.lots[pid('V Kohli')].status === 'sold', 6000)
    const winner = s.lots[pid('V Kohli')].soldTo!
    assert(s.teams[winner].squad.some((e) => e.playerId === pid('V Kohli')), 'player in winning squad')
    assert(s.teams[winner].purse === 12000 - s.lots[pid('V Kohli')].soldPrice!, 'purse deducted')
    assert(totals(s) === 120000, 'money conserved')
  })

  await scenario(3, 'A participant attempts to exceed their budget', async () => {
    await host.ok('nominate', { playerId: pid('RG Sharma') })
    const s = await host.until((s) => s.current?.playerId === pid('RG Sharma'))
    const r = await clients.KKR.cmd('bid', { team: 'KKR', amount: 12001, lotKey: s.current!.lotKey })
    assert(!r.ok && /remaining/.test(r.error), `budget rejection, got ${!r.ok && r.error}`)
    // also try forging a bid for another team
    const forged = await clients.KKR.cmd('bid', { team: 'DC', amount: 500, lotKey: s.current!.lotKey })
    assert(!forged.ok && /do not control/.test(forged.error), 'cannot bid for another franchise')
    await clients.KKR.ok('bid', { team: 'KKR', amount: s.lots[pid('RG Sharma')].basePrice, lotKey: s.current!.lotKey })
    await host.ok('hammer')
    await host.until((s) => s.lots[pid('RG Sharma')].status === 'sold')
  })

  await scenario(4, 'A team attempts to exceed its overseas limit', async () => {
    await host.ok('nominate', { playerId: pid('JC Buttler') })
    let s = await host.until((s) => s.current?.playerId === pid('JC Buttler'))
    await clients.GT.ok('bid', { team: 'GT', amount: s.lots[pid('JC Buttler')].basePrice, lotKey: s.current!.lotKey })
    await host.ok('hammer')
    await host.ok('nominate', { playerId: pid('TM Head') })
    s = await host.until((s) => s.current?.playerId === pid('TM Head'))
    const r = await clients.GT.cmd('bid', { team: 'GT', amount: s.lots[pid('TM Head')].basePrice, lotKey: s.current!.lotKey })
    assert(!r.ok && /overseas/.test(r.error), 'overseas limit enforced')
    await host.ok('markUnsold')
  })

  await scenario(6, 'A participant disconnects and reconnects', async () => {
    await host.ok('nominate', { playerId: pid('JJ Bumrah') })
    let s = await host.until((s) => s.current?.playerId === pid('JJ Bumrah'))
    await clients.DC.ok('bid', { team: 'DC', amount: s.lots[pid('JJ Bumrah')].basePrice, lotKey: s.current!.lotKey })
    clients.DC.close()
    s = await host.until((s) => !s.online.includes(clients.DC.memberId))
    assert(s.current?.high?.team === 'DC', 'bid by disconnected participant still stands')
    await clients.DC.connect()
    const back = await clients.DC.until((s) => s.online.includes(clients.DC.memberId))
    assert(back.current?.playerId === pid('JJ Bumrah') && back.current.high?.team === 'DC', 'reconnected client sees live state')
    await host.ok('pause')
  })

  await scenario(7, 'The host transfers control during active bidding', async () => {
    await host.ok('resume')
    let s = await host.until((s) => !s.paused)
    const before = { lot: s.current!.lotKey, high: s.current!.high, deadline: s.current!.deadline, teams: JSON.stringify(s.teams) }
    await host.ok('requestHostTransfer', { memberId: clients.RCB.memberId })
    await clients.RCB.ok('respondHostTransfer', { accept: true })
    s = await host.until((s) => s.hostId === clients.RCB.memberId)
    assert(s.current?.lotKey === before.lot, 'same lot')
    assert(JSON.stringify(s.current?.high) === JSON.stringify(before.high), 'same high bid')
    assert(s.current?.deadline === before.deadline, 'timer continues unchanged')
    assert(JSON.stringify(s.teams) === before.teams, 'purses and squads unchanged')
    const old = await host.cmd('hammer')
    assert(!old.ok, 'old host lost controls')
    await clients.RCB.ok('hammer')
    await host.until((s) => s.lots[pid('JJ Bumrah')].status === 'sold')
    // transfer back for the rest of the run
    await clients.RCB.ok('requestHostTransfer', { memberId: host.memberId })
    await host.ok('respondHostTransfer', { accept: true })
  })

  await scenario(17, 'A browser refresh occurs during active bidding', async () => {
    await host.ok('nominate', { playerId: pid('SA Yadav') })
    const s = await host.until((s) => s.current?.playerId === pid('SA Yadav'))
    await clients.SRH.ok('bid', { team: 'SRH', amount: s.lots[pid('SA Yadav')].basePrice, lotKey: s.current!.lotKey })
    // "refresh": drop the socket and reconnect with the same stored token
    clients.SRH.close()
    await clients.SRH.connect()
    const after = await clients.SRH.until((x) => x.current?.playerId === pid('SA Yadav'))
    assert(after.current!.high?.team === 'SRH', 'bid survives refresh')
    const next = minNextBid(after.current!.high!.amount, after.lots[pid('SA Yadav')].basePrice, after.config.increments)
    await clients.LSG.ok('bid', { team: 'LSG', amount: next, lotKey: after.current!.lotKey })
    // full server restart mid-lot: state reloaded from SQLite, timer re-armed
    for (const c of Object.values(clients)) c.close()
    for (const r of srv.mgr.rooms.values()) r.shutdown()
    await new Promise((r) => srv.server.close(() => r(null)))
    srv.store.db.close()
    srv = createServer({ dbFile: DB })
    await listen()
    for (const c of Object.values(clients)) await c.connect()
    const restored = await host.until((x) => x.current?.playerId === pid('SA Yadav'))
    assert(restored.current!.high?.team === 'LSG' && restored.current!.high.amount === next, 'live lot restored after server restart')
    await host.ok('hammer')
    await host.until((x) => x.lots[pid('SA Yadav')].soldTo === 'LSG')
  })

  await scenario(14, 'A team reaches its maximum squad size', async () => {
    for (const p of ['HH Pandya', 'RA Jadeja', 'KL Rahul', 'Shubman Gill']) {
      await host.ok('nominate', { playerId: pid(p) })
      const s = await host.until((s) => s.current?.playerId === pid(p))
      await clients.PBKS.ok('bid', { team: 'PBKS', amount: s.lots[pid(p)].basePrice, lotKey: s.current!.lotKey })
      await host.ok('hammer')
      await host.until((s) => s.current === null)
    }
    await host.ok('nominate', { playerId: pid('RR Pant') })
    const s = await host.until((s) => s.current?.playerId === pid('RR Pant'))
    assert(s.teams.PBKS.squad.length === 4, 'PBKS has 4 (max)')
    const r = await clients.PBKS.cmd('bid', { team: 'PBKS', amount: 500, lotKey: s.current!.lotKey })
    assert(!r.ok && /squad is full/.test(r.error), 'full squad cannot bid')
    await host.ok('markUnsold')
  })

  await scenario(10, 'A player trade is completed during the auction', async () => {
    let s = host.state!
    const kohliTeam = s.lots[pid('V Kohli')].soldTo!
    const other: TeamCode = kohliTeam === 'CSK' ? 'RCB' : 'CSK'
    // live lot running while trading
    await host.ok('nominate', { playerId: pid('MA Starc') })
    s = await host.until((s) => s.current?.playerId === pid('MA Starc'))
    const lotKey = s.current!.lotKey
    await clients[kohliTeam].ok('proposeTrade', { from: kohliTeam, to: other, give: { players: [pid('V Kohli')] }, receive: { players: [], cash: 300 } })
    const tid = Object.values(clients[other].state!.trades).find((t) => t.status === 'pending')!.id
    const purseOther = s.teams[other].purse
    await clients[other].ok('respondTrade', { tradeId: tid, accept: true })
    s = await host.until((s) => s.trades[tid]?.status === 'completed')
    assert(s.teams[other].squad.some((e) => e.playerId === pid('V Kohli')), 'player moved')
    assert(s.teams[other].purse === purseOther - 300, 'cash moved')
    assert(s.current?.lotKey === lotKey, 'live lot unaffected')
    assert(totals(s) === 120000, 'money conserved across trade')
    await host.ok('markUnsold')
  })

  await scenario(11, 'A trade is rejected', async () => {
    const s = host.state!
    const from = s.lots[pid('RG Sharma')].soldTo!
    const to = s.lots[pid('SA Yadav')].soldTo!
    await clients[from].ok('proposeTrade', { from, to, give: { players: [pid('RG Sharma')] }, receive: { players: [pid('SA Yadav')] } })
    const tid = Object.values(clients[to].state!.trades).find((t) => t.status === 'pending')!.id
    await clients[to].ok('respondTrade', { tradeId: tid, accept: false })
    const after = await host.until((s) => s.trades[tid].status === 'rejected')
    assert(after.teams[from].squad.some((e) => e.playerId === pid('RG Sharma')), 'nothing moved')
  })

  await scenario(16, 'Two participants attempt to trade the same player simultaneously', async () => {
    const s = host.state!
    const owner = s.lots[pid('RG Sharma')].soldTo!
    const sky = s.lots[pid('SA Yadav')].soldTo!
    const bum = s.lots[pid('JJ Bumrah')].soldTo!
    const [a, b] = await Promise.all([
      clients[sky].cmd('proposeTrade', { from: sky, to: owner, give: { players: [pid('SA Yadav')] }, receive: { players: [pid('RG Sharma')] } }),
      clients[bum].cmd('proposeTrade', { from: bum, to: owner, give: { players: [pid('JJ Bumrah')] }, receive: { players: [pid('RG Sharma')] } }),
    ])
    assert([a, b].filter((r) => r.ok).length === 1, 'only one pending trade may include the same player')
    const loser = a.ok ? b : a
    assert(!loser.ok && /another pending trade/.test(loser.error), 'clear conflict error')
    await sleep(60)
    const open = Object.values(host.state!.trades).find((t) => t.status === 'pending')!
    await clients[open.from].ok('cancelTrade', { tradeId: open.id })
  })

  await scenario(12, 'A counteroffer is accepted', async () => {
    const s = host.state!
    const a = s.lots[pid('RG Sharma')].soldTo!
    const b = s.lots[pid('JJ Bumrah')].soldTo!
    await clients[a].ok('proposeTrade', { from: a, to: b, give: { players: [pid('RG Sharma')] }, receive: { players: [pid('JJ Bumrah')] } })
    const t1 = Object.values(clients[b].state!.trades).find((t) => t.status === 'pending')!.id
    await clients[b].ok('counterTrade', { tradeId: t1, give: { players: [pid('JJ Bumrah')] }, receive: { players: [pid('RG Sharma')], cash: 100 } })
    const st = await host.until((s) => s.trades[t1].status === 'countered')
    const t2 = Object.values(st.trades).find((t) => t.parentId === t1)!.id
    const pa = st.teams[a].purse
    await clients[a].ok('respondTrade', { tradeId: t2, accept: true })
    const done = await host.until((s) => s.trades[t2].status === 'completed')
    assert(done.teams[a].squad.some((e) => e.playerId === pid('JJ Bumrah')), 'counter executed')
    assert(done.teams[a].purse === pa - 100, 'counter cash applied')
  })

  await scenario(8, 'An unsold round is initiated', async () => {
    // drain remaining queue by skipping, then run the unsold round
    await host.ok('skipRemaining')
    const before = host.state!
    const unsold = Object.values(before.lots).filter((l) => l.status === 'unsold' || l.status === 'skipped')
    assert(unsold.length > 10, 'have unsold players')
    const lots = Object.keys(before.lots).length
    await host.ok('startUnsoldRound', { playerIds: [pid('RR Pant'), pid('TM Head'), pid('MA Starc')] })
    const s = await host.until((s) => s.round === 2)
    assert(s.queue.length === 3 && Object.keys(s.lots).length === lots, 'no duplicate lots')
    await host.ok('nominate')
    const cur = await host.until((s) => !!s.current)
    assert(cur.lots[cur.current!.playerId].attempts.length === 1, 'previous attempt preserved')
    await clients.CSK.ok('bid', { team: 'CSK', amount: cur.lots[cur.current!.playerId].basePrice, lotKey: cur.current!.lotKey })
    await host.ok('hammer')
    await host.ok('nominate')
    const second = await host.until((s) => !!s.current)
    roundTwoUnsold = second.current!.playerId
    await host.ok('markUnsold')
    await host.ok('skip', { playerId: host.state!.queue[0] })
  })

  await scenario(9, 'A second unsold round is initiated', async () => {
    await host.ok('startUnsoldRound', {})
    const s = await host.until((s) => s.round === 3)
    assert(s.queue.length > 0, 'queue populated')
    await host.ok('nominate', { playerId: roundTwoUnsold })
    const cur = await host.until((s) => s.current?.playerId === roundTwoUnsold)
    const lot = cur.lots[cur.current!.playerId]
    assert(lot.round === 3, 'round 3 recorded')
    await host.ok('markUnsold')
    const after = await host.until((s) => !s.current)
    const hist = after.lots[lot.playerId].attempts
    assert(hist.length === 3 && hist.map((h) => h.round).join() === '1,2,3', `attempt history across rounds: ${hist.map((h) => h.round + h.result).join()}`)
    if (after.queue.length) await host.ok('skipRemaining')
    await host.ok('endAuction')
    await host.until((s) => s.phase === 'completed')
  })

  await scenario(13, 'A post-auction trade is completed', async () => {
    const s = host.state!
    const a = s.lots[pid('SA Yadav')].soldTo!
    const b = s.lots[pid('JC Buttler')].soldTo!
    await clients[a].ok('proposeTrade', { from: a, to: b, give: { players: [pid('SA Yadav')], cash: 50 }, receive: { players: [pid('JC Buttler')] } })
    const tid = Object.values(clients[b].state!.trades).find((t) => t.status === 'pending')!.id
    await clients[b].ok('respondTrade', { tradeId: tid, accept: true })
    const done = await host.until((s) => s.trades[tid].status === 'completed')
    assert(done.trades[tid].phaseAtProposal === 'completed', 'post-auction trade')
    assert(done.teams[a].squad.some((e) => e.playerId === pid('JC Buttler')), 'moved')
  })

  await scenario(15, 'The host reopens a completed auction', async () => {
    await host.ok('reopenAuction')
    const s = await host.until((s) => s.phase === 'live')
    const unsoldId = Object.values(s.lots).find((l) => l.status === 'unsold')!.playerId
    await host.ok('recall', { playerId: unsoldId })
    await host.ok('nominate')
    const cur = await host.until((s) => s.current?.playerId === unsoldId)
    await clients.KKR.ok('bid', { team: 'KKR', amount: cur.lots[unsoldId].basePrice, lotKey: cur.current!.lotKey })
    await host.ok('hammer')
    const done = await host.until((s) => s.lots[unsoldId].status === 'sold')
    assert(done.lots[unsoldId].soldTo === 'KKR', 'sold after reopening')
    await host.ok('endAuction')
  })

  // Global integrity check
  await scenario(0, 'Final consistency: money, ownership and history agree', async () => {
    const s = host.state!
    const owners = new Map<string, string>()
    for (const c of TEAM_CODES)
      for (const e of s.teams[c].squad) {
        assert(!owners.has(e.playerId), `player ${e.playerId} owned twice`)
        owners.set(e.playerId, c)
      }
    for (const l of Object.values(s.lots)) if (l.status === 'sold') assert(owners.get(l.playerId) === l.soldTo, `lot ${l.playerId} soldTo matches squad`)
    const spent = TEAM_CODES.reduce((n, c) => n + s.teams[c].spent, 0)
    const sold = Object.values(s.lots).filter((l) => l.status === 'sold').reduce((n, l) => n + (l.soldPrice ?? 0), 0)
    assert(spent === sold, `spent ${spent} equals sum of sale prices ${sold}`)
    const purse = TEAM_CODES.reduce((n, c) => n + s.teams[c].purse, 0)
    assert(purse + spent === 120000, `total purse + spent conserved (${purse + spent})`)
    const hist = await new Promise<{ ok: boolean; data: { type: string }[] }>((r) => host.socket.emit('history', { limit: 5000 }, r))
    const types = new Set(hist.data.map((e) => e.type))
    for (const t of ['bid', 'sold', 'unsold', 'host_changed', 'paused', 'resumed', 'trade_completed', 'trade_rejected', 'unsold_round_started', 'auction_reopened'])
      assert(types.has(t), `history has ${t}`)
    const csv = await fetch(`${base()}/api/rooms/${code}/export/results.csv?token=${host.token}`)
    assert(csv.status === 200 && (await csv.text()).includes('Virat Kohli'), 'host can export results')
    const denied = await fetch(`${base()}/api/rooms/${code}/export/results.csv?token=${clients.CSK.token}`)
    assert(denied.status === 403, 'non-host cannot export')
  })

  for (const c of Object.values(clients)) c.close()
  for (const r of srv.mgr.rooms.values()) r.shutdown()
  srv.server.close()
  console.log('\nIPL Auction War Room — multiplayer scenarios')
  console.log(results.sort((a, b) => parseInt(a.slice(4)) - parseInt(b.slice(4))).join('\n'))
  console.log(`\n${passed}/${results.length} passed`)
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(passed === results.length ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
