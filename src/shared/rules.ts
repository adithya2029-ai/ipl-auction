import type {
  AuctionConfig,
  IncrementSlab,
  Player,
  Role,
  RoomState,
  Team,
  TeamCode,
} from './types'
import { TEAM_CODES } from './types'

export const TEAM_META: Record<TeamCode, { name: string; short: string; primary: string; accent: string }> = {
  MI: { name: 'Mumbai Indians', short: 'MI', primary: '#0b4ea2', accent: '#d1ab3e' },
  CSK: { name: 'Chennai Super Kings', short: 'CSK', primary: '#f5c400', accent: '#1a3f8f' },
  RCB: { name: 'Royal Challengers Bengaluru', short: 'RCB', primary: '#d1171f', accent: '#1c1c1c' },
  KKR: { name: 'Kolkata Knight Riders', short: 'KKR', primary: '#3a225d', accent: '#b3a123' },
  DC: { name: 'Delhi Capitals', short: 'DC', primary: '#17479e', accent: '#ef1b23' },
  PBKS: { name: 'Punjab Kings', short: 'PBKS', primary: '#d71920', accent: '#a7a9ac' },
  RR: { name: 'Rajasthan Royals', short: 'RR', primary: '#e4167f', accent: '#254aa5' },
  SRH: { name: 'Sunrisers Hyderabad', short: 'SRH', primary: '#f26522', accent: '#1a1a1a' },
  GT: { name: 'Gujarat Titans', short: 'GT', primary: '#1c2c5b', accent: '#b8975c' },
  LSG: { name: 'Lucknow Super Giants', short: 'LSG', primary: '#0f4c9c', accent: '#e8542f' },
}

/** Maps franchise names (including historical names) to a current franchise code. */
export const FRANCHISE_ALIASES: Record<string, TeamCode> = {
  'Mumbai Indians': 'MI',
  'Chennai Super Kings': 'CSK',
  'Royal Challengers Bangalore': 'RCB',
  'Royal Challengers Bengaluru': 'RCB',
  'Kolkata Knight Riders': 'KKR',
  'Delhi Daredevils': 'DC',
  'Delhi Capitals': 'DC',
  'Kings XI Punjab': 'PBKS',
  'Punjab Kings': 'PBKS',
  'Rajasthan Royals': 'RR',
  'Sunrisers Hyderabad': 'SRH',
  'Gujarat Titans': 'GT',
  'Lucknow Super Giants': 'LSG',
}

export const ROLE_LABEL: Record<Role, string> = {
  BAT: 'Batter',
  WK: 'Wicketkeeper',
  AR: 'All-rounder',
  FAST: 'Fast bowler',
  SPIN: 'Spin bowler',
}
export const ROLE_PLURAL: Record<Role, string> = {
  BAT: 'Batters',
  WK: 'Wicketkeepers',
  AR: 'All-rounders',
  FAST: 'Fast Bowlers',
  SPIN: 'Spinners',
}

export function categoryFor(p: Pick<Player, 'capped' | 'role' | 'pools' | 'status'>): string {
  const tier = p.pools.includes('legend') && p.status === 'inactive' ? 'Legend' : p.capped ? 'Capped' : 'Uncapped'
  return `${tier} ${ROLE_PLURAL[p.role]}`
}

export const DEFAULT_SET_ORDER: string[] = [
  'Marquee',
  ...(['Capped', 'Legend', 'Uncapped'] as const).flatMap((t) =>
    (['BAT', 'WK', 'AR', 'FAST', 'SPIN'] as Role[]).map((r) => `${t} ${ROLE_PLURAL[r]}`),
  ),
]

export const DEFAULT_INCREMENTS: IncrementSlab[] = [
  { upTo: 100, step: 5 },
  { upTo: 200, step: 10 },
  { upTo: 500, step: 20 },
  { upTo: null, step: 25 },
]

