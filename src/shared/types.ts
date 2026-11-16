// Shared domain model for the IPL Auction War Room.
// All money values are integers in LAKH (₹1 crore = 100 lakh).

export const TEAM_CODES = ['MI', 'CSK', 'RCB', 'KKR', 'DC', 'PBKS', 'RR', 'SRH', 'GT', 'LSG'] as const
export type TeamCode = (typeof TEAM_CODES)[number]

export type Role = 'BAT' | 'WK' | 'AR' | 'FAST' | 'SPIN'
export const ROLES: Role[] = ['BAT', 'WK', 'AR', 'FAST', 'SPIN']
export type PoolTag = 'current' | 'legend'

export interface PlayerStats {
  matches: number
  seasons: number
  batInnings: number
  runs: number
  ballsFaced: number
  notOuts: number
  highScore: number
  highScoreNotOut: boolean
  fifties: number
  hundreds: number
  fours: number
  sixes: number
  battingAvg: number | null
  strikeRate: number | null
  ballsBowled: number
  runsConceded: number
  wickets: number
  bowlingAvg: number | null
  economy: number | null
  bestBowling: string | null
  catches: number
  stumpings: number
}

export interface SeasonTeam {
  season: number
  team: string // franchise name as it was that season
}

export interface Player {
  id: string
  name: string
  shortName: string
  nationality: string
  overseas: boolean
  role: Role
  secondaryRole: Role | null
  battingStyle: string | null
  bowlingStyle: string | null
  iplTeams: string[] // franchise names represented (historical names preserved)
  seasonTeams: SeasonTeam[]
  lastTeam: TeamCode | null // most recent current-franchise team (used for RTM eligibility)
  firstSeason: number | null
  lastSeason: number | null
  /** Real-world IPL status derived from match data, independent of auction status. */
  status: 'active' | 'inactive'
  capped: boolean
  pools: PoolTag[]
  marquee: boolean
  basePrice: number
  category: string
  photoUrl: string | null
  stats: PlayerStats | null
  /** Recent form: stats for the two most recent seasons in the data set. */
  recentStats: PlayerStats | null
  statsSource: string | null
  /** Fields that were inferred or are unverified (shown in the UI). */
  dataNotes: string[]
  custom?: boolean
}

export interface IncrementSlab {
  /** Applies while the current bid is below this amount (lakh). null = no upper bound. */
  upTo: number | null
  step: number
}

export interface AuctionConfig {
  auctionType: 'mega' | 'mini'
  startingPurse: number
  maxSquad: number
  minSquad: number
  maxOverseas: number
  poolMode: 'pools' | 'custom'
  pools: PoolTag[]
  customPoolIds: string[]
  increments: IncrementSlab[]
  allowJumpBids: boolean
  timerSeconds: number // time for the first bid after nomination
  bidTimerSeconds: number // timer resets to this after each bid
  autoProgress: boolean
  autoProgressDelay: number
  reservePurseForMinSquad: boolean
  reserveBasePrice: number
  retentionsEnabled: boolean
  maxRetentions: number
  maxOverseasRetentions: number
  rtmEnabled: boolean
  rtmCardsPerTeam: number
  /** If >0, RTM cards available = min(rtmCardsPerTeam, cap - retentions). */
  rtmCombinedCap: number
  rtmFinalRaise: boolean
  rtmDecisionSeconds: number
  setOrder: string[]
  shuffleWithinSet: boolean
  tradesEnabled: boolean
  tradesDuringAuction: boolean
  tradeRequiresHostApproval: boolean
  tradeCashAllowed: boolean
  spectatorsAllowed: boolean
  spectatorsSeeTrades: boolean
  allowMultipleTeamsPerOwner: boolean
  xiOverseasLimit: number
  hostClaimAfterSeconds: number
}

export type MemberStatus = 'pending' | 'approved' | 'rejected' | 'banned' | 'removed'

export interface Member {
  id: string
  name: string
  role: 'owner' | 'spectator'
  status: MemberStatus
  teamIds: TeamCode[]
  joinedAt: number
  lastSeenAt: number
}

export type AcquiredVia = 'auction' | 'rtm' | 'retained' | 'trade' | 'manual'

export interface SquadEntry {
  playerId: string
  price: number
  via: AcquiredVia
  at: number
  round: number | null
}

