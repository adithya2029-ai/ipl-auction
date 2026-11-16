import type { AcquiredVia, Lot, RoomState, TeamCode } from '../../shared/types'
import { TEAM_CODES } from '../../shared/types'
import { emptyTeams, minNextBid, overseasCount, setIndex } from '../../shared/rules'
import {
  type Api,
  acquireBlocker,
  actor,
  controls,
  emit,
  ensure,
  fail,
  intIn,
  isTeamCode,
  notify,
  ownersOf,
  player,
  removeFromLineup,
  requireHost,
  requireTeam,
  teamOf,
} from './util'

const sec = (n: number) => n * 1000

function requireLive(a: Api) {
  ensure(a.s.phase === 'live', 'The auction is not live')
}

export function orderIds(s: RoomState, ids: string[], random: () => number): string[] {
  const order = s.config.setOrder
  const groups = new Map<number, string[]>()
  for (const id of ids) {
    const lot = s.lots[id]
    const k = setIndex(lot?.set ?? '', order)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(id)
  }
  const out: string[] = []
  for (const k of [...groups.keys()].sort((x, y) => x - y)) {
    const g = groups.get(k)!
    if (s.config.shuffleWithinSet) {
      for (let i = g.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1))
        ;[g[i], g[j]] = [g[j], g[i]]
      }
    } else
      g.sort(
        (x, y) =>
          (s.lots[y].basePrice - s.lots[x].basePrice) ||
          s.library[x].name.localeCompare(s.library[y].name),
      )
    out.push(...g)
  }
  return out
}

export function poolIds(s: RoomState): string[] {
  const cfg = s.config
  const lib = s.library
  const ids =
    cfg.poolMode === 'custom'
      ? cfg.customPoolIds.filter((id) => lib[id])
      : Object.values(lib)
          .filter((p) => p.pools.some((t) => cfg.pools.includes(t)))
          .map((p) => p.id)
  return [...new Set(ids)].filter((id) => !teamOf(s, id))
}

/** Lobby: purse = starting purse minus retention costs. */
export function recomputeLobbyPurses(s: RoomState) {
  if (s.phase !== 'lobby') return
  for (const code of TEAM_CODES) {
    const t = s.teams[code]
    const retained = t.squad.reduce((n, e) => n + e.price, 0)
    t.purse = s.config.startingPurse - retained
    t.spent = retained
  }
}

function makeLot(s: RoomState, id: string, round: number): Lot {
  const p = s.library[id]
  return {
    playerId: id,
    status: 'pending',
    basePrice: p.basePrice,
    originalBasePrice: p.basePrice,
    set: p.marquee ? 'Marquee' : p.category,
    round,
    attempts: [],
    soldTo: null,
    soldPrice: null,
    rtmTeam: s.releasedBy[id] ?? (s.season === 1 ? p.lastTeam : null),
  }
}

export function startAuction(a: Api) {
  requireHost(a)
  const { s, ctx } = a
  ensure(s.phase === 'lobby', 'The auction has already started')
  const cfg = s.config
  ensure(cfg.minSquad <= cfg.maxSquad, 'Minimum squad size cannot exceed maximum squad size')
  ensure(cfg.increments.length > 0, 'Configure at least one bid increment')
  for (const code of TEAM_CODES) {
    const t = s.teams[code]
    ensure(t.squad.length <= cfg.maxSquad, `${code} has more retained players than the maximum squad size`)
    ensure(overseasCount(t, s.library) <= cfg.maxOverseas, `${code} exceeds the overseas limit with retentions`)
    if (cfg.auctionType === 'mega' && cfg.retentionsEnabled) {
      ensure(t.squad.length <= cfg.maxRetentions, `${code} exceeds the retention limit (${cfg.maxRetentions})`)
      ensure(
        overseasCount(t, s.library) <= cfg.maxOverseasRetentions,
        `${code} exceeds the overseas retention limit (${cfg.maxOverseasRetentions})`,
      )
    }
    if (cfg.auctionType === 'mega' && !cfg.retentionsEnabled)
      ensure(t.squad.length === 0, `Retentions are disabled but ${code} has retained players`)
  }
  recomputeLobbyPurses(s)
  for (const code of TEAM_CODES) ensure(s.teams[code].purse >= 0, `${code} retentions exceed the starting purse`)

  const ids = poolIds(s)
  ensure(ids.length > 0, 'The player pool is empty')
  s.lots = {}
  for (const id of ids) s.lots[id] = makeLot(s, id, 1)
  // record retained players as lots for completeness of the record
  for (const code of TEAM_CODES)
    for (const e of s.teams[code].squad) {
      const lot = makeLot(s, e.playerId, 0)
      lot.status = 'retained'
      lot.soldTo = code
      lot.soldPrice = e.price
      s.lots[e.playerId] = lot
    }
  s.queue = orderIds(s, ids, ctx.random)
  for (const code of TEAM_CODES) {
    const t = s.teams[code]
    const retainedCount = t.squad.length
    t.rtmCards = !cfg.rtmEnabled
      ? 0
      : cfg.rtmCombinedCap > 0
        ? Math.max(0, Math.min(cfg.rtmCardsPerTeam, cfg.rtmCombinedCap - retainedCount))
        : cfg.rtmCardsPerTeam
    t.rtmUsed = 0
  }
  s.phase = 'live'
  s.paused = false
  s.round = 1
  s.roundType = 'main'
  s.current = null
  s.autoNextAt = cfg.autoProgress ? ctx.now + sec(cfg.autoProgressDelay) : null
  s.startedAt = ctx.now
  s.completedAt = null
  emit(a, 'auction_started', { season: s.season, type: cfg.auctionType, pool: ids.length })
  notify(a, 'host', `The ${cfg.auctionType} auction has started with ${ids.length} players`)
}

