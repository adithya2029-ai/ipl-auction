import type { Member, Player, PublicState, RoomState } from '../../shared/types'
import { defaultConfig, emptyTeams } from '../../shared/rules'
import * as A from './auction'
import * as R from './room'
import * as T from './trades'
import { type Api, type Ctx, type Effects, CmdError, emit, ensure, notify, requireHost } from './util'

export { CmdError }
export type { Ctx, Effects }

export function createRoomState(p: { code: string; name: string; host: Member; library: Record<string, Player>; now: number }): RoomState {
  const config = defaultConfig()
  return {
    code: p.code,
    name: p.name,
    createdAt: p.now,
    version: 0,
    archived: false,
    hostId: p.host.id,
    pendingHostTransfer: null,
    members: { [p.host.id]: p.host },
    config,
    phase: 'lobby',
    paused: false,
    season: 1,
    round: 0,
    roundType: 'main',
    teams: emptyTeams(config),
    lots: {},
    queue: [],
    current: null,
    autoNextAt: null,
    trades: {},
    ledger: [],
    sessions: [],
    releasedBy: {},
    library: p.library,
    libraryVersion: 1,
    startedAt: null,
    completedAt: null,
  }
}

export type Command = { type: string; [k: string]: unknown }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (a: Api, c: any) => unknown

function undoLast(a: Api) {
  requireHost(a)
  const { s } = a
  ensure(s.phase !== 'lobby', 'Nothing to undo')
  const undoable = ['sale', 'manual_assign', 'trade', 'purse_adjust', 'sale_correction']
  let tx = null
  for (let i = s.ledger.length - 1; i >= 0; i--)
    if (!s.ledger[i].undone && undoable.includes(s.ledger[i].type)) {
      tx = s.ledger[i]
      break
    }
  ensure(tx, 'There is no transaction to undo')
  const d = tx.data as Record<string, any>
  switch (tx.type) {
    case 'sale':
    case 'manual_assign': {
      ensure(s.phase === 'live', 'Reopen the auction to undo a sale')
      ensure(!s.current || s.current.playerId !== d.playerId, 'Player is under the hammer')
      A.revertSale(a, { playerId: d.playerId, to: 'queue' })
      break
    }
    case 'sale_correction': {
      A.correctSale(a, { playerId: d.playerId, team: d.fromTeam, amount: d.fromAmount })
      // the correction we just made is itself not undoable
      s.ledger[s.ledger.length - 1].undone = true
      break
    }
    case 'trade':
      T.reverseTrade(a, d.tradeId)
      break
    case 'purse_adjust': {
      const t = s.teams[d.team as keyof typeof s.teams]
      ensure(t.purse - d.delta >= A.committed(s, d.team), 'Undoing would leave the team below its committed bid')
      t.purse -= d.delta
      break
    }
  }
  tx.undone = true
  emit(a, 'undo', { txId: tx.id, txType: tx.type, data: d })
  notify(a, 'host', `Host undid the last ${tx.type.replace('_', ' ')}`)
}

