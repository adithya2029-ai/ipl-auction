import type { AuctionConfig, IncrementSlab, Player, PoolTag, Role, TeamCode } from '../../shared/types'
import { ROLES, TEAM_CODES } from '../../shared/types'
import { categoryFor, overseasCount } from '../../shared/rules'
import { recomputeLobbyPurses, orderIds } from './auction'
import { type Api, actor, controls, emit, ensure, fail, intIn, isTeamCode, notify, requireHost, teamOf } from './util'

// ---------------------------------------------------------------- members

function target(a: Api, id: unknown) {
  ensure(typeof id === 'string' && a.s.members[id], 'Unknown participant')
  return a.s.members[id as string]
}

function ownerCount(a: Api) {
  return Object.values(a.s.members).filter((m) => m.status === 'approved' && m.role === 'owner').length
}

function teamHolder(a: Api, team: TeamCode) {
  return Object.values(a.s.members).find((m) => m.status === 'approved' && m.teamIds.includes(team)) ?? null
}

function giveTeam(a: Api, memberId: string, team: TeamCode) {
  const m = a.s.members[memberId]
  for (const other of Object.values(a.s.members)) if (other.id !== memberId) other.teamIds = other.teamIds.filter((t) => t !== team)
  if (!a.s.config.allowMultipleTeamsPerOwner) m.teamIds = []
  if (!m.teamIds.includes(team)) m.teamIds.push(team)
}

export function approveMember(a: Api, p: { memberId?: unknown; role?: unknown; team?: unknown }) {
  requireHost(a)
  const m = target(a, p.memberId)
  ensure(m.status === 'pending', 'This request is not pending')
  const role = p.role === 'spectator' || (p.role === undefined && m.role === 'spectator') ? 'spectator' : 'owner'
  if (role === 'spectator') ensure(a.s.config.spectatorsAllowed, 'Spectators are disabled in this room')
  else ensure(ownerCount(a) < 10, 'All 10 franchise slots are filled')
  m.role = role
  m.status = 'approved'
  if (role === 'owner' && isTeamCode(p.team)) {
    ensure(!teamHolder(a, p.team), `${p.team} is already taken`)
    giveTeam(a, m.id, p.team)
  }
  emit(a, 'member_approved', { memberId: m.id, name: m.name, role, team: m.teamIds[0] ?? null })
  notify(a, 'info', `${m.name} joined as ${role === 'owner' ? 'a franchise owner' : 'a spectator'}`)
}

export function rejectMember(a: Api, p: { memberId?: unknown }) {
  requireHost(a)
  const m = target(a, p.memberId)
  ensure(m.status === 'pending', 'This request is not pending')
  m.status = 'rejected'
  a.fx.kick.push(m.id)
  emit(a, 'member_rejected', { memberId: m.id, name: m.name })
}

export function removeMember(a: Api, p: { memberId?: unknown; ban?: unknown }) {
  const host = requireHost(a)
  const m = target(a, p.memberId)
  ensure(m.id !== host.id, 'Transfer host privileges before leaving')
  m.status = p.ban ? 'banned' : 'removed'
  const teams = m.teamIds
  m.teamIds = []
  if (a.s.pendingHostTransfer?.to === m.id) a.s.pendingHostTransfer = null
  a.fx.kick.push(m.id)
  emit(a, p.ban ? 'member_banned' : 'member_removed', { memberId: m.id, name: m.name, teams })
  notify(a, 'host', `${m.name} was ${p.ban ? 'banned' : 'removed'}${teams.length ? `; ${teams.join(', ')} now has no owner` : ''}`)
}

export function unbanMember(a: Api, p: { memberId?: unknown }) {
  requireHost(a)
  const m = target(a, p.memberId)
  ensure(m.status === 'banned' || m.status === 'removed' || m.status === 'rejected', 'Participant is not banned or removed')
  m.status = 'pending'
  emit(a, 'member_unbanned', { memberId: m.id, name: m.name })
}