export function nominate(a: Api, playerId?: unknown, system = false) {
  if (!system) requireHost(a)
  const { s, ctx } = a
  requireLive(a)
  ensure(!s.current, 'A player is already under the hammer')
  let id: string
  if (playerId !== undefined && playerId !== null) {
    ensure(typeof playerId === 'string', 'Invalid player')
    const lot = s.lots[playerId]
    ensure(lot, 'That player is not in this auction pool')
    ensure(['pending', 'unsold', 'skipped'].includes(lot.status), `That player is ${lot.status}`)
    id = playerId
  } else {
    ensure(s.queue.length > 0, 'The queue is empty. Start an unsold round or end the auction.')
    id = s.queue[0]
  }
  s.queue = s.queue.filter((x) => x !== id)
  const lot = s.lots[id]
  lot.status = 'live'
  lot.round = s.round
  const dur = sec(s.config.timerSeconds)
  s.current = {
    lotKey: ctx.id(),
    playerId: id,
    phase: 'bidding',
    startedAt: ctx.now,
    bids: [],
    high: null,
    deadline: s.paused ? null : ctx.now + dur,
    pausedRemaining: s.paused ? dur : null,
    rtm: null,
  }
  s.autoNextAt = null
  emit(a, 'nominated', { playerId: id, round: s.round, basePrice: lot.basePrice, lotKey: s.current.lotKey })
}

export function placeBid(a: Api, p: { team?: unknown; amount?: unknown; lotKey?: unknown }) {
  const { m, team } = requireTeam(a, p.team)
  const { s, ctx } = a
  requireLive(a)
  ensure(!s.paused, 'The auction is paused')
  const c = s.current
  ensure(c, 'No player is under the hammer')
  ensure(p.lotKey === c.lotKey, 'That lot has closed')
  ensure(c.phase === 'bidding', 'Bidding is closed for this player')
  ensure(c.deadline !== null && ctx.now < c.deadline, 'Bidding has closed')
  ensure(c.high?.team !== team, 'You already hold the highest bid')
  const amount = intIn(p.amount, 1, 1_000_000, 'Bid')
  const lot = s.lots[c.playerId]
  const min = minNextBid(c.high?.amount ?? null, lot.basePrice, s.config.increments)
  if (amount < min) fail(c.high ? `Outbid: the minimum bid is now ${min}L` : `The base price is ${min}L`)
  if (!s.config.allowJumpBids && amount !== min) fail(`Jump bids are disabled; the next bid is ${min}L`)
  const blocker = acquireBlocker(s, s.teams[team], c.playerId, amount)
  if (blocker) fail(blocker)
  const bid = { team, amount, memberId: m.id, at: ctx.now }
  c.bids.push(bid)
  c.high = bid
  c.deadline = ctx.now + sec(s.config.bidTimerSeconds)
  emit(a, 'bid', { playerId: c.playerId, team, amount, lotKey: c.lotKey, memberId: m.id })
}

function closeAttempt(a: Api, result: 'sold' | 'unsold' | 'skipped', team: TeamCode | null, amount: number | null, via?: 'auction' | 'rtm' | 'manual') {
  const { s, ctx } = a
  const c = s.current!
  const lot = s.lots[c.playerId]
  lot.attempts.push({
    round: s.round,
    startedAt: c.startedAt,
    endedAt: ctx.now,
    result,
    amount,
    team,
    bidCount: c.bids.length,
    via,
  })
  s.current = null
  s.autoNextAt = s.config.autoProgress && !s.paused && s.queue.length > 0 ? ctx.now + sec(s.config.autoProgressDelay) : null
}

function addToSquad(a: Api, team: TeamCode, playerId: string, price: number, via: AcquiredVia) {
  const t = a.s.teams[team]
  t.purse -= price
  t.spent += price
  t.squad.push({ playerId, price, via, at: a.ctx.now, round: a.s.round })
}