const HANDLERS: Record<string, Handler> = {
  // members & host
  approveMember: (a, c) => R.approveMember(a, c),
  rejectMember: (a, c) => R.rejectMember(a, c),
  removeMember: (a, c) => R.removeMember(a, c),
  unbanMember: (a, c) => R.unbanMember(a, c),
  claimTeam: (a, c) => R.claimTeam(a, c),
  releaseTeam: (a, c) => R.releaseTeam(a, c),
  assignTeam: (a, c) => R.assignTeam(a, c),
  setMemberRole: (a, c) => R.setMemberRole(a, c),
  requestHostTransfer: (a, c) => R.requestHostTransfer(a, c),
  respondHostTransfer: (a, c) => R.respondHostTransfer(a, c),
  cancelHostTransfer: (a) => R.cancelHostTransfer(a),
  claimHost: (a) => R.claimHost(a),
  renameRoom: (a, c) => R.renameRoom(a, c),
  setArchived: (a, c) => R.setArchived(a, c),
  // config & library
  updateConfig: (a, c) => R.updateConfig(a, c.patch),
  setCustomPool: (a, c) => R.setCustomPool(a, c),
  addPlayer: (a, c) => R.addPlayer(a, c.player),
  updatePlayer: (a, c) => R.updatePlayer(a, c),
  bulkUpdatePlayers: (a, c) => R.bulkUpdatePlayers(a, c),
  removePlayer: (a, c) => R.removePlayer(a, c),
  importPlayers: (a, c) => R.importPlayers(a, c),
  setRetention: (a, c) => A.setRetention(a, c),
  releasePlayer: (a, c) => A.releasePlayer(a, c),
  importRetentions: (a, c) => A.importRetentions(a, c.rows),
  setRtmCards: (a, c) => A.setRtmCards(a, c),
  // auction
  startAuction: (a) => A.startAuction(a),
  nominate: (a, c) => A.nominate(a, c.playerId),
  bid: (a, c) => A.placeBid(a, c),
  rtm: (a, c) => A.rtmAction(a, c),
  hammer: (a) => A.hammer(a),
  markUnsold: (a) => A.hostUnsold(a),
  skip: (a, c) => A.skip(a, c.playerId),
  skipRemaining: (a) => A.skipRemaining(a),
  recall: (a, c) => A.recall(a, c),
  pause: (a) => A.pause(a),
  resume: (a) => A.resume(a),
  resetTimer: (a, c) => A.resetTimer(a, c.seconds),
  setBasePrice: (a, c) => A.setBasePrice(a, c),
  revertSale: (a, c) => A.revertSale(a, c),
  correctSale: (a, c) => A.correctSale(a, c),
  manualAssign: (a, c) => A.manualAssign(a, c),
  adjustPurse: (a, c) => A.adjustPurse(a, c),
  undoLast: (a) => undoLast(a),
  startUnsoldRound: (a, c) => A.startUnsoldRound(a, c.playerIds),
  endAuction: (a) => A.endAuction(a),
  reopenAuction: (a) => A.reopenAuction(a),
  addToPool: (a, c) => A.addToPool(a, c.playerIds),
  removeFromPool: (a, c) => A.removeFromPool(a, c.playerId),
  startNewSession: (a, c) => A.startNewSession(a, c),
  // trades
  proposeTrade: (a, c) => T.proposeTrade(a, c),
  respondTrade: (a, c) => T.respondTrade(a, c),
  counterTrade: (a, c) => T.counterTrade(a, c),
  cancelTrade: (a, c) => T.cancelTrade(a, c),
  hostDecideTrade: (a, c) => T.hostDecideTrade(a, c),
  // team
  setLineup: (a, c) => R.setLineup(a, c),
}

/** Commands allowed while the room is archived. */
const ARCHIVE_OK = new Set(['setArchived', 'renameRoom'])

export const SYSTEM = { tick: (a: Api) => A.tick(a) }

/**
 * Applies one command to a draft state. Throws CmdError on validation failure;
 * callers must discard the draft in that case (all-or-nothing).
 */
export function applyCommand(s: RoomState, cmd: Command, ctx: Ctx): { fx: Effects; data: unknown } {
  const fx: Effects = { events: [], notices: [], libraryChanged: false, kick: [] }
  const a: Api = { s, ctx, fx }
  if (cmd.type === '__tick') {
    SYSTEM.tick(a)
    return { fx, data: null }
  }
  const h = HANDLERS[cmd.type]
  if (!h) throw new CmdError(`Unknown command: ${cmd.type}`)
  if (s.archived && !ARCHIVE_OK.has(cmd.type)) throw new CmdError('This room is archived (read-only)')
  const data = h(a, cmd)
  if (fx.libraryChanged) s.libraryVersion++
  return { fx, data }
}

export const COMMANDS = Object.keys(HANDLERS)

/** What a given viewer is allowed to see. */
export function publicState(s: RoomState, viewerId: string | null, online: string[], serverNow: number, hostLastSeenAt: number): PublicState {
  const { library: _lib, ...rest } = s
  void _lib
  const viewer = viewerId ? s.members[viewerId] : null
  const out: PublicState = {
    ...rest,
    serverNow,
    online,
    you: viewer ? { memberId: viewer.id, isHost: s.hostId === viewer.id } : null,
    hostLastSeenAt,
  }
  if (viewer && viewer.role === 'spectator' && !s.config.spectatorsSeeTrades) out.trades = {}
  return out
}
