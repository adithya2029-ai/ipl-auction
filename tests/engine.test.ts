import { describe, expect, it, beforeEach } from 'vitest'
import fs from 'node:fs'
import { applyCommand, createRoomState, CmdError, type Command } from '../src/server/engine'
import type { Player, RoomState, TeamCode } from '../src/shared/types'
import { TEAM_CODES } from '../src/shared/types'
import { minNextBid } from '../src/shared/rules'

const data = JSON.parse(fs.readFileSync('src/server/data/players.json', 'utf8')) as { players: Player[] }
const LIB = Object.fromEntries(data.players.map((p) => [p.id, p]))

let now = 1_000_000
let seq = 0
let s: RoomState

function run(actor: string | null, cmd: Command, opts: { hostOfflineSince?: number | null } = {}) {
  const draft = structuredClone(s)
  const res = applyCommand(draft, cmd, {
    now,
    actorId: actor,
    online: new Set(),
    hostOfflineSince: opts.hostOfflineSince ?? null,
    random: () => 0.42,
    id: () => `id${++seq}`,
  })
  s = draft
  return res
}
function fails(actor: string | null, cmd: Command, msg?: RegExp) {
  const before = JSON.stringify(s)
  let err: unknown
  try {
    run(actor, cmd)
  } catch (e) {
    err = e
  }
  expect(err, `expected ${cmd.type} to fail`).toBeInstanceOf(CmdError)
  if (msg) expect((err as Error).message).toMatch(msg)
  expect(JSON.stringify(s)).toBe(before) // nothing changed
}
const owner = (t: TeamCode) => `m-${t}`
const pid = (short: string) => data.players.find((p) => p.shortName === short)!.id
const team = (t: TeamCode) => s.teams[t]
const advance = (ms: number) => {
  now += ms
  run(null, { type: '__tick' })
}
const totalMoney = () => TEAM_CODES.reduce((n, c) => n + s.teams[c].purse + s.teams[c].spent, 0)

function setupRoom(cfg: Record<string, unknown> = {}) {
  now = 1_000_000
  s = createRoomState({
    code: 'TEST',
    name: 'Test',
    host: { id: owner('MI'), name: 'Host', role: 'owner', status: 'approved', teamIds: ['MI'], joinedAt: now, lastSeenAt: now },
    library: structuredClone(LIB),
    now,
  })
  for (const t of TEAM_CODES.slice(1)) {
    s.members[owner(t)] = { id: owner(t), name: t, role: 'owner', status: 'pending', teamIds: [], joinedAt: now, lastSeenAt: now }
    run(owner('MI'), { type: 'approveMember', memberId: owner(t), team: t })
  }
  run(owner('MI'), { type: 'updateConfig', patch: { pools: ['current', 'legend'], ...cfg } })
}
function start() {
  run(owner('MI'), { type: 'startAuction' })
}
function nominate(short?: string) {
  run(owner('MI'), { type: 'nominate', playerId: short ? pid(short) : undefined })
  return s.current!.lotKey
}
function bid(t: TeamCode, amount: number) {
  run(owner(t), { type: 'bid', team: t, amount, lotKey: s.current!.lotKey })
}

describe('rooms & members', () => {
  beforeEach(() => setupRoom())
  it('caps franchise owners at 10', () => {
    s.members.extra = { id: 'extra', name: 'X', role: 'owner', status: 'pending', teamIds: [], joinedAt: now, lastSeenAt: now }
    fails(owner('MI'), { type: 'approveMember', memberId: 'extra' }, /10 franchise/)
    run(owner('MI'), { type: 'approveMember', memberId: 'extra', role: 'spectator' })
    expect(s.members.extra.role).toBe('spectator')
  })
  it('only host can run host commands', () => {
    fails(owner('CSK'), { type: 'startAuction' }, /Only the host/)
  })
})