function sell(a: Api, team: TeamCode, amount: number, via: 'auction' | 'rtm') {
  const { s } = a
  const c = s.current!
  const lot = s.lots[c.playerId]
  ensure(lot.status === 'live', 'Duplicate sale prevented')
  const blocker = acquireBlocker(s, s.teams[team], c.playerId, amount)
  if (blocker) {
    // A rule changed under the lot (e.g. host lowered squad size). Never oversell.
    notify(a, 'warning', `${player(s, c.playerId).name} could not be sold: ${blocker}. Marked unsold.`)
    lot.status = 'unsold'
    closeAttempt(a, 'unsold', null, null)
    emit(a, 'unsold', { playerId: lot.playerId, reason: blocker })
    return
  }
  if (via === 'rtm') {
    s.teams[team].rtmCards--
    s.teams[team].rtmUsed++
  }
  addToSquad(a, team, c.playerId, amount, via)
  lot.status = 'sold'
  lot.soldTo = team
  lot.soldPrice = amount
  const lotKey = c.lotKey
  closeAttempt(a, 'sold', team, amount, via)
  s.ledger.push({
    id: a.ctx.id(),
    type: 'sale',
    at: a.ctx.now,
    by: a.ctx.actorId,
    undone: false,
    data: { playerId: lot.playerId, team, amount, via, round: s.round, lotKey },
  })
  emit(a, 'sold', { playerId: lot.playerId, team, amount, via, round: s.round })
  notify(a, 'success', `${player(s, lot.playerId).name} SOLD to ${team} for ${amount}L${via === 'rtm' ? ' (RTM)' : ''}`)
}

function markUnsold(a: Api, reason: string) {
  const { s } = a
  const c = s.current!
  const lot = s.lots[c.playerId]
  lot.status = 'unsold'
  closeAttempt(a, 'unsold', null, null)
  emit(a, 'unsold', { playerId: lot.playerId, reason })
  notify(a, 'info', `${player(s, lot.playerId).name} goes UNSOLD`)
}

function rtmCandidate(a: Api): TeamCode | null {
  const { s } = a
  const c = s.current!
  if (!s.config.rtmEnabled || !c.high) return null
  const lot = s.lots[c.playerId]
  const t = lot.rtmTeam
  if (!t || t === c.high.team) return null
  const team = s.teams[t]
  if (team.rtmCards <= 0) return null
  if (ownersOf(s, t).length === 0) return null
  if (acquireBlocker(s, team, c.playerId, c.high.amount)) return null
  return t
}

/** What happens when the clock runs out (or the host hammers) in the current phase. */
export function resolveCurrent(a: Api) {
  const { s, ctx } = a
  const c = s.current
  if (!c) return
  if (c.phase === 'bidding') {
    if (!c.high) return markUnsold(a, 'no bids')
    const rtm = rtmCandidate(a)
    if (rtm) {
      c.phase = 'rtm_decision'
      c.rtm = { team: rtm, price: c.high.amount, raisedTo: null }
      c.deadline = s.paused ? null : ctx.now + sec(s.config.rtmDecisionSeconds)
      c.pausedRemaining = s.paused ? sec(s.config.rtmDecisionSeconds) : null
      emit(a, 'rtm_offered', { playerId: c.playerId, team: rtm, price: c.high.amount })
      notify(a, 'info', `${rtm} may use a Right to Match card on ${player(s, c.playerId).name} at ${c.high.amount}L`)
      return
    }
    return sell(a, c.high.team, c.high.amount, 'auction')
  }
  const rtm = c.rtm!
  if (c.phase === 'rtm_decision') {
    emit(a, 'rtm_declined', { playerId: c.playerId, team: rtm.team })
    return sell(a, c.high!.team, c.high!.amount, 'auction')
  }
  if (c.phase === 'rtm_raise') return sell(a, rtm.team, rtm.price, 'rtm')
  if (c.phase === 'rtm_match') {
    emit(a, 'rtm_declined', { playerId: c.playerId, team: rtm.team, after: 'raise' })
    return sell(a, c.high!.team, rtm.raisedTo!, 'auction')
  }
}

export function tick(a: Api) {
  const { s, ctx } = a
  if (s.phase !== 'live' || s.paused || s.archived) return
  if (s.current) {
    if (s.current.deadline !== null && ctx.now >= s.current.deadline) {
      emit(a, 'timer_expired', { playerId: s.current.playerId, phase: s.current.phase })
      resolveCurrent(a)
    }
    return
  }
  if (s.autoNextAt !== null && ctx.now >= s.autoNextAt) {
    s.autoNextAt = null
    if (s.queue.length > 0) nominate(a, undefined, true)
  }
}

