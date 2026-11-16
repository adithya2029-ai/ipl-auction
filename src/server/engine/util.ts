import { formatMoney } from '../../shared/rules'
import type { Member, Notice, Player, RoomState, Team, TeamCode } from '../../shared/types'
import { TEAM_CODES } from '../../shared/types'
import { overseasCount, reserveFor } from '../../shared/rules'

export class CmdError extends Error {}

export interface Ctx {
  now: number
  /** null = system (timers, server-internal). */
  actorId: string | null
  online: Set<string>
  /** ms timestamp since which the current host has been offline (null = online). */
  hostOfflineSince: number | null
  random: () => number
  id: () => string
}

export interface Effects {
  events: { type: string; data: Record<string, unknown> }[]
  notices: Notice[]
  libraryChanged: boolean
  /** Member ids whose sockets must be disconnected (bans/removals). */
  kick: string[]
}

export interface Api {
  s: RoomState
  ctx: Ctx
  fx: Effects
}

export const fail = (msg: string): never => {
  throw new CmdError(msg)
}

export function ensure(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new CmdError(msg)
}

export function emit(a: Api, type: string, data: Record<string, unknown> = {}) {
  a.fx.events.push({ type, data })
}

export function notify(a: Api, kind: Notice['kind'], text: string, to?: string[]) {
  a.fx.notices.push(to ? { kind, text, to } : { kind, text })
}

export function actor(a: Api): Member {
  const id = a.ctx.actorId
  ensure(id, 'Not signed in')
  const m = a.s.members[id]
  ensure(m, 'Unknown participant')
  ensure(m.status === 'approved', 'Your access has not been approved')
  return m
}

export function requireHost(a: Api): Member {
  const m = actor(a)
  ensure(a.s.hostId === m.id, 'Only the host can do that')
  return m
}

export function isTeamCode(x: unknown): x is TeamCode {
  return typeof x === 'string' && (TEAM_CODES as readonly string[]).includes(x)
}

export function controls(m: Member, team: TeamCode): boolean {
  return m.status === 'approved' && m.role === 'owner' && m.teamIds.includes(team)
}

export function requireTeam(a: Api, team: unknown): { m: Member; team: TeamCode } {
  const m = actor(a)
  ensure(isTeamCode(team), 'Unknown franchise')
  ensure(controls(m, team), `You do not control ${team}`)
  return { m, team }
}

export function ownersOf(s: RoomState, team: TeamCode): string[] {
  return Object.values(s.members)
    .filter((m) => controls(m, team))
    .map((m) => m.id)
}

export function player(s: RoomState, id: string): Player {
  const p = s.library[id]
  ensure(p, 'Unknown player')
  return p
}

export function teamOf(s: RoomState, playerId: string): TeamCode | null {
  for (const code of TEAM_CODES) if (s.teams[code].squad.some((e) => e.playerId === playerId)) return code
  return null
}

/** Returns a reason the team cannot acquire this player at this price, or null if it can. */
export function acquireBlocker(s: RoomState, team: Team, playerId: string, amount: number): string | null {
  const cfg = s.config
  const p = s.library[playerId]
  if (!p) return 'Unknown player'
  if (team.squad.some((e) => e.playerId === playerId)) return 'Player already in squad'
  if (team.squad.length >= cfg.maxSquad) return `${team.code} squad is full (${cfg.maxSquad})`
  if (p.overseas && overseasCount(team, s.library) >= cfg.maxOverseas)
    return `${team.code} has reached the overseas limit (${cfg.maxOverseas})`
  const reserve = reserveFor(team, cfg)
  if (amount > team.purse - reserve) {
    const max = Math.max(0, team.purse - reserve)
    return reserve > 0
      ? `${team.code} can bid at most ${formatMoney(max)} (keeping ${formatMoney(reserve)} to complete the minimum squad)`
      : `${team.code} has only ${formatMoney(team.purse)} remaining`
  }
  return null
}

export function intIn(v: unknown, min: number, max: number, label: string): number {
  ensure(typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v), `${label} must be a whole number`)
  ensure(v >= min && v <= max, `${label} must be between ${min} and ${max}`)
  return v
}

export function removeFromLineup(team: Team, playerId: string) {
  team.xi = team.xi.filter((x) => x !== playerId)
  if (team.captain === playerId) team.captain = null
  if (team.viceCaptain === playerId) team.viceCaptain = null
}