export function defaultConfig(): AuctionConfig {
  return {
    auctionType: 'mega',
    startingPurse: 12000,
    maxSquad: 25,
    minSquad: 18,
    maxOverseas: 8,
    poolMode: 'pools',
    pools: ['current'],
    customPoolIds: [],
    increments: DEFAULT_INCREMENTS.map((s) => ({ ...s })),
    allowJumpBids: true,
    timerSeconds: 20,
    bidTimerSeconds: 12,
    autoProgress: false,
    autoProgressDelay: 5,
    reservePurseForMinSquad: true,
    reserveBasePrice: 30,
    retentionsEnabled: false,
    maxRetentions: 6,
    maxOverseasRetentions: 2,
    rtmEnabled: false,
    rtmCardsPerTeam: 0,
    rtmCombinedCap: 6,
    rtmFinalRaise: true,
    rtmDecisionSeconds: 15,
    setOrder: [...DEFAULT_SET_ORDER],
    shuffleWithinSet: false,
    tradesEnabled: true,
    tradesDuringAuction: true,
    tradeRequiresHostApproval: false,
    tradeCashAllowed: true,
    spectatorsAllowed: true,
    spectatorsSeeTrades: true,
    allowMultipleTeamsPerOwner: false,
    xiOverseasLimit: 4,
    hostClaimAfterSeconds: 60,
  }
}

export function stepFor(current: number, slabs: IncrementSlab[]): number {
  for (const s of slabs) if (s.upTo === null || current < s.upTo) return s.step
  return slabs[slabs.length - 1]?.step ?? 5
}

/** Minimum valid next bid given the current highest bid (null = no bids yet). */
export function minNextBid(high: number | null, basePrice: number, slabs: IncrementSlab[]): number {
  if (high === null) return basePrice
  return high + stepFor(high, slabs)
}

export function overseasCount(team: Team, lib: Record<string, Player>): number {
  return team.squad.reduce((n, e) => n + (lib[e.playerId]?.overseas ? 1 : 0), 0)
}

/** Money a team must keep back to fill its minimum squad at the reserve price. */
export function reserveFor(team: Team, cfg: AuctionConfig, extraPlayers = 1): number {
  if (!cfg.reservePurseForMinSquad) return 0
  const remainingSlots = Math.max(0, cfg.minSquad - (team.squad.length + extraPlayers))
  return remainingSlots * cfg.reserveBasePrice
}

/** Amount currently committed by a team as the highest bidder on the live lot. */
export function committedFor(state: Pick<RoomState, 'current'>, code: TeamCode): number {
  const c = state.current
  if (!c) return 0
  if (c.phase === 'bidding' && c.high?.team === code) return c.high.amount
  if (c.rtm) {
    // during RTM phases both the winner and the RTM team may end up paying
    const amt = c.rtm.raisedTo ?? c.rtm.price
    if (c.high?.team === code || c.rtm.team === code) return amt
  }
  return 0
}

export function maxBidFor(team: Team, cfg: AuctionConfig): number {
  return Math.max(0, team.purse - reserveFor(team, cfg))
}

export function formatMoney(lakh: number | null | undefined): string {
  if (lakh === null || lakh === undefined || Number.isNaN(lakh)) return '—'
  const neg = lakh < 0
  const v = Math.abs(lakh)
  let s: string
  if (v >= 100) {
    const cr = v / 100
    s = `₹${cr % 1 === 0 ? cr.toFixed(0) : cr.toFixed(2).replace(/0$/, '')} Cr`
  } else s = `₹${v} L`
  return neg ? `−${s}` : s
}

/** Parses "2.5cr", "250", "250L", "₹1.25 Cr" into lakh. Bare numbers are lakh. */
export function parseMoney(input: string): number | null {
  const t = input.trim().toLowerCase().replace(/[₹,\s]/g, '')
  const m = t.match(/^(-?\d+(?:\.\d+)?)(cr|crore|l|lakh|lac)?$/)
  if (!m) return null
  const n = parseFloat(m[1])
  const unit = m[2]
  const v = unit && unit.startsWith('c') ? n * 100 : n
  return Math.round(v)
}

export function teamName(code: TeamCode | null | undefined): string {
  return code ? TEAM_META[code].name : '—'
}

export function emptyTeams(cfg: AuctionConfig): Record<TeamCode, Team> {
  const out = {} as Record<TeamCode, Team>
  for (const code of TEAM_CODES)
    out[code] = {
      code,
      purse: cfg.startingPurse,
      spent: 0,
      squad: [],
      rtmCards: 0,
      rtmUsed: 0,
      xi: [],
      captain: null,
      viceCaptain: null,
    }
  return out
}

export function roleCounts(team: Team, lib: Record<string, Player>): Record<Role, number> {
  const c: Record<Role, number> = { BAT: 0, WK: 0, AR: 0, FAST: 0, SPIN: 0 }
  for (const e of team.squad) {
    const p = lib[e.playerId]
    if (p) c[p.role]++
  }
  return c
}

export function setIndex(set: string, order: string[]): number {
  const i = order.indexOf(set)
  return i === -1 ? order.length : i
}