export function rtmAction(a: Api, p: { action?: unknown; amount?: unknown; lotKey?: unknown }) {
  const m = actor(a)
  const { s, ctx } = a
  requireLive(a)
  ensure(!s.paused, 'The auction is paused')
  const c = s.current
  ensure(c && c.rtm && c.high, 'There is no Right to Match decision pending')
  ensure(p.lotKey === c.lotKey, 'That lot has closed')
  const rtm = c.rtm
  const winner = c.high.team
  switch (p.action) {
    case 'use': {
      ensure(c.phase === 'rtm_decision', 'Not awaiting an RTM decision')
      ensure(controls(m, rtm.team), `Only ${rtm.team} can use this RTM`)
      emit(a, 'rtm_used', { playerId: c.playerId, team: rtm.team, price: rtm.price })
      if (s.config.rtmFinalRaise && ownersOf(s, winner).length > 0) {
        c.phase = 'rtm_raise'
        c.deadline = ctx.now + sec(s.config.rtmDecisionSeconds)
        notify(a, 'info', `${rtm.team} used RTM. ${winner} may make one final raise.`)
        return
      }
      return sell(a, rtm.team, rtm.price, 'rtm')
    }
    case 'decline': {
      ensure(c.phase === 'rtm_decision' || c.phase === 'rtm_match', 'Nothing to decline')
      ensure(controls(m, rtm.team), `Only ${rtm.team} can decline`)
      return resolveCurrent(a)
    }
    case 'raise': {
      ensure(c.phase === 'rtm_raise', 'Not awaiting a final raise')
      ensure(controls(m, winner), `Only ${winner} can raise`)
      const amount = intIn(p.amount, rtm.price + 1, 1_000_000, 'Final raise')
      const blocker = acquireBlocker(s, s.teams[winner], c.playerId, amount)
      if (blocker) fail(blocker)
      rtm.raisedTo = amount
      emit(a, 'rtm_raised', { playerId: c.playerId, team: winner, amount })
      if (acquireBlocker(s, s.teams[rtm.team], c.playerId, amount)) {
        notify(a, 'info', `${rtm.team} cannot afford to match ${amount}L`)
        return sell(a, winner, amount, 'auction')
      }
      c.phase = 'rtm_match'
      c.deadline = ctx.now + sec(s.config.rtmDecisionSeconds)
      notify(a, 'info', `${winner} raised to ${amount}L. ${rtm.team} must match or decline.`)
      return
    }
    case 'no_raise': {
      ensure(c.phase === 'rtm_raise', 'Not awaiting a final raise')
      ensure(controls(m, winner), `Only ${winner} can decide`)
      return sell(a, rtm.team, rtm.price, 'rtm')
    }
    case 'match': {
      ensure(c.phase === 'rtm_match', 'Not awaiting a match decision')
      ensure(controls(m, rtm.team), `Only ${rtm.team} can match`)
      return sell(a, rtm.team, rtm.raisedTo!, 'rtm')
    }
    default:
      fail('Unknown RTM action')
  }
}

export function hammer(a: Api) {
  requireHost(a)
  requireLive(a)
  ensure(a.s.current, 'No player is under the hammer')
  emit(a, 'host_hammer', { playerId: a.s.current.playerId, phase: a.s.current.phase })
  resolveCurrent(a)
}

export function hostUnsold(a: Api) {
  requireHost(a)
  requireLive(a)
  ensure(a.s.current, 'No player is under the hammer')
  markUnsold(a, 'host')
}

export function skip(a: Api, playerId?: unknown) {
  requireHost(a)
  requireLive(a)
  const { s } = a
  if (s.current && (playerId === undefined || playerId === s.current.playerId)) {
    const id = s.current.playerId
    s.lots[id].status = 'skipped'
    closeAttempt(a, 'skipped', null, null)
    emit(a, 'skipped', { playerId: id })
    return
  }
  ensure(typeof playerId === 'string' && s.lots[playerId], 'Unknown player')
  const lot = s.lots[playerId]
  ensure(lot.status === 'pending', 'Only queued players can be skipped')
  lot.status = 'skipped'
  s.queue = s.queue.filter((x) => x !== playerId)
  emit(a, 'skipped', { playerId })
}

/** Ends the current pass through the queue: every queued player is set aside as skipped. */
export function skipRemaining(a: Api) {
  requireHost(a)
  requireLive(a)
  const { s } = a
  ensure(s.queue.length > 0, 'The queue is already empty')
  const ids = [...s.queue]
  for (const id of ids) s.lots[id].status = 'skipped'
  s.queue = []
  s.autoNextAt = null
  emit(a, 'queue_skipped', { players: ids, round: s.round })
  notify(a, 'host', `${ids.length} queued players set aside for later rounds`)
}

export function recall(a: Api, p: { playerId?: unknown; position?: unknown }) {
  requireHost(a)
  ensure(a.s.phase === 'live', 'Reopen the auction first')
  const { s } = a
  ensure(typeof p.playerId === 'string' && s.lots[p.playerId], 'Unknown player')
  const lot = s.lots[p.playerId]
  ensure(lot.status === 'skipped' || lot.status === 'unsold', 'Only skipped or unsold players can be recalled')
  lot.status = 'pending'
  lot.round = s.round
  s.queue = s.queue.filter((x) => x !== p.playerId)
  if (p.position === 'back') s.queue.push(p.playerId)
  else s.queue.unshift(p.playerId)
  emit(a, 'recalled', { playerId: p.playerId, round: s.round })
}

