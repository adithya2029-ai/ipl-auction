import type { RoomState, TeamCode, Trade, TradeSide } from '../../shared/types'
import { committedFor, overseasCount } from '../../shared/rules'
import { type Api, actor, controls, emit, ensure, fail, isTeamCode, notify, ownersOf, removeFromLineup, requireHost } from './util'

const OPEN: Trade['status'][] = ['pending', 'awaiting_host']

function side(raw: unknown, label: string): TradeSide {
  const r = (raw ?? {}) as Record<string, unknown>
  const players = Array.isArray(r.players) ? r.players : []
  ensure(players.every((x) => typeof x === 'string'), `${label}: invalid players`)
  ensure(new Set(players).size === players.length, `${label}: duplicate players`)
  const cash = r.cash === undefined || r.cash === null || r.cash === '' ? 0 : Number(r.cash)
  ensure(Number.isInteger(cash) && cash >= 0 && cash <= 1_000_000, `${label}: cash must be a whole number of lakh`)
  return { players: players as string[], cash }
}

export function lockedBy(s: RoomState, playerId: string, except?: string): Trade | null {
  for (const t of Object.values(s.trades))
    if (t.id !== except && OPEN.includes(t.status) && (t.give.players.includes(playerId) || t.receive.players.includes(playerId)))
      return t
  return null
}

function tradingAllowed(s: RoomState) {
  ensure(!s.archived, 'This room is archived')
  ensure(s.config.tradesEnabled, 'Trading is currently disabled by the host')
  if (s.phase === 'live') ensure(s.config.tradesDuringAuction, 'Trading during the auction is disabled')
  if (s.phase === 'lobby') ensure(s.season > 1, 'Trading opens once the auction starts')
}

/** Full validation of a trade against current state. Returns an error message or null. */
export function tradeBlocker(s: RoomState, t: Pick<Trade, 'id' | 'from' | 'to' | 'give' | 'receive'>): string | null {
  const cfg = s.config
  const A = s.teams[t.from]
  const B = s.teams[t.to]
  if (t.from === t.to) return 'A franchise cannot trade with itself'
  if (t.give.players.length + t.receive.players.length === 0) return 'A trade must include at least one player'
  if (!cfg.tradeCashAllowed && (t.give.cash > 0 || t.receive.cash > 0)) return 'Cash in trades is disabled'
  for (const id of t.give.players) {
    if (!s.library[id]) return 'Unknown player in trade'
    if (!A.squad.some((e) => e.playerId === id)) return `${s.library[id].name} is not in the ${t.from} squad`
  }
  for (const id of t.receive.players) {
    if (!s.library[id]) return 'Unknown player in trade'
    if (!B.squad.some((e) => e.playerId === id)) return `${s.library[id].name} is not in the ${t.to} squad`
  }
  for (const id of [...t.give.players, ...t.receive.players]) {
    if (s.current?.playerId === id) return `${s.library[id].name} is under the hammer`
    const other = lockedBy(s, id, t.id)
    if (other) return `${s.library[id].name} is already part of another pending trade`
  }
  const sizeA = A.squad.length - t.give.players.length + t.receive.players.length
  const sizeB = B.squad.length - t.receive.players.length + t.give.players.length
  if (sizeA > cfg.maxSquad) return `${t.from} would exceed the maximum squad size (${cfg.maxSquad})`
  if (sizeB > cfg.maxSquad) return `${t.to} would exceed the maximum squad size (${cfg.maxSquad})`
  const os = (ids: string[]) => ids.filter((id) => s.library[id]?.overseas).length
  const osA = overseasCount(A, s.library) - os(t.give.players) + os(t.receive.players)
  const osB = overseasCount(B, s.library) - os(t.receive.players) + os(t.give.players)
  if (osA > cfg.maxOverseas) return `${t.from} would exceed the overseas limit (${cfg.maxOverseas})`
  if (osB > cfg.maxOverseas) return `${t.to} would exceed the overseas limit (${cfg.maxOverseas})`
  const purseA = A.purse - t.give.cash + t.receive.cash
  const purseB = B.purse - t.receive.cash + t.give.cash
  if (purseA < committedFor(s, t.from)) return `${t.from} cannot afford this trade (purse committed to a live bid)`
  if (purseB < committedFor(s, t.to)) return `${t.to} cannot afford this trade (purse committed to a live bid)`
  if (purseA < 0) return `${t.from} does not have enough purse`
  if (purseB < 0) return `${t.to} does not have enough purse`
  return null
}