export function claimTeam(a: Api, p: { team?: unknown }) {
  const m = actor(a)
  ensure(m.role === 'owner', 'Spectators cannot own a franchise')
  ensure(isTeamCode(p.team), 'Unknown franchise')
  ensure(!teamHolder(a, p.team), `${p.team} is already taken`)
  if (!a.s.config.allowMultipleTeamsPerOwner && m.teamIds.length) {
    ensure(a.s.phase === 'lobby', 'You already own a franchise; ask the host to reassign')
  }
  giveTeam(a, m.id, p.team)
  emit(a, 'team_claimed', { memberId: m.id, team: p.team })
}

export function releaseTeam(a: Api, p: { team?: unknown }) {
  const m = actor(a)
  ensure(isTeamCode(p.team) && m.teamIds.includes(p.team), 'You do not own that franchise')
  m.teamIds = m.teamIds.filter((t) => t !== p.team)
  emit(a, 'team_released', { memberId: m.id, team: p.team })
}

export function assignTeam(a: Api, p: { memberId?: unknown; team?: unknown }) {
  requireHost(a)
  ensure(isTeamCode(p.team), 'Unknown franchise')
  if (p.memberId === null) {
    for (const m of Object.values(a.s.members)) m.teamIds = m.teamIds.filter((t) => t !== p.team)
    emit(a, 'team_unassigned', { team: p.team })
    return
  }
  const m = target(a, p.memberId)
  ensure(m.status === 'approved', 'Participant is not approved')
  if (m.role !== 'owner') {
    ensure(ownerCount(a) < 10, 'All 10 franchise slots are filled')
    m.role = 'owner'
  }
  giveTeam(a, m.id, p.team)
  emit(a, 'team_assigned', { memberId: m.id, team: p.team })
}

export function setMemberRole(a: Api, p: { memberId?: unknown; role?: unknown }) {
  requireHost(a)
  const m = target(a, p.memberId)
  ensure(m.status === 'approved', 'Participant is not approved')
  if (p.role === 'spectator') {
    m.role = 'spectator'
    m.teamIds = []
  } else {
    ensure(ownerCount(a) < 10 || m.role === 'owner', 'All 10 franchise slots are filled')
    m.role = 'owner'
  }
  emit(a, 'member_role', { memberId: m.id, role: m.role })
}

// ---------------------------------------------------------------- host transfer

export function requestHostTransfer(a: Api, p: { memberId?: unknown }) {
  const host = requireHost(a)
  const m = target(a, p.memberId)
  ensure(m.id !== host.id, 'You are already the host')
  ensure(m.status === 'approved', 'Only approved participants can become host')
  a.s.pendingHostTransfer = { to: m.id, requestedAt: a.ctx.now }
  emit(a, 'host_transfer_requested', { from: host.id, to: m.id })
  notify(a, 'host', `${host.name} wants to hand host controls to you. Accept from the banner.`, [m.id])
}

export function respondHostTransfer(a: Api, p: { accept?: unknown }) {
  const m = actor(a)
  const pend = a.s.pendingHostTransfer
  ensure(pend && pend.to === m.id, 'There is no host transfer waiting for you')
  a.s.pendingHostTransfer = null
  if (!p.accept) {
    emit(a, 'host_transfer_declined', { to: m.id })
    notify(a, 'host', `${m.name} declined host controls`, [a.s.hostId])
    return
  }
  const from = a.s.hostId
  a.s.hostId = m.id
  emit(a, 'host_changed', { from, to: m.id, reason: 'transfer' })
  notify(a, 'host', `${m.name} is now the host`)
}

export function cancelHostTransfer(a: Api) {
  requireHost(a)
  ensure(a.s.pendingHostTransfer, 'No transfer pending')
  a.s.pendingHostTransfer = null
  emit(a, 'host_transfer_cancelled', {})
}

export function claimHost(a: Api) {
  const m = actor(a)
  const { s, ctx } = a
  ensure(s.hostId !== m.id, 'You are already the host')
  const since = ctx.hostOfflineSince
  ensure(since !== null, 'The host is online')
  const wait = s.config.hostClaimAfterSeconds * 1000
  ensure(ctx.now - since >= wait, `The host has been offline for ${Math.floor((ctx.now - since) / 1000)}s; claiming is allowed after ${s.config.hostClaimAfterSeconds}s`)
  const from = s.hostId
  s.hostId = m.id
  s.pendingHostTransfer = null
  emit(a, 'host_changed', { from, to: m.id, reason: 'claimed_while_host_offline' })
  notify(a, 'host', `${m.name} claimed host controls (previous host offline)`)
}