export function pause(a: Api) {
  requireHost(a)
  requireLive(a)
  const { s, ctx } = a
  ensure(!s.paused, 'Already paused')
  s.paused = true
  if (s.current?.deadline) {
    s.current.pausedRemaining = Math.max(0, s.current.deadline - ctx.now)
    s.current.deadline = null
  }
  s.autoNextAt = null
  emit(a, 'paused', { playerId: s.current?.playerId ?? null })
  notify(a, 'host', 'Auction paused')
}

export function resume(a: Api) {
  requireHost(a)
  requireLive(a)
  const { s, ctx } = a
  ensure(s.paused, 'The auction is not paused')
  s.paused = false
  if (s.current && s.current.pausedRemaining !== null) {
    s.current.deadline = ctx.now + Math.max(s.current.pausedRemaining, 3000)
    s.current.pausedRemaining = null
  }
  if (!s.current && s.config.autoProgress && s.queue.length) s.autoNextAt = ctx.now + sec(s.config.autoProgressDelay)
  emit(a, 'resumed', {})
  notify(a, 'host', 'Auction resumed')
}

export function resetTimer(a: Api, seconds: unknown) {
  requireHost(a)
  requireLive(a)
  const { s, ctx } = a
  const c = s.current
  ensure(c, 'No player is under the hammer')
  const secs = intIn(seconds, 3, 600, 'Timer')
  if (s.paused) c.pausedRemaining = sec(secs)
  else c.deadline = ctx.now + sec(secs)
  emit(a, 'timer_reset', { playerId: c.playerId, seconds: secs })
}

export function setBasePrice(a: Api, p: { playerId?: unknown; amount?: unknown }) {
  requireHost(a)
  const { s } = a
  ensure(typeof p.playerId === 'string', 'Unknown player')
  const amount = intIn(p.amount, 1, 100000, 'Base price')
  const lot = s.lots[p.playerId]
  if (s.phase !== 'lobby' && lot) {
    if (lot.status === 'live') ensure(s.current?.bids.length === 0, 'Cannot change the base price after bidding has started')
    else ensure(['pending', 'unsold', 'skipped'].includes(lot.status), 'Player has already been sold')
    lot.basePrice = amount
  }
  const pl = player(s, p.playerId)
  s.library = { ...s.library, [pl.id]: { ...pl, basePrice: amount } }
  a.fx.libraryChanged = true
  emit(a, 'base_price_changed', { playerId: pl.id, amount })
}

function latestSaleTx(s: RoomState, playerId: string) {
  for (let i = s.ledger.length - 1; i >= 0; i--) {
    const t = s.ledger[i]
    if (!t.undone && (t.type === 'sale' || t.type === 'manual_assign' || t.type === 'sale_correction') && t.data.playerId === playerId)
      return t
  }
  return null
}

/** Removes a sold player from his squad and refunds the price. Returns the refunded entry. */
function unsell(a: Api, playerId: string, to: 'queue' | 'unsold') {
  const { s, ctx } = a
  const lot = s.lots[playerId]
  ensure(lot && lot.status === 'sold' && lot.soldTo, 'That player is not sold')
  const team = s.teams[lot.soldTo]
  const idx = team.squad.findIndex((e) => e.playerId === playerId)
  ensure(idx >= 0, `${player(s, playerId).name} is no longer in the ${lot.soldTo} squad (traded?)`)
  const entry = team.squad[idx]
  team.squad.splice(idx, 1)
  team.purse += entry.price
  team.spent -= entry.price
  if (entry.via === 'rtm') {
    team.rtmCards++
    team.rtmUsed--
  }
  removeFromLineup(team, playerId)
  lot.attempts.push({
    round: s.round,
    startedAt: ctx.now,
    endedAt: ctx.now,
    result: 'reverted',
    amount: entry.price,
    team: lot.soldTo,
    bidCount: 0,
  })
  const from = lot.soldTo
  lot.soldTo = null
  lot.soldPrice = null
  if (to === 'queue') {
    lot.status = 'pending'
    lot.round = s.round
    s.queue = [playerId, ...s.queue.filter((x) => x !== playerId)]
  } else lot.status = 'unsold'
  return { from, entry }
}

export function revertSale(a: Api, p: { playerId?: unknown; to?: unknown }) {
  requireHost(a)
  const { s } = a
  ensure(s.phase !== 'lobby', 'Nothing to revert')
  ensure(typeof p.playerId === 'string', 'Unknown player')
  const tx = latestSaleTx(s, p.playerId)
  const { from, entry } = unsell(a, p.playerId, p.to === 'unsold' ? 'unsold' : 'queue')
  if (tx) tx.undone = true
  s.ledger.push({
    id: a.ctx.id(),
    type: 'sale_revert',
    at: a.ctx.now,
    by: a.ctx.actorId,
    undone: false,
    data: { playerId: p.playerId, team: from, amount: entry.price },
  })
  emit(a, 'sale_reverted', { playerId: p.playerId, team: from, amount: entry.price })
  notify(a, 'host', `Sale of ${player(s, p.playerId).name} to ${from} was reverted`)
}