describe('bidding', () => {
  beforeEach(() => {
    setupRoom({ maxSquad: 3, minSquad: 0, maxOverseas: 1 })
    start()
  })
  it('validates and sells to highest bidder on timer expiry', () => {
    nominate('V Kohli')
    const base = s.lots[pid('V Kohli')].basePrice
    fails(owner('CSK'), { type: 'bid', team: 'CSK', amount: base - 5, lotKey: s.current!.lotKey }, /base price/)
    bid('CSK', base)
    fails(owner('CSK'), { type: 'bid', team: 'CSK', amount: base + 50, lotKey: s.current!.lotKey }, /already hold/)
    const next = () => minNextBid(s.current!.high!.amount, base, s.config.increments)
    bid('RCB', next())
    // simultaneous: CSK and KKR both saw the same price and both tried the next increment; the second is stale
    const contested = next()
    bid('CSK', contested)
    fails(owner('KKR'), { type: 'bid', team: 'KKR', amount: contested, lotKey: s.current!.lotKey }, /Outbid/)
    advance(30_000)
    expect(s.current).toBeNull()
    expect(s.lots[pid('V Kohli')].status).toBe('sold')
    expect(team('CSK').purse).toBe(12000 - contested)
    expect(team('CSK').squad.map((e) => e.playerId)).toContain(pid('V Kohli'))
    expect(totalMoney()).toBe(120000)
  })
  it('stale lot key is rejected after the lot closes (no duplicate sale)', () => {
    const key = nominate('V Kohli')
    bid('CSK', 200)
    advance(30_000)
    nominate('RG Sharma')
    fails(owner('RCB'), { type: 'bid', team: 'RCB', amount: 500, lotKey: key }, /closed/)
  })
  it('rejects bids beyond the purse', () => {
    nominate('V Kohli')
    fails(owner('CSK'), { type: 'bid', team: 'CSK', amount: 12001, lotKey: s.current!.lotKey }, /remaining/)
  })
  it('enforces the overseas limit', () => {
    nominate('JC Buttler')
    bid('CSK', 200)
    advance(30_000)
    nominate('TM Head')
    fails(owner('CSK'), { type: 'bid', team: 'CSK', amount: 200, lotKey: s.current!.lotKey }, /overseas/)
  })
  it('enforces maximum squad size', () => {
    for (const p of ['V Kohli', 'RG Sharma', 'JJ Bumrah']) {
      nominate(p)
      bid('CSK', s.lots[pid(p)].basePrice)
      advance(30_000)
    }
    expect(team('CSK').squad.length).toBe(3)
    nominate('SA Yadav')
    fails(owner('CSK'), { type: 'bid', team: 'CSK', amount: 500, lotKey: s.current!.lotKey }, /squad is full/)
  })
  it('timer resets after each bid and pause freezes it', () => {
    nominate('V Kohli')
    now += 15_000
    bid('CSK', 200)
    expect(s.current!.deadline).toBe(now + 12_000)
    run(owner('MI'), { type: 'pause' })
    fails(owner('RCB'), { type: 'bid', team: 'RCB', amount: 210, lotKey: s.current!.lotKey }, /paused/)
    advance(60_000)
    expect(s.current).not.toBeNull()
    run(owner('MI'), { type: 'resume' })
    expect(s.current!.deadline).toBe(now + 12_000)
  })
  it('no bids → unsold; unsold rounds preserve history without duplicates', () => {
    nominate('V Kohli')
    advance(30_000)
    expect(s.lots[pid('V Kohli')].status).toBe('unsold')
    while (s.queue.length) run(owner('MI'), { type: 'skip', playerId: s.queue[0] })
    run(owner('MI'), { type: 'startUnsoldRound' })
    expect(s.round).toBe(2)
    const n = Object.keys(s.lots).length
    nominate('V Kohli')
    advance(30_000)
    run(owner('MI'), { type: 'startUnsoldRound', playerIds: [pid('V Kohli')] })
    expect(s.round).toBe(3)
    nominate('V Kohli')
    bid('DC', 200)
    advance(30_000)
    expect(Object.keys(s.lots).length).toBe(n)
    expect(s.lots[pid('V Kohli')].attempts.map((x) => x.result)).toEqual(['unsold', 'unsold', 'sold'])
    expect(s.lots[pid('V Kohli')].attempts.map((x) => x.round)).toEqual([1, 2, 3])
  })
})