export interface Team {
  code: TeamCode
  purse: number
  spent: number
  squad: SquadEntry[]
  rtmCards: number
  rtmUsed: number
  xi: string[]
  captain: string | null
  viceCaptain: string | null
}

export type LotStatus = 'pending' | 'live' | 'sold' | 'unsold' | 'skipped' | 'retained'

export interface Attempt {
  round: number
  startedAt: number
  endedAt: number
  result: 'sold' | 'unsold' | 'skipped' | 'reverted'
  amount: number | null
  team: TeamCode | null
  bidCount: number
  via?: 'auction' | 'rtm' | 'manual'
}

export interface Lot {
  playerId: string
  status: LotStatus
  basePrice: number
  originalBasePrice: number
  set: string
  round: number
  attempts: Attempt[]
  soldTo: TeamCode | null
  soldPrice: number | null
  rtmTeam: TeamCode | null
}

export interface Bid {
  team: TeamCode
  amount: number
  memberId: string
  at: number
}

export type LivePhase = 'bidding' | 'rtm_decision' | 'rtm_raise' | 'rtm_match'

export interface CurrentLot {
  lotKey: string
  playerId: string
  phase: LivePhase
  startedAt: number
  bids: Bid[]
  high: Bid | null
  deadline: number | null
  pausedRemaining: number | null
  rtm: { team: TeamCode; price: number; raisedTo: number | null } | null
}

export interface TradeSide {
  players: string[]
  cash: number
}

export type TradeStatus =
  | 'pending'
  | 'awaiting_host'
  | 'completed'
  | 'rejected'
  | 'countered'
  | 'cancelled'
  | 'vetoed'
  | 'failed'
  | 'reversed'

export interface Trade {
  id: string
  from: TeamCode
  to: TeamCode
  /** What `from` sends to `to`. */
  give: TradeSide
  /** What `from` receives from `to`. */
  receive: TradeSide
  status: TradeStatus
  message: string
  parentId: string | null
  proposedBy: string
  createdAt: number
  resolvedAt: number | null
  resolvedBy: string | null
  failureReason: string | null
  phaseAtProposal: RoomPhase
}

export type TxType = 'sale' | 'trade' | 'manual_assign' | 'sale_correction' | 'sale_revert' | 'purse_adjust'

export interface Transaction {
  id: string
  type: TxType
  at: number
  by: string | null
  undone: boolean
  data: Record<string, unknown>
}

export type RoomPhase = 'lobby' | 'live' | 'completed'

export interface SessionSummary {
  season: number
  auctionType: 'mega' | 'mini'
  endedAt: number
  teams: Record<TeamCode, { purse: number; spent: number; squad: SquadEntry[] }>
  sold: number
  unsold: number
}

export interface RoomState {
  code: string
  name: string
  createdAt: number
  version: number
  archived: boolean
  hostId: string
  pendingHostTransfer: { to: string; requestedAt: number } | null
  members: Record<string, Member>
  config: AuctionConfig
  phase: RoomPhase
  paused: boolean
  season: number
  round: number
  roundType: 'main' | 'unsold'
  teams: Record<TeamCode, Team>
  lots: Record<string, Lot>
  queue: string[]
  current: CurrentLot | null
  autoNextAt: number | null
  trades: Record<string, Trade>
  ledger: Transaction[]
  sessions: SessionSummary[]
  /** Players released by a franchise between seasons (RTM eligibility). */
  releasedBy: Record<string, TeamCode>
  /** Player library for this room (not broadcast with state; sent separately). */
  library: Record<string, Player>
  libraryVersion: number
  startedAt: number | null
  completedAt: number | null
}

/** State as broadcast to clients. */
export interface PublicState extends Omit<RoomState, 'library'> {
  serverNow: number
  online: string[]
  you: { memberId: string; isHost: boolean } | null
  hostLastSeenAt: number
}

export interface Notice {
  kind: 'info' | 'success' | 'warning' | 'trade' | 'host'
  text: string
  /** Restrict to these member ids; undefined = everyone. */
  to?: string[]
}

export interface RoomEvent {
  seq: number
  ts: number
  type: string
  actor: string | null
  data: Record<string, unknown>
}

export type CmdResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string }