export function correctSale(a: Api, p: { playerId?: unknown; team?: unknown; amount?: unknown }) {
  requireHost(a)
  const { s, ctx } = a
  ensure(typeof p.playerId === 'string', 'Unknown player')
  ensure(isTeamCode(p.team), 'Choose a franchise')
  const amount = intIn(p.amount, 0, 1_000_000, 'Price')
  const lot = s.lots[p.playerId]
  ensure(lot && lot.status === 'sold' && lot.soldTo, 'That player is not sold')
  const oldTeam = lot.soldTo
  const from = s.teams[oldTeam]
  const idx = from.squad.findIndex((e) => e.playerId === p.playerId)
  ensure(idx >= 0, 'That player is no longer in the buying squad')
  const entry = from.squad[idx]
  // remove, then check, then add
  from.squad.splice(idx, 1)
  from.purse += entry.price
  from.spent -= entry.price
  const to = s.teams[p.team]
  const blocker = acquireBlocker(s, to, p.playerId, amount)
  if (blocker) fail(blocker)
  if (oldTeam !== p.team) removeFromLineup(from, p.playerId)
  to.purse -= amount
  to.spent += amount
  to.squad.push({ ...entry, price: amount, at: ctx.now })
  lot.soldTo = p.team
  lot.soldPrice = amount
  const prev = latestSaleTx(s, p.playerId)
  s.ledger.push({
    id: ctx.id(),
    type: 'sale_correction',
    at: ctx.now,
    by: ctx.actorId,
    undone: false,
    data: { playerId: p.playerId, fromTeam: oldTeam, fromAmount: entry.price, team: p.team, amount, prevTx: prev?.id ?? null },
  })
  emit(a, 'sale_corrected', { playerId: p.playerId, fromTeam: oldTeam, fromAmount: entry.price, team: p.team, amount })
  notify(a, 'host', `Sale corrected: ${player(s, p.playerId).name} → ${p.team} for ${amount}L`)
}

export function manualAssign(a: Api, p: { playerId?: unknown; team?: unknown; amount?: unknown }) {
  requireHost(a)
  const { s, ctx } = a
  ensure(s.phase !== 'lobby', 'Use retentions before the auction starts')
  ensure(typeof p.playerId === 'string', 'Unknown player')
  ensure(isTeamCode(p.team), 'Choose a franchise')
  const amount = intIn(p.amount, 0, 1_000_000, 'Price')
  player(s, p.playerId)
  let lot = s.lots[p.playerId]
  if (!lot) {
    ensure(!teamOf(s, p.playerId), 'Player already belongs to a squad')
    lot = s.lots[p.playerId] = makeLot(s, p.playerId, s.round)
  }
  ensure(['pending', 'unsold', 'skipped'].includes(lot.status), `That player is ${lot.status}`)
  const blocker = acquireBlocker(s, s.teams[p.team], p.playerId, amount)
  if (blocker) fail(blocker)
  s.queue = s.queue.filter((x) => x !== p.playerId)
  addToSquad(a, p.team, p.playerId, amount, 'manual')
  lot.status = 'sold'
  lot.soldTo = p.team
  lot.soldPrice = amount
  lot.attempts.push({ round: s.round, startedAt: ctx.now, endedAt: ctx.now, result: 'sold', amount, team: p.team, bidCount: 0, via: 'manual' })
  s.ledger.push({ id: ctx.id(), type: 'manual_assign', at: ctx.now, by: ctx.actorId, undone: false, data: { playerId: p.playerId, team: p.team, amount } })
  emit(a, 'manual_assign', { playerId: p.playerId, team: p.team, amount })
  notify(a, 'host', `${player(s, p.playerId).name} assigned to ${p.team} for ${amount}L`)
}

export function adjustPurse(a: Api, p: { team?: unknown; delta?: unknown; reason?: unknown }) {
  requireHost(a)
  const { s, ctx } = a
  ensure(s.phase !== 'lobby', 'Change the starting purse in the configuration instead')
  ensure(isTeamCode(p.team), 'Choose a franchise')
  const delta = intIn(p.delta, -1_000_000, 1_000_000, 'Adjustment')
  ensure(delta !== 0, 'Adjustment cannot be zero')
  const t = s.teams[p.team]
  ensure(t.purse + delta >= committed(s, p.team), 'Purse cannot go below what the team has committed')
  t.purse += delta
  const reason = typeof p.reason === 'string' ? p.reason.slice(0, 200) : ''
  s.ledger.push({ id: ctx.id(), type: 'purse_adjust', at: ctx.now, by: ctx.actorId, undone: false, data: { team: p.team, delta, reason } })
  emit(a, 'purse_adjusted', { team: p.team, delta, reason })
}