describe('host controls', () => {
  beforeEach(() => {
    setupRoom()
    start()
  })
  it('host transfer during bidding preserves everything', () => {
    nominate('V Kohli')
    bid('CSK', 200)
    const before = { current: structuredClone(s.current), teams: structuredClone(s.teams), ledger: s.ledger.length }
    run(owner('MI'), { type: 'requestHostTransfer', memberId: owner('RCB') })
    fails(owner('KKR'), { type: 'respondHostTransfer', accept: true })
    run(owner('RCB'), { type: 'respondHostTransfer', accept: true })
    expect(s.hostId).toBe(owner('RCB'))
    expect(s.current).toEqual(before.current)
    expect(s.teams).toEqual(before.teams)
    fails(owner('MI'), { type: 'hammer' }, /Only the host/)
    advance(30_000)
    expect(team('CSK').squad.length).toBe(1)
    expect(s.ledger.length).toBe(before.ledger + 1)
  })
  it('claim host only after host offline long enough', () => {
    expect(() => run(owner('CSK'), { type: 'claimHost' }, { hostOfflineSince: now - 10_000 })).toThrow(/claiming is allowed/)
    run(owner('CSK'), { type: 'claimHost' }, { hostOfflineSince: now - 61_000 })
    expect(s.hostId).toBe(owner('CSK'))
  })
  it('undo, revert and correct sale keep money consistent', () => {
    nominate('V Kohli')
    bid('CSK', 500)
    advance(30_000)
    run(owner('MI'), { type: 'correctSale', playerId: pid('V Kohli'), team: 'RCB', amount: 450 })
    expect(team('CSK').purse).toBe(12000)
    expect(team('RCB').purse).toBe(12000 - 450)
    run(owner('MI'), { type: 'undoLast' })
    expect(team('CSK').purse).toBe(11500)
    expect(team('RCB').purse).toBe(12000)
    run(owner('MI'), { type: 'undoLast' })
    expect(team('CSK').purse).toBe(12000)
    expect(s.queue[0]).toBe(pid('V Kohli'))
    expect(s.lots[pid('V Kohli')].status).toBe('pending')
    expect(totalMoney()).toBe(120000)
    fails(owner('MI'), { type: 'undoLast' }, /no transaction/)
  })
  it('complete and reopen', () => {
    fails(owner('MI'), { type: 'reopenAuction' })
    run(owner('MI'), { type: 'endAuction' })
    expect(s.phase).toBe('completed')
    fails(owner('MI'), { type: 'nominate' }, /not live/)
    run(owner('MI'), { type: 'reopenAuction' })
    nominate()
    expect(s.current).not.toBeNull()
  })
  it('locks unsafe settings after start', () => {
    fails(owner('MI'), { type: 'updateConfig', patch: { startingPurse: 20000 } }, /locked/)
    run(owner('MI'), { type: 'updateConfig', patch: { timerSeconds: 30 } })
    expect(s.config.timerSeconds).toBe(30)
  })
})