function moveAll(s: RoomState, from: TeamCode, to: TeamCode, ids: string[], now: number) {
  const A = s.teams[from]
  const B = s.teams[to]
  for (const id of ids) {
    const i = A.squad.findIndex((e) => e.playerId === id)
    const [e] = A.squad.splice(i, 1)
    removeFromLineup(A, id)
    B.squad.push({ ...e, via: 'trade', at: now })
    if (s.lots[id]) s.lots[id].soldTo = to
  }
}

/** Executes atomically: callers must have validated, and run inside the engine's draft. */
function execute(a: Api, t: Trade) {
  const { s, ctx } = a
  const blocker = tradeBlocker(s, t)
  if (blocker) fail(blocker)
  moveAll(s, t.from, t.to, t.give.players, ctx.now)
  moveAll(s, t.to, t.from, t.receive.players, ctx.now)
  s.teams[t.from].purse += t.receive.cash - t.give.cash
  s.teams[t.to].purse += t.give.cash - t.receive.cash
  t.status = 'completed'
  t.resolvedAt = ctx.now
  t.resolvedBy = ctx.actorId
  s.ledger.push({
    id: ctx.id(),
    type: 'trade',
    at: ctx.now,
    by: ctx.actorId,
    undone: false,
    data: { tradeId: t.id, from: t.from, to: t.to, give: t.give, receive: t.receive },
  })
  emit(a, 'trade_completed', { tradeId: t.id, from: t.from, to: t.to, give: t.give, receive: t.receive })
  notify(a, 'trade', `Trade completed: ${describe(s, t)}`)
}

export function describe(s: RoomState, t: Pick<Trade, 'from' | 'to' | 'give' | 'receive'>): string {
  const part = (x: TradeSide) =>
    [...x.players.map((id) => s.library[id]?.name ?? id), ...(x.cash ? [`${x.cash}L`] : [])].join(' + ') || 'nothing'
  return `${t.from} sends ${part(t.give)} to ${t.to} for ${part(t.receive)}`
}

function create(a: Api, from: TeamCode, to: TeamCode, give: TradeSide, receive: TradeSide, message: string, parentId: string | null): Trade {
  const { s, ctx } = a
  const t: Trade = {
    id: ctx.id(),
    from,
    to,
    give,
    receive,
    status: 'pending',
    message: message.slice(0, 500),
    parentId,
    proposedBy: ctx.actorId!,
    createdAt: ctx.now,
    resolvedAt: null,
    resolvedBy: null,
    failureReason: null,
    phaseAtProposal: s.phase,
  }
  const blocker = tradeBlocker(s, t)
  if (blocker) fail(blocker)
  s.trades[t.id] = t
  emit(a, parentId ? 'trade_countered' : 'trade_proposed', { tradeId: t.id, parentId, from, to, give, receive })
  notify(a, 'trade', `${from} ${parentId ? 'countered' : 'proposed a trade'}: ${describe(s, t)}`, ownersOf(s, to))
  return t
}

export function proposeTrade(a: Api, p: Record<string, unknown>) {
  const m = actor(a)
  tradingAllowed(a.s)
  ensure(isTeamCode(p.from) && isTeamCode(p.to), 'Choose both franchises')
  ensure(controls(m, p.from), `You do not control ${p.from}`)
  const t = create(a, p.from, p.to, side(p.give, 'You send'), side(p.receive, 'You receive'), String(p.message ?? ''), null)
  return { tradeId: t.id }
}

function getTrade(s: RoomState, id: unknown): Trade {
  ensure(typeof id === 'string' && s.trades[id], 'Unknown trade')
  return s.trades[id as string]
}