function committed(s: RoomState, team: TeamCode): number {
  const c = s.current
  if (!c || !c.high) return 0
  if (c.phase === 'bidding') return c.high.team === team ? c.high.amount : 0
  const amt = c.rtm?.raisedTo ?? c.rtm?.price ?? 0
  return c.high.team === team || c.rtm?.team === team ? amt : 0
}
export { committed }

export function startUnsoldRound(a: Api, ids: unknown) {
  requireHost(a)
  const { s, ctx } = a
  ensure(s.phase === 'live', 'Reopen the auction to run another unsold round')
  ensure(!s.current, 'Finish the current lot first')
  let chosen: string[]
  if (Array.isArray(ids) && ids.length) {
    chosen = [...new Set(ids.filter((x): x is string => typeof x === 'string'))]
    for (const id of chosen) {
      const lot = s.lots[id]
      ensure(lot, 'Unknown player in selection')
      ensure(lot.status === 'unsold' || lot.status === 'skipped', `${player(s, id).name} is not unsold`)
    }
  } else chosen = Object.values(s.lots).filter((l) => l.status === 'unsold' || l.status === 'skipped').map((l) => l.playerId)
  ensure(chosen.length > 0, 'There are no unsold players')
  s.round += 1
  s.roundType = 'unsold'
  for (const id of chosen) {
    s.lots[id].status = 'pending'
    s.lots[id].round = s.round
  }
  s.queue = [...s.queue.filter((x) => !chosen.includes(x)), ...orderIds(s, chosen, ctx.random)]
  if (s.config.autoProgress && !s.paused) s.autoNextAt = ctx.now + sec(s.config.autoProgressDelay)
  emit(a, 'unsold_round_started', { round: s.round, players: chosen })
  notify(a, 'host', `Unsold round ${s.round - 1} started with ${chosen.length} players`)
}

export function endAuction(a: Api) {
  requireHost(a)
  const { s, ctx } = a
  requireLive(a)
  ensure(!s.current, 'Finish the current lot first')
  s.phase = 'completed'
  s.paused = false
  s.autoNextAt = null
  s.completedAt = ctx.now
  emit(a, 'auction_completed', { round: s.round })
  notify(a, 'host', 'The auction is complete. The transfer market is open.')
}

export function reopenAuction(a: Api) {
  requireHost(a)
  const { s } = a
  ensure(s.phase === 'completed', 'The auction is not complete')
  s.phase = 'live'
  s.paused = false
  s.completedAt = null
  emit(a, 'auction_reopened', { round: s.round })
  notify(a, 'host', 'The auction has been reopened')
}

export function addToPool(a: Api, ids: unknown) {
  requireHost(a)
  const { s } = a
  ensure(s.phase !== 'lobby', 'Use the pool selection before the auction starts')
  ensure(Array.isArray(ids) && ids.length > 0, 'Select players')
  const added: string[] = []
  for (const id of ids) {
    if (typeof id !== 'string' || !s.library[id] || s.lots[id] || teamOf(s, id)) continue
    s.lots[id] = makeLot(s, id, s.round)
    added.push(id)
  }
  ensure(added.length > 0, 'Those players are already in the auction')
  s.queue.push(...orderIds(s, added, a.ctx.random))
  emit(a, 'pool_added', { players: added })
}

export function removeFromPool(a: Api, id: unknown) {
  requireHost(a)
  const { s } = a
  ensure(typeof id === 'string' && s.lots[id], 'Unknown player')
  const lot = s.lots[id]
  ensure(['pending', 'unsold', 'skipped'].includes(lot.status), 'Only players not yet sold can be withdrawn')
  ensure(lot.attempts.length === 0, 'This player has auction history; mark him unsold instead')
  delete s.lots[id]
  s.queue = s.queue.filter((x) => x !== id)
  emit(a, 'pool_removed', { playerId: id })
}

export function startNewSession(a: Api, p: { auctionType?: unknown }) {
  requireHost(a)
  const { s, ctx } = a
  ensure(s.phase === 'completed', 'Complete the current auction first')
  const summary = {
    season: s.season,
    auctionType: s.config.auctionType,
    endedAt: ctx.now,
    teams: Object.fromEntries(
      TEAM_CODES.map((c) => [c, { purse: s.teams[c].purse, spent: s.teams[c].spent, squad: s.teams[c].squad.map((e) => ({ ...e })) }]),
    ) as RoomState['sessions'][number]['teams'],
    sold: Object.values(s.lots).filter((l) => l.status === 'sold').length,
    unsold: Object.values(s.lots).filter((l) => l.status === 'unsold' || l.status === 'skipped').length,
  }
  s.sessions.push(summary)
  for (const t of Object.values(s.trades)) if (t.status === 'pending' || t.status === 'awaiting_host') t.status = 'cancelled'
  s.season += 1
  s.config.auctionType = p.auctionType === 'mega' ? 'mega' : 'mini'
  s.phase = 'lobby'
  s.round = 0
  s.roundType = 'main'
  s.lots = {}
  s.queue = []
  s.current = null
  s.autoNextAt = null
  s.releasedBy = {}
  s.startedAt = null
  s.completedAt = null
  const fresh = emptyTeams(s.config)
  for (const code of TEAM_CODES) {
    const old = s.teams[code]
    fresh[code].squad = s.config.auctionType === 'mega' ? [] : old.squad.map((e) => ({ ...e, via: 'retained' as const }))
    if (s.config.auctionType === 'mega') for (const e of old.squad) s.releasedBy[e.playerId] = code
    fresh[code].xi = s.config.auctionType === 'mega' ? [] : old.xi
    fresh[code].captain = s.config.auctionType === 'mega' ? null : old.captain
    fresh[code].viceCaptain = s.config.auctionType === 'mega' ? null : old.viceCaptain
  }
  s.teams = fresh
  recomputeLobbyPurses(s)
  emit(a, 'session_started', { season: s.season, auctionType: s.config.auctionType })
  notify(a, 'host', `Season ${s.season} set up as a ${s.config.auctionType} auction. Configure retentions and releases.`)
}