describe('trades', () => {
  beforeEach(() => {
    setupRoom()
    start()
    for (const [p, t] of [['V Kohli', 'MI'], ['RG Sharma', 'CSK'], ['JJ Bumrah', 'CSK'], ['SA Yadav', 'RCB']] as const) {
      nominate(p)
      bid(t, 200)
      advance(30_000)
    }
  })
  it('player + cash trade completes atomically', () => {
    run(owner('MI'), { type: 'proposeTrade', from: 'MI', to: 'CSK', give: { players: [pid('V Kohli')] }, receive: { players: [pid('RG Sharma')], cash: 300 } })
    const id = Object.keys(s.trades)[0]
    fails(owner('RCB'), { type: 'respondTrade', tradeId: id, accept: true })
    run(owner('CSK'), { type: 'respondTrade', tradeId: id, accept: true })
    expect(team('MI').squad.map((e) => e.playerId)).toEqual([pid('RG Sharma')])
    expect(team('CSK').squad.map((e) => e.playerId).sort()).toEqual([pid('JJ Bumrah'), pid('V Kohli')].sort())
    expect(team('MI').purse).toBe(11800 + 300)
    expect(team('CSK').purse).toBe(11600 - 300)
    fails(owner('CSK'), { type: 'respondTrade', tradeId: id, accept: true }, /already completed/)
  })
  it('reject, counter, and accepted counter', () => {
    run(owner('MI'), { type: 'proposeTrade', from: 'MI', to: 'CSK', give: { players: [pid('V Kohli')] }, receive: { players: [pid('JJ Bumrah')] } })
    const t1 = Object.keys(s.trades)[0]
    run(owner('CSK'), { type: 'respondTrade', tradeId: t1, accept: false })
    expect(s.trades[t1].status).toBe('rejected')
    run(owner('MI'), { type: 'proposeTrade', from: 'MI', to: 'CSK', give: { players: [pid('V Kohli')] }, receive: { players: [pid('JJ Bumrah')] } })
    const t2 = Object.keys(s.trades)[1]
    // CSK counters: CSK sends Bumrah + nothing, wants Kohli + 2 Cr
    run(owner('CSK'), { type: 'counterTrade', tradeId: t2, give: { players: [pid('JJ Bumrah')] }, receive: { players: [pid('V Kohli')], cash: 200 } })
    expect(s.trades[t2].status).toBe('countered')
    const t3 = Object.keys(s.trades)[2]
    expect(s.trades[t3].from).toBe('CSK')
    run(owner('MI'), { type: 'respondTrade', tradeId: t3, accept: true })
    expect(team('MI').squad.map((e) => e.playerId)).toEqual([pid('JJ Bumrah')])
    expect(team('MI').purse).toBe(11800 - 200)
    expect(totalMoney()).toBe(120000 + 0)
  })
  it('the same player cannot be in two pending trades', () => {
    run(owner('MI'), { type: 'proposeTrade', from: 'MI', to: 'CSK', give: { players: [pid('V Kohli')] }, receive: { players: [pid('JJ Bumrah')] } })
    fails(owner('MI'), { type: 'proposeTrade', from: 'MI', to: 'RCB', give: { players: [pid('V Kohli')] }, receive: { players: [pid('SA Yadav')] } }, /another pending trade/)
    fails(owner('RCB'), { type: 'proposeTrade', from: 'RCB', to: 'CSK', give: { players: [pid('SA Yadav')] }, receive: { players: [pid('JJ Bumrah')] } }, /another pending trade/)
  })
  it('cash in a trade cannot use money committed to a live bid', () => {
    nominate('HH Pandya')
    bid('MI', 11000)
    fails(owner('MI'), { type: 'proposeTrade', from: 'MI', to: 'CSK', give: { players: [], cash: 1000 }, receive: { players: [pid('JJ Bumrah')] } }, /committed/)
  })
  it('host approval flow and undo of a trade', () => {
    run(owner('MI'), { type: 'updateConfig', patch: { tradeRequiresHostApproval: true } })
    run(owner('CSK'), { type: 'proposeTrade', from: 'CSK', to: 'RCB', give: { players: [pid('RG Sharma')] }, receive: { players: [pid('SA Yadav')] } })
    const id = Object.keys(s.trades)[0]
    run(owner('RCB'), { type: 'respondTrade', tradeId: id, accept: true })
    expect(s.trades[id].status).toBe('awaiting_host')
    run(owner('MI'), { type: 'hostDecideTrade', tradeId: id, approve: true })
    expect(team('RCB').squad.map((e) => e.playerId)).toEqual([pid('RG Sharma')])
    run(owner('MI'), { type: 'undoLast' })
    expect(team('RCB').squad.map((e) => e.playerId)).toEqual([pid('SA Yadav')])
    expect(s.trades[id].status).toBe('reversed')
  })
  it('respects squad and overseas limits', () => {
    run(owner('MI'), { type: 'updateConfig', patch: { maxSquad: 2, minSquad: 0 } })
    fails(owner('RCB'), { type: 'proposeTrade', from: 'RCB', to: 'CSK', give: { players: [pid('SA Yadav')], cash: 0 }, receive: { players: [], cash: 100 } }, /maximum squad/)
  })
  it('post-auction trades work after completion', () => {
    run(owner('MI'), { type: 'endAuction' })
    run(owner('MI'), { type: 'proposeTrade', from: 'MI', to: 'RCB', give: { players: [pid('V Kohli')] }, receive: { players: [pid('SA Yadav')] } })
    const id = Object.keys(s.trades)[0]
    run(owner('RCB'), { type: 'respondTrade', tradeId: id, accept: true })
    expect(s.trades[id].status).toBe('completed')
    expect(s.trades[id].phaseAtProposal).toBe('completed')
  })
})