// ---------------------------------------------------------------- config

const LIVE_SAFE: (keyof AuctionConfig)[] = [
  'timerSeconds', 'bidTimerSeconds', 'autoProgress', 'autoProgressDelay', 'increments', 'allowJumpBids',
  'tradesEnabled', 'tradesDuringAuction', 'tradeRequiresHostApproval', 'tradeCashAllowed', 'spectatorsAllowed',
  'spectatorsSeeTrades', 'xiOverseasLimit', 'hostClaimAfterSeconds', 'rtmDecisionSeconds', 'setOrder',
  'shuffleWithinSet', 'maxSquad', 'minSquad', 'maxOverseas', 'reservePurseForMinSquad', 'reserveBasePrice',
  'rtmFinalRaise', 'allowMultipleTeamsPerOwner',
]

function validIncrements(v: unknown): IncrementSlab[] {
  ensure(Array.isArray(v) && v.length > 0 && v.length <= 12, 'Provide 1–12 increment slabs')
  const out = v.map((x, i) => {
    const r = x as Record<string, unknown>
    const step = intIn(r.step, 1, 100000, `Increment ${i + 1}`)
    const upTo = r.upTo === null || r.upTo === undefined || r.upTo === '' ? null : intIn(Number(r.upTo), 1, 10_000_000, `Slab ${i + 1} limit`)
    return { upTo, step }
  })
  for (let i = 0; i < out.length; i++) {
    if (i < out.length - 1) ensure(out[i].upTo !== null, 'Only the last increment slab can be open-ended')
    if (i > 0 && out[i].upTo !== null) ensure(out[i].upTo! > out[i - 1].upTo!, 'Increment slabs must be in ascending order')
  }
  out[out.length - 1].upTo = null
  return out
}