export function setRetention(a: Api, p: { team?: unknown; playerId?: unknown; price?: unknown }) {
  requireHost(a)
  const { s, ctx } = a
  ensure(s.phase === 'lobby', 'Retentions can only be changed before the auction starts')
  ensure(isTeamCode(p.team), 'Choose a franchise')
  ensure(typeof p.playerId === 'string', 'Choose a player')
  const pl = player(s, p.playerId)
  const price = intIn(p.price, 0, 1_000_000, 'Retention price')
  const owner = teamOf(s, pl.id)
  ensure(!owner || owner === p.team, `${pl.name} is already retained by ${owner}`)
  const t = s.teams[p.team]
  const existing = t.squad.find((e) => e.playerId === pl.id)
  if (existing) existing.price = price
  else {
    ensure(t.squad.length < s.config.maxSquad, `${p.team} squad is full`)
    t.squad.push({ playerId: pl.id, price, via: 'retained', at: ctx.now, round: null })
  }
  delete s.releasedBy[pl.id]
  recomputeLobbyPurses(s)
  emit(a, 'retention_set', { team: p.team, playerId: pl.id, price })
}

export function releasePlayer(a: Api, p: { team?: unknown; playerId?: unknown }) {
  requireHost(a)
  const { s } = a
  ensure(s.phase === 'lobby', 'Players can only be released before the auction starts')
  ensure(isTeamCode(p.team), 'Choose a franchise')
  const t = s.teams[p.team]
  const idx = t.squad.findIndex((e) => e.playerId === p.playerId)
  ensure(idx >= 0, 'Player is not in that squad')
  const [e] = t.squad.splice(idx, 1)
  removeFromLineup(t, e.playerId)
  if (s.season > 1) s.releasedBy[e.playerId] = p.team
  recomputeLobbyPurses(s)
  emit(a, 'player_released', { team: p.team, playerId: e.playerId, price: e.price })
}

export function importRetentions(a: Api, rows: unknown) {
  requireHost(a)
  const { s } = a
  ensure(s.phase === 'lobby', 'Retentions can only be changed before the auction starts')
  ensure(Array.isArray(rows) && rows.length > 0, 'No rows to import')
  const byName = new Map<string, string>()
  for (const pl of Object.values(s.library)) {
    byName.set(pl.name.toLowerCase(), pl.id)
    byName.set(pl.shortName.toLowerCase(), pl.id)
    byName.set(pl.id, pl.id)
  }
  const errors: string[] = []
  let count = 0
  for (const [i, r] of rows.entries()) {
    const row = r as Record<string, unknown>
    const team = String(row.team ?? '').toUpperCase().trim()
    const id = byName.get(String(row.player ?? '').toLowerCase().trim())
    const price = Number(row.price)
    if (!isTeamCode(team)) errors.push(`Row ${i + 1}: unknown team "${row.team}"`)
    else if (!id) errors.push(`Row ${i + 1}: unknown player "${row.player}"`)
    else if (!Number.isInteger(price) || price < 0) errors.push(`Row ${i + 1}: invalid price`)
    else {
      try {
        setRetention(a, { team, playerId: id, price })
        count++
      } catch (e) {
        errors.push(`Row ${i + 1}: ${(e as Error).message}`)
      }
    }
  }
  ensure(errors.length === 0, `Import failed (nothing changed):\n${errors.slice(0, 10).join('\n')}`)
  emit(a, 'retentions_imported', { count })
}

export function setRtmCards(a: Api, p: { team?: unknown; cards?: unknown }) {
  requireHost(a)
  ensure(isTeamCode(p.team), 'Choose a franchise')
  a.s.teams[p.team].rtmCards = intIn(p.cards, 0, 20, 'RTM cards')
  emit(a, 'rtm_cards_set', { team: p.team, cards: a.s.teams[p.team].rtmCards })
}