export function respondTrade(a: Api, p: { tradeId?: unknown; accept?: unknown }) {
  const m = actor(a)
  const { s, ctx } = a
  const t = getTrade(s, p.tradeId)
  ensure(t.status === 'pending', `This trade is already ${t.status}`)
  ensure(controls(m, t.to), `Only ${t.to} can respond to this trade`)
  if (!p.accept) {
    t.status = 'rejected'
    t.resolvedAt = ctx.now
    t.resolvedBy = m.id
    emit(a, 'trade_rejected', { tradeId: t.id })
    notify(a, 'trade', `${t.to} rejected the trade from ${t.from}`, ownersOf(s, t.from))
    return
  }
  tradingAllowed(s)
  const blocker = tradeBlocker(s, t)
  if (blocker) fail(blocker)
  if (s.config.tradeRequiresHostApproval) {
    t.status = 'awaiting_host'
    emit(a, 'trade_accepted', { tradeId: t.id, awaitingHost: true })
    notify(a, 'trade', `${t.to} accepted. Awaiting host approval: ${describe(s, t)}`, [s.hostId, ...ownersOf(s, t.from)])
    return
  }
  emit(a, 'trade_accepted', { tradeId: t.id, awaitingHost: false })
  execute(a, t)
}

export function counterTrade(a: Api, p: Record<string, unknown>) {
  const m = actor(a)
  const { s, ctx } = a
  tradingAllowed(s)
  const t = getTrade(s, p.tradeId)
  ensure(t.status === 'pending', `This trade is already ${t.status}`)
  ensure(controls(m, t.to), `Only ${t.to} can counter this trade`)
  t.status = 'countered'
  t.resolvedAt = ctx.now
  t.resolvedBy = m.id
  // The counter is proposed BY t.to TO t.from. give = what t.to now sends.
  const c = create(a, t.to, t.from, side(p.give, 'You send'), side(p.receive, 'You receive'), String(p.message ?? ''), t.id)
  return { tradeId: c.id }
}

export function cancelTrade(a: Api, p: { tradeId?: unknown }) {
  const m = actor(a)
  const { s, ctx } = a
  const t = getTrade(s, p.tradeId)
  ensure(OPEN.includes(t.status), `This trade is already ${t.status}`)
  ensure(controls(m, t.from) || s.hostId === m.id, 'Only the proposing franchise or the host can cancel')
  t.status = 'cancelled'
  t.resolvedAt = ctx.now
  t.resolvedBy = m.id
  emit(a, 'trade_cancelled', { tradeId: t.id })
}

export function hostDecideTrade(a: Api, p: { tradeId?: unknown; approve?: unknown }) {
  requireHost(a)
  const { s, ctx } = a
  const t = getTrade(s, p.tradeId)
  ensure(t.status === 'awaiting_host', 'This trade is not awaiting host approval')
  if (!p.approve) {
    t.status = 'vetoed'
    t.resolvedAt = ctx.now
    t.resolvedBy = ctx.actorId
    emit(a, 'trade_vetoed', { tradeId: t.id })
    notify(a, 'trade', `Host vetoed: ${describe(s, t)}`, [...ownersOf(s, t.from), ...ownersOf(s, t.to)])
    return
  }
  tradingAllowed(s)
  execute(a, t)
}

/** Reverses a completed trade (used by Undo). */
export function reverseTrade(a: Api, tradeId: string) {
  const { s, ctx } = a
  const t = getTrade(s, tradeId)
  ensure(t.status === 'completed', 'Trade is not completed')
  // inverse: t.to sends back t.give players and t.give cash; receives t.receive players and cash
  const inv = { id: `undo-${t.id}`, from: t.to, to: t.from, give: { players: t.give.players, cash: t.give.cash }, receive: { players: t.receive.players, cash: t.receive.cash } }
  const saved = s.config.tradeCashAllowed
  s.config.tradeCashAllowed = true
  const blocker = tradeBlocker(s, inv)
  s.config.tradeCashAllowed = saved
  if (blocker) fail(`Cannot undo trade: ${blocker}`)
  moveAll(s, inv.from, inv.to, inv.give.players, ctx.now)
  moveAll(s, inv.to, inv.from, inv.receive.players, ctx.now)
  s.teams[inv.from].purse += inv.receive.cash - inv.give.cash
  s.teams[inv.to].purse += inv.give.cash - inv.receive.cash
  t.status = 'reversed'
  emit(a, 'trade_reversed', { tradeId: t.id })
}