describe('RTM, retentions and mini auctions', () => {
  it('retentions reduce purse; RTM with final raise', () => {
    setupRoom({ retentionsEnabled: true, rtmEnabled: true, rtmCardsPerTeam: 2, rtmCombinedCap: 6 })
    run(owner('MI'), { type: 'setRetention', team: 'MI', playerId: pid('JJ Bumrah'), price: 1800 })
    expect(team('MI').purse).toBe(10200)
    start()
    expect(team('MI').purse).toBe(10200)
    expect(team('MI').rtmCards).toBe(2)
    // Hardik's last IPL team in the data is MI
    const hp = s.library[pid('HH Pandya')]
    expect(hp.lastTeam).toBe('MI')
    nominate('HH Pandya')
    bid('CSK', 1000)
    advance(30_000)
    expect(s.current!.phase).toBe('rtm_decision')
    run(owner('MI'), { type: 'rtm', action: 'use', lotKey: s.current!.lotKey })
    expect(s.current!.phase).toBe('rtm_raise')
    run(owner('CSK'), { type: 'rtm', action: 'raise', amount: 1200, lotKey: s.current!.lotKey })
    run(owner('MI'), { type: 'rtm', action: 'match', lotKey: s.current!.lotKey })
    expect(team('MI').squad.map((e) => e.playerId)).toContain(hp.id)
    expect(team('MI').purse).toBe(10200 - 1200)
    expect(team('MI').rtmCards).toBe(1)
    expect(team('CSK').purse).toBe(12000)
  })
  it('mini auction season keeps squads, releases go back with RTM eligibility', () => {
    setupRoom()
    start()
    nominate('V Kohli')
    bid('RCB', 300)
    advance(30_000)
    nominate('RG Sharma')
    bid('RCB', 300)
    advance(30_000)
    run(owner('MI'), { type: 'endAuction' })
    run(owner('MI'), { type: 'startNewSession', auctionType: 'mini' })
    expect(s.phase).toBe('lobby')
    expect(team('RCB').squad.length).toBe(2)
    run(owner('MI'), { type: 'releasePlayer', team: 'RCB', playerId: pid('RG Sharma') })
    run(owner('MI'), { type: 'updateConfig', patch: { startingPurse: 5000 } })
    expect(team('RCB').purse).toBe(5000 - 300)
    run(owner('MI'), { type: 'setCustomPool', ids: [pid('RG Sharma'), pid('SA Yadav')] })
    start()
    expect(Object.values(s.lots).filter((l) => l.status === 'pending').length).toBe(2)
    expect(s.lots[pid('RG Sharma')].rtmTeam).toBe('RCB')
  })
})