export function updateConfig(a: Api, patch: unknown) {
  requireHost(a)
  const { s, ctx } = a
  ensure(patch && typeof patch === 'object', 'Invalid settings')
  const p = patch as Partial<Record<keyof AuctionConfig, unknown>>
  const keys = Object.keys(p) as (keyof AuctionConfig)[]
  if (s.phase !== 'lobby') {
    const unsafe = keys.filter((k) => !LIVE_SAFE.includes(k))
    if (unsafe.length) fail(`These settings are locked once the auction starts: ${unsafe.join(', ')}`)
  }
  const c = { ...s.config }
  const bool = (k: keyof AuctionConfig) => {
    ensure(typeof p[k] === 'boolean', `${k} must be true or false`)
    ;(c as Record<string, unknown>)[k] = p[k]
  }
  for (const k of keys) {
    const v = p[k]
    switch (k) {
      case 'auctionType':
        ensure(v === 'mega' || v === 'mini', 'Auction type must be mega or mini')
        c.auctionType = v
        break
      case 'startingPurse': c.startingPurse = intIn(v, 100, 1_000_000, 'Starting purse'); break
      case 'maxSquad': c.maxSquad = intIn(v, 1, 60, 'Maximum squad'); break
      case 'minSquad': c.minSquad = intIn(v, 0, 60, 'Minimum squad'); break
      case 'maxOverseas': c.maxOverseas = intIn(v, 0, 60, 'Overseas limit'); break
      case 'poolMode': ensure(v === 'pools' || v === 'custom', 'Invalid pool mode'); c.poolMode = v; break
      case 'pools':
        ensure(Array.isArray(v) && v.length > 0 && v.every((x) => x === 'current' || x === 'legend'), 'Choose at least one player pool')
        c.pools = [...new Set(v as PoolTag[])]
        break
      case 'customPoolIds':
        ensure(Array.isArray(v) && v.every((x) => typeof x === 'string'), 'Invalid custom pool')
        c.customPoolIds = [...new Set((v as string[]).filter((id) => s.library[id]))]
        break
      case 'increments': c.increments = validIncrements(v); break
      case 'timerSeconds': c.timerSeconds = intIn(v, 3, 600, 'Timer'); break
      case 'bidTimerSeconds': c.bidTimerSeconds = intIn(v, 3, 600, 'Bid timer'); break
      case 'autoProgressDelay': c.autoProgressDelay = intIn(v, 1, 120, 'Auto-progress delay'); break
      case 'reserveBasePrice': c.reserveBasePrice = intIn(v, 0, 10000, 'Reserve price'); break
      case 'maxRetentions': c.maxRetentions = intIn(v, 0, 60, 'Max retentions'); break
      case 'maxOverseasRetentions': c.maxOverseasRetentions = intIn(v, 0, 60, 'Max overseas retentions'); break
      case 'rtmCardsPerTeam': c.rtmCardsPerTeam = intIn(v, 0, 20, 'RTM cards'); break
      case 'rtmCombinedCap': c.rtmCombinedCap = intIn(v, 0, 60, 'Retention + RTM cap'); break
      case 'rtmDecisionSeconds': c.rtmDecisionSeconds = intIn(v, 3, 300, 'RTM decision time'); break
      case 'xiOverseasLimit': c.xiOverseasLimit = intIn(v, 0, 11, 'Playing XI overseas limit'); break
      case 'hostClaimAfterSeconds': c.hostClaimAfterSeconds = intIn(v, 10, 3600, 'Host claim delay'); break
      case 'setOrder':
        ensure(Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length < 60) && v.length <= 60, 'Invalid set order')
        c.setOrder = [...new Set(v as string[])]
        break
      case 'autoProgress': case 'allowJumpBids': case 'reservePurseForMinSquad': case 'retentionsEnabled':
      case 'rtmEnabled': case 'rtmFinalRaise': case 'shuffleWithinSet': case 'tradesEnabled': case 'tradesDuringAuction':
      case 'tradeRequiresHostApproval': case 'tradeCashAllowed': case 'spectatorsAllowed': case 'spectatorsSeeTrades':
      case 'allowMultipleTeamsPerOwner':
        bool(k)
        break
      default:
        fail(`Unknown setting: ${k}`)
    }
  }
  ensure(c.minSquad <= c.maxSquad, 'Minimum squad size cannot exceed maximum squad size')
  if (s.phase !== 'lobby') {
    for (const code of TEAM_CODES) {
      const t = s.teams[code]
      ensure(t.squad.length <= c.maxSquad, `${code} already has ${t.squad.length} players; maximum squad cannot be lower`)
      ensure(overseasCount(t, s.library) <= c.maxOverseas, `${code} already exceeds that overseas limit`)
    }
  }
  if (!c.allowMultipleTeamsPerOwner)
    for (const m of Object.values(s.members))
      ensure(m.teamIds.length <= 1, `${m.name} owns several franchises; reassign before disabling this`)
  const orderChanged = keys.includes('setOrder') || keys.includes('shuffleWithinSet')
  s.config = c
  if (orderChanged && s.phase === 'live') s.queue = orderIds(s, s.queue, ctx.random)
  if (keys.includes('autoProgress') && s.phase === 'live') {
    s.autoNextAt = c.autoProgress && !s.current && !s.paused && s.queue.length ? ctx.now + c.autoProgressDelay * 1000 : null
  }
  recomputeLobbyPurses(s)
  emit(a, 'config_updated', { keys })
}

// ---------------------------------------------------------------- library

const STR = (v: unknown, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export function sanitizePlayer(raw: Record<string, unknown>, base?: Player): Player {
  const name = STR(raw.name ?? base?.name)
  ensure(name, 'Player name is required')
  const role = (raw.role ?? base?.role) as Role
  ensure(ROLES.includes(role), `Role must be one of ${ROLES.join(', ')}`)
  const sec = raw.secondaryRole === undefined ? base?.secondaryRole ?? null : raw.secondaryRole || null
  ensure(sec === null || ROLES.includes(sec as Role), 'Invalid secondary role')
  const nationality = STR(raw.nationality ?? base?.nationality ?? 'India', 60) || 'India'
  const overseas = typeof raw.overseas === 'boolean' ? raw.overseas : raw.nationality !== undefined || !base ? nationality.toLowerCase() !== 'india' : base.overseas
  const basePrice = intIn(Number(raw.basePrice ?? base?.basePrice ?? 30), 1, 100000, 'Base price')
  const poolsRaw = raw.pools ?? base?.pools ?? ['current']
  ensure(Array.isArray(poolsRaw) && poolsRaw.every((x) => x === 'current' || x === 'legend') && poolsRaw.length > 0, 'Pools must include current and/or legend')
  const pools = [...new Set(poolsRaw as PoolTag[])]
  const status = raw.status === 'active' || raw.status === 'inactive' ? raw.status : base?.status ?? (pools.includes('current') ? 'active' : 'inactive')
  const capped = typeof raw.capped === 'boolean' ? raw.capped : base?.capped ?? overseas
  const lastTeam = raw.lastTeam === undefined ? base?.lastTeam ?? null : isTeamCode(raw.lastTeam) ? raw.lastTeam : null
  const photo = raw.photoUrl === undefined ? base?.photoUrl ?? null : STR(raw.photoUrl, 500) || null
  ensure(!photo || /^https?:\/\//.test(photo), 'Photo must be an http(s) URL')
  const p: Player = {
    id: base?.id ?? '',
    name,
    shortName: STR(raw.shortName ?? base?.shortName ?? name) || name,
    nationality,
    overseas,
    role,
    secondaryRole: (sec as Role | null) === role ? null : (sec as Role | null),
    battingStyle: raw.battingStyle === undefined ? base?.battingStyle ?? null : STR(raw.battingStyle, 60) || null,
    bowlingStyle: raw.bowlingStyle === undefined ? base?.bowlingStyle ?? null : STR(raw.bowlingStyle, 60) || null,
    iplTeams: Array.isArray(raw.iplTeams) ? raw.iplTeams.map((x) => STR(x, 60)).filter(Boolean) : base?.iplTeams ?? [],
    seasonTeams: base?.seasonTeams ?? [],
    lastTeam,
    firstSeason: base?.firstSeason ?? null,
    lastSeason: base?.lastSeason ?? null,
    status,
    capped,
    pools,
    marquee: typeof raw.marquee === 'boolean' ? raw.marquee : base?.marquee ?? false,
    basePrice,
    category: '',
    photoUrl: photo,
    stats: base?.stats ?? null,
    recentStats: base?.recentStats ?? null,
    statsSource: base?.statsSource ?? null,
    dataNotes: base ? base.dataNotes.filter((n) => !(raw.role || raw.bowlingStyle || raw.battingStyle) || !/inferred|unverified|derived/i.test(n)) : ['Custom player (no verified statistics)'],
    custom: base?.custom ?? true,
  }
  if (raw.stats && typeof raw.stats === 'object') p.stats = { ...(p.stats ?? emptyStats()), ...(raw.stats as object) }
  p.category = categoryFor(p)
  return p
}

export function emptyStats() {
  return {
    matches: 0, seasons: 0, batInnings: 0, runs: 0, ballsFaced: 0, notOuts: 0, highScore: 0, highScoreNotOut: false,
    fifties: 0, hundreds: 0, fours: 0, sixes: 0, battingAvg: null, strikeRate: null, ballsBowled: 0, runsConceded: 0,
    wickets: 0, bowlingAvg: null, economy: null, bestBowling: null, catches: 0, stumpings: 0,
  }
}

function newId(a: Api, name: string) {
  const base = 'c-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40)
  let id = base
  let n = 2
  while (a.s.library[id]) id = `${base}-${n++}`
  return id
}

function syncLot(a: Api, p: Player) {
  const lot = a.s.lots[p.id]
  if (lot && ['pending', 'unsold', 'skipped'].includes(lot.status)) {
    lot.basePrice = p.basePrice
    lot.set = p.marquee ? 'Marquee' : p.category
  }
}

export function addPlayer(a: Api, raw: unknown) {
  requireHost(a)
  ensure(raw && typeof raw === 'object', 'Invalid player')
  const p = sanitizePlayer(raw as Record<string, unknown>)
  p.id = newId(a, p.name)
  a.s.library = { ...a.s.library, [p.id]: p }
  a.fx.libraryChanged = true
  emit(a, 'player_added', { playerId: p.id, name: p.name })
  return { playerId: p.id }
}

export function updatePlayer(a: Api, p: { playerId?: unknown; patch?: unknown }) {
  requireHost(a)
  ensure(typeof p.playerId === 'string' && a.s.library[p.playerId], 'Unknown player')
  ensure(p.patch && typeof p.patch === 'object', 'Invalid changes')
  const base = a.s.library[p.playerId]
  const patch = p.patch as Record<string, unknown>
  const lot = a.s.lots[base.id]
  const owned = teamOf(a.s, base.id)
  if ((owned || (lot && lot.status === 'live')) && 'overseas' in patch && patch.overseas !== base.overseas)
    fail('Overseas status cannot change while the player is owned or under the hammer')
  if (owned && 'nationality' in patch && (String(patch.nationality).toLowerCase() !== 'india') !== base.overseas)
    fail('Nationality change would alter overseas status of an owned player')
  if (lot?.status === 'live' && 'basePrice' in patch && a.s.current?.bids.length) fail('Cannot change base price after bidding started')
  const next = sanitizePlayer(patch, base)
  a.s.library = { ...a.s.library, [base.id]: next }
  syncLot(a, next)
  a.fx.libraryChanged = true
  emit(a, 'player_updated', { playerId: base.id, fields: Object.keys(patch) })
}

export function bulkUpdatePlayers(a: Api, p: { ids?: unknown; patch?: unknown }) {
  requireHost(a)
  ensure(Array.isArray(p.ids) && p.ids.length > 0, 'Select players')
  const patch = (p.patch ?? {}) as Record<string, unknown>
  const allowed = ['basePrice', 'marquee', 'pools']
  ensure(Object.keys(patch).every((k) => allowed.includes(k)), 'Bulk edit supports base price, marquee and pools only')
  const lib = { ...a.s.library }
  for (const id of p.ids) {
    if (typeof id !== 'string' || !lib[id]) continue
    const lot = a.s.lots[id]
    if (lot && !['pending', 'unsold', 'skipped'].includes(lot.status) && 'basePrice' in patch) continue
    lib[id] = sanitizePlayer(patch, lib[id])
  }
  a.s.library = lib
  for (const id of p.ids as string[]) if (lib[id]) syncLot(a, lib[id])
  a.fx.libraryChanged = true
  emit(a, 'players_bulk_updated', { count: p.ids.length, fields: Object.keys(patch) })
}

export function removePlayer(a: Api, p: { playerId?: unknown }) {
  requireHost(a)
  ensure(typeof p.playerId === 'string' && a.s.library[p.playerId], 'Unknown player')
  const id = p.playerId
  ensure(!teamOf(a.s, id), 'Cannot remove a player who belongs to a squad')
  const lot = a.s.lots[id]
  ensure(!lot || (lot.status !== 'live' && lot.attempts.length === 0), 'Cannot remove a player with auction history')
  if (lot) {
    delete a.s.lots[id]
    a.s.queue = a.s.queue.filter((x) => x !== id)
  }
  const lib = { ...a.s.library }
  delete lib[id]
  a.s.library = lib
  a.s.config.customPoolIds = a.s.config.customPoolIds.filter((x) => x !== id)
  for (const t of Object.values(a.s.trades)) ensure(!(t.status === 'pending' || t.status === 'awaiting_host') || ![...t.give.players, ...t.receive.players].includes(id), 'Player is in a pending trade')
  a.fx.libraryChanged = true
  emit(a, 'player_removed', { playerId: id })
}

export function importPlayers(a: Api, p: { rows?: unknown; addToPool?: unknown }) {
  requireHost(a)
  ensure(Array.isArray(p.rows) && p.rows.length > 0, 'No rows to import')
  ensure(p.rows.length <= 2000, 'Import at most 2000 players at a time')
  const lib = { ...a.s.library }
  const byName = new Map(Object.values(lib).map((x) => [x.name.toLowerCase(), x]))
  const errors: string[] = []
  let added = 0
  let updated = 0
  const ids: string[] = []
  for (const [i, r] of p.rows.entries()) {
    try {
      const row = normaliseRow(r as Record<string, unknown>)
      const existing: Player | undefined = (typeof row.id === 'string' ? lib[row.id] : undefined) ?? byName.get(String(row.name).toLowerCase())
      if (existing) {
        const next = sanitizePlayer(row, existing)
        if (teamOf(a.s, existing.id) && next.overseas !== existing.overseas) throw new Error('cannot change overseas status of an owned player')
        lib[existing.id] = next
        ids.push(existing.id)
        updated++
      } else {
        const np = sanitizePlayer(row)
        a.s.library = lib
        np.id = newId(a, np.name)
        lib[np.id] = np
        byName.set(np.name.toLowerCase(), np)
        ids.push(np.id)
        added++
      }
    } catch (e) {
      errors.push(`Row ${i + 2}: ${(e as Error).message}`)
    }
  }
  ensure(errors.length === 0, `Import failed (nothing changed):\n${errors.slice(0, 12).join('\n')}${errors.length > 12 ? `\n…and ${errors.length - 12} more` : ''}`)
  a.s.library = lib
  for (const id of ids) syncLot(a, lib[id])
  if (p.addToPool && a.s.phase === 'lobby') {
    a.s.config.poolMode = 'custom'
    a.s.config.customPoolIds = [...new Set([...a.s.config.customPoolIds, ...ids])]
  }
  a.fx.libraryChanged = true
  emit(a, 'players_imported', { added, updated })
  return { added, updated }
}

/** Accepts CSV-ish rows with flexible headers and converts types. */
function normaliseRow(r: Record<string, unknown>): Record<string, unknown> {
  const get = (...keys: string[]) => {
    for (const k of Object.keys(r)) if (keys.includes(k.toLowerCase().replace(/[^a-z]/g, ''))) return r[k]
    return undefined
  }
  const out: Record<string, unknown> = {}
  const set = (k: string, v: unknown) => {
    if (v !== undefined && v !== '') out[k] = v
  }
  set('id', get('id'))
  set('name', get('name', 'player', 'playername'))
  set('nationality', get('nationality', 'country'))
  const roleRaw = String(get('role', 'primaryrole') ?? '').toUpperCase().replace(/[^A-Z]/g, '')
  const ROLE_MAP: Record<string, Role> = {
    BAT: 'BAT', BATTER: 'BAT', BATSMAN: 'BAT', WK: 'WK', WICKETKEEPER: 'WK', KEEPER: 'WK', AR: 'AR', ALLROUNDER: 'AR',
    FAST: 'FAST', PACE: 'FAST', FASTBOWLER: 'FAST', PACER: 'FAST', SEAM: 'FAST', SPIN: 'SPIN', SPINNER: 'SPIN', SPINBOWLER: 'SPIN',
  }
  if (roleRaw) {
    ensure(ROLE_MAP[roleRaw], `unknown role "${get('role')}"`)
    out.role = ROLE_MAP[roleRaw]
  }
  const sr = String(get('secondaryrole') ?? '').toUpperCase().replace(/[^A-Z]/g, '')
  if (sr) out.secondaryRole = ROLE_MAP[sr] ?? null
  set('battingStyle', get('battingstyle', 'bat'))
  set('bowlingStyle', get('bowlingstyle', 'bowl'))
  const bp = get('baseprice', 'base', 'baseinlakh', 'basepricelakh')
  if (bp !== undefined && bp !== '') {
    const n = Number(String(bp).replace(/[^\d.]/g, ''))
    ensure(Number.isFinite(n) && n > 0, 'invalid base price')
    out.basePrice = /cr/i.test(String(bp)) ? Math.round(n * 100) : Math.round(n)
  }
  const yes = (v: unknown) => /^(1|y|yes|true)$/i.test(String(v).trim())
  const ov = get('overseas')
  if (ov !== undefined && ov !== '') out.overseas = yes(ov)
  const cp = get('capped')
  if (cp !== undefined && cp !== '') out.capped = yes(cp)
  const mq = get('marquee')
  if (mq !== undefined && mq !== '') out.marquee = yes(mq)
  const pool = String(get('pool', 'pools') ?? '').toLowerCase()
  if (pool) out.pools = pool.split(/[|;/ ]+/).filter((x) => x === 'current' || x === 'legend')
  const st = String(get('status') ?? '').toLowerCase()
  if (st) out.status = /retired|inactive/.test(st) ? 'inactive' : 'active'
  const teams = get('iplteams', 'teams')
  if (teams) out.iplTeams = String(teams).split(/[|;]/).map((x) => x.trim()).filter(Boolean)
  const lt = String(get('lastteam', 'previousteam', 'rtmteam') ?? '').toUpperCase().trim()
  if (lt) out.lastTeam = lt
  set('photoUrl', get('photo', 'photourl', 'image', 'imageurl'))
  const stats: Record<string, unknown> = {}
  const num = (k: string, ...keys: string[]) => {
    const v = get(...keys)
    if (v !== undefined && v !== '' && Number.isFinite(Number(v))) stats[k] = Number(v)
  }
  num('matches', 'matches', 'm', 'mat')
  num('runs', 'runs')
  num('battingAvg', 'battingavg', 'batavg', 'avg')
  num('strikeRate', 'strikerate', 'sr')
  num('wickets', 'wickets', 'wkts')
  num('economy', 'economy', 'econ')
  num('bowlingAvg', 'bowlingavg', 'bowlavg')
  if (Object.keys(stats).length) out.stats = stats
  return out
}

// ---------------------------------------------------------------- team & room

export function setLineup(a: Api, p: { team?: unknown; xi?: unknown; captain?: unknown; viceCaptain?: unknown }) {
  const m = actor(a)
  ensure(isTeamCode(p.team), 'Unknown franchise')
  ensure(controls(m, p.team) || a.s.hostId === m.id, `You do not control ${p.team}`)
  const t = a.s.teams[p.team]
  ensure(Array.isArray(p.xi) && p.xi.every((x) => typeof x === 'string'), 'Invalid XI')
  const xi = [...new Set(p.xi as string[])]
  ensure(xi.length <= 11, 'A playing XI has at most 11 players')
  for (const id of xi) ensure(t.squad.some((e) => e.playerId === id), 'XI players must be in your squad')
  const os = xi.filter((id) => a.s.library[id]?.overseas).length
  ensure(os <= a.s.config.xiOverseasLimit, `At most ${a.s.config.xiOverseasLimit} overseas players in the XI`)
  const cap = p.captain ? String(p.captain) : null
  const vc = p.viceCaptain ? String(p.viceCaptain) : null
  ensure(!cap || xi.includes(cap), 'Captain must be in the XI')
  ensure(!vc || xi.includes(vc), 'Vice-captain must be in the XI')
  ensure(!cap || cap !== vc, 'Captain and vice-captain must be different players')
  t.xi = xi
  t.captain = cap
  t.viceCaptain = vc
  emit(a, 'lineup_set', { team: p.team })
}

export function renameRoom(a: Api, p: { name?: unknown }) {
  requireHost(a)
  const name = STR(p.name, 60)
  ensure(name, 'Room name is required')
  a.s.name = name
  emit(a, 'room_renamed', { name })
}

export function setArchived(a: Api, p: { archived?: unknown }) {
  requireHost(a)
  ensure(!a.s.current, 'Finish the current lot first')
  a.s.archived = !!p.archived
  if (a.s.archived) a.s.paused = a.s.phase === 'live' ? true : a.s.paused
  emit(a, a.s.archived ? 'room_archived' : 'room_unarchived', {})
  notify(a, 'host', a.s.archived ? 'Room archived (read-only)' : 'Room restored')
}

export function setCustomPool(a: Api, p: { ids?: unknown; mode?: unknown }) {
  requireHost(a)
  ensure(a.s.phase === 'lobby', 'Pool selection is locked once the auction starts; use "Add to auction" instead')
  ensure(Array.isArray(p.ids), 'Invalid selection')
  const ids = [...new Set((p.ids as unknown[]).filter((x): x is string => typeof x === 'string' && !!a.s.library[x]))]
  const mode = p.mode === 'add' ? 'add' : p.mode === 'remove' ? 'remove' : 'set'
  const cur = new Set(a.s.config.customPoolIds)
  if (mode === 'set') a.s.config.customPoolIds = ids
  else if (mode === 'add') a.s.config.customPoolIds = [...new Set([...cur, ...ids])]
  else a.s.config.customPoolIds = [...cur].filter((x) => !ids.includes(x))
  a.s.config.poolMode = 'custom'
  emit(a, 'custom_pool_set', { count: a.s.config.customPoolIds.length })
}
