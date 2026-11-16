/**
 * Builds src/server/data/players.json from IPL ball-by-ball data.
 *
 * Source data: Cricsheet ball-by-ball IPL data as republished (CSV) in
 * https://github.com/ritesh-ojha/IPL-DATASET (MIT). Download these into a folder:
 *   csv/Ball_By_Ball_Match_Data.csv, csv/Match_Info.csv, csv/2024_players_details.csv
 *
 * Usage: npm run data:build -- <folder-with-csvs>
 *
 * Every statistic is computed here from deliveries. Nothing is typed in by hand.
 */
import fs from 'node:fs'
import path from 'node:path'
import { ACTIVE_LEGENDS, CAPPED_INDIANS, DETAILS, KEEPERS, LEGEND_EXTRAS, OVERSEAS } from './player-knowledge'
import { FRANCHISE_ALIASES, categoryFor } from '../src/shared/rules'
import type { Player, PlayerStats, Role, SeasonTeam, TeamCode } from '../src/shared/types'

const dir = process.argv[2]
if (!dir) {
  console.error('usage: build-players <csv folder>')
  process.exit(1)
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else q = false
      } else field += c
    } else if (c === '"') q = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}
function readCsv(file: string): Record<string, string>[] {
  const rows = parseCsv(fs.readFileSync(path.join(dir, file), 'utf8'))
  const head = rows[0]
  return rows.slice(1).filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
}

const matches = readCsv('Match_Info.csv')
const balls = readCsv('Ball_By_Ball_Match_Data.csv')
const details = new Map(readCsv('2024_players_details.csv').map((r) => [r.Name, r]))

const seasonOf = new Map<string, number>()
interface Acc {
  matches: Set<string>
  seasons: Set<number>
  seasonTeams: Map<number, string>
}
const acc = new Map<string, Acc>()
const get = (n: string) => {
  let a = acc.get(n)
  if (!a) acc.set(n, (a = { matches: new Set(), seasons: new Set(), seasonTeams: new Map() }))
  return a
}
const matchTeamPlayers: { season: number; team: string; players: string[] }[] = []
for (const m of matches) {
  const season = parseInt(m.match_date.slice(0, 4))
  seasonOf.set(m.match_number, season)
  for (const [side, team] of [
    ['team1_players', m.team1],
    ['team2_players', m.team2],
  ] as const) {
    const players = m[side].split(',').map((s) => s.trim()).filter(Boolean)
    matchTeamPlayers.push({ season, team, players })
    for (const p of players) {
      const a = get(p)
      a.matches.add(m.match_number)
      a.seasons.add(season)
      a.seasonTeams.set(season, team)
    }
  }
}
const LATEST = Math.max(...seasonOf.values())
const RECENT = new Set([LATEST - 1, LATEST])

interface Raw {
  inns: Map<string, { runs: number; out: boolean }>
  runs: number
  bf: number
  fours: number
  sixes: number
  outs: number
  lb: number
  rc: number
  wk: number
  bowlInns: Map<string, { w: number; r: number }>
  middle: number
  catches: number
  st: number
}
const newRaw = (): Raw => ({ inns: new Map(), runs: 0, bf: 0, fours: 0, sixes: 0, outs: 0, lb: 0, rc: 0, wk: 0, bowlInns: new Map(), middle: 0, catches: 0, st: 0 })
const career = new Map<string, Raw>()
const recent = new Map<string, Raw>()
const raw = (m: Map<string, Raw>, n: string) => {
  let r = m.get(n)
  if (!r) m.set(n, (r = newRaw()))
  return r
}
const BOWLER_WICKETS = new Set(['caught', 'bowled', 'lbw', 'caught and bowled', 'stumped', 'hit wicket'])

for (const b of balls) {
  const season = seasonOf.get(b.ID)!
  const key = `${b.ID}-${b.Innings}`
  const targets = [career]
  if (RECENT.has(season)) targets.push(recent)
  const extra = b.ExtraType
  const wide = extra.includes('wides')
  const noball = extra.includes('noballs')
  const br = parseInt(b.BatsmanRun) || 0
  const er = parseInt(b.ExtrasRun) || 0
  for (const T of targets) {
    for (const n of [b.Batter, b.NonStriker]) {
      const r = raw(T, n)
      if (!r.inns.has(key)) r.inns.set(key, { runs: 0, out: false })
    }
    const bat = raw(T, b.Batter)
    bat.runs += br
    bat.inns.get(key)!.runs += br
    if (!wide) bat.bf++
    if (br === 4) bat.fours++
    if (br === 6) bat.sixes++

    const bowl = raw(T, b.Bowler)
    if (!wide && !noball) bowl.lb++
    const ov = parseInt(b.Overs)
    if (ov >= 6 && ov <= 14) bowl.middle++
    let conceded = br
    if (wide) conceded += er
    else if (noball) conceded += extra === 'noballs' ? er : 1
    bowl.rc += conceded
    const bi = bowl.bowlInns.get(key) ?? { w: 0, r: 0 }
    bi.r += conceded
    bowl.bowlInns.set(key, bi)

    if (b.IsWicketDelivery === '1' && b.PlayerOut && b.PlayerOut !== 'NA') {
      const outP = raw(T, b.PlayerOut)
      if (!outP.inns.has(key)) outP.inns.set(key, { runs: 0, out: false })
      if (b.Kind !== 'retired hurt') {
        outP.inns.get(key)!.out = true
        outP.outs++
      }
      if (BOWLER_WICKETS.has(b.Kind)) {
        bowl.wk++
        bi.w++
      }
      const fielders = b.FieldersInvolved && b.FieldersInvolved !== 'NA' ? b.FieldersInvolved.split(',').map((s) => s.trim()) : []
      if (b.Kind === 'caught') for (const f of fielders) if (!f.includes('(sub)')) raw(T, f).catches++
      if (b.Kind === 'caught and bowled') bowl.catches++
      if (b.Kind === 'stumped') for (const f of fielders) raw(T, f).st++
    }
  }
}

const r1 = (n: number) => Math.round(n * 100) / 100
function toStats(r: Raw | undefined, matchCount: number, seasons: number): PlayerStats {
  r ??= newRaw()
  const inns = [...r.inns.values()]
  const notOuts = inns.filter((i) => !i.out).length
  let hs = 0
  let hsNo = false
  for (const i of inns)
    if (i.runs > hs || (i.runs === hs && !i.out)) {
      hs = i.runs
      hsNo = !i.out
    }
  let best: { w: number; r: number } | null = null
  for (const bi of r.bowlInns.values()) if (!best || bi.w > best.w || (bi.w === best.w && bi.r < best.r)) best = bi
  return {
    matches: matchCount,
    seasons,
    batInnings: inns.length,
    runs: r.runs,
    ballsFaced: r.bf,
    notOuts,
    highScore: hs,
    highScoreNotOut: hsNo,
    fifties: inns.filter((i) => i.runs >= 50 && i.runs < 100).length,
    hundreds: inns.filter((i) => i.runs >= 100).length,
    fours: r.fours,
    sixes: r.sixes,
    battingAvg: r.outs > 0 ? r1(r.runs / r.outs) : null,
    strikeRate: r.bf > 0 ? r1((r.runs / r.bf) * 100) : null,
    ballsBowled: r.lb,
    runsConceded: r.rc,
    wickets: r.wk,
    bowlingAvg: r.wk > 0 ? r1(r.rc / r.wk) : null,
    economy: r.lb > 0 ? r1((r.rc / r.lb) * 6) : null,
    bestBowling: best && r.lb > 0 ? `${best.w}/${best.r}` : null,
    catches: r.catches,
    stumpings: r.st,
  }
}

const BOWL_LABEL: Record<string, string> = {
  rf: 'Right-arm fast',
  rfm: 'Right-arm fast-medium',
  rmf: 'Right-arm medium-fast',
  rm: 'Right-arm medium',
  lf: 'Left-arm fast',
  lfm: 'Left-arm fast-medium',
  lmf: 'Left-arm medium-fast',
  lm: 'Left-arm medium',
  ob: 'Right-arm off-break',
  lb: 'Right-arm leg-break',
  lbg: 'Right-arm leg-break googly',
  sla: 'Slow left-arm orthodox',
  lws: 'Left-arm wrist-spin',
  rp: 'Right-arm pace',
}
const PACE = new Set(['rf', 'rfm', 'rmf', 'rm', 'lf', 'lfm', 'lmf', 'lm', 'rp'])
const LONG_TO_CODE: Record<string, string> = {
  'right-arm offbreak': 'ob',
  'right-arm medium': 'rm',
  'slow left-arm orthodox': 'sla',
  'right-arm fast': 'rf',
  'right-arm fast-medium': 'rfm',
  legbreak: 'lb',
  'right-arm medium-fast': 'rmf',
  'legbreak googly': 'lbg',
  'left-arm fast-medium': 'lfm',
  'left-arm medium-fast': 'lmf',
  'left-arm medium': 'lm',
  'left-arm wrist-spin': 'lws',
  'left-arm fast': 'lf',
}

// ---- pools
const currentNames = [...acc.entries()].filter(([, a]) => a.seasons.has(LATEST) || a.seasons.has(LATEST - 1)).map(([n]) => n)
const legendNames = new Set<string>([
  ...[...acc.entries()].filter(([, a]) => !a.seasons.has(LATEST) && a.matches.size >= 50).map(([n]) => n),
  ...LEGEND_EXTRAS,
  ...ACTIVE_LEGENDS,
])
const all = [...new Set([...currentNames, ...legendNames])]

const missingKnowledge: string[] = []
const players: Player[] = []
const ids = new Set<string>()
for (const short of all) {
  const a = acc.get(short)
  if (!a) {
    console.warn('not found in data:', short)
    continue
  }
  const notes: string[] = []
  const det = details.get(short)
  const k = DETAILS[short]?.split('|')
  if (!det && !k) missingKnowledge.push(short)
  const fullName = k?.[0] || det?.longName || short
  let batting: string | null = null
  const batCode = k?.[1] ?? (det?.battingStyles === 'rhb' ? 'R' : det?.battingStyles === 'lhb' ? 'L' : '?')
  if (batCode === 'R') batting = 'Right-hand bat'
  else if (batCode === 'L') batting = 'Left-hand bat'
  else notes.push('Batting style unverified')

  let bowlCode: string | null
  if (k) bowlCode = k[2]
  else if (det) {
    const long = det.longBowlingStyles
    bowlCode = !long || long === 'Na' ? '' : LONG_TO_CODE[long.split(',')[0].trim()] ?? '?'
  } else bowlCode = '?'
  const keeper = (k?.[3] as 'WK' | 'wk' | '' | '?') ?? KEEPERS[short] ?? ''

  const st = toStats(career.get(short), a.matches.size, a.seasons.size)
  const recentMatches = [...a.matches].filter((m) => RECENT.has(seasonOf.get(m)!)).length
  const recentSeasons = [...a.seasons].filter((s) => RECENT.has(s)).length
  const rst = recentMatches ? toStats(recent.get(short), recentMatches, recentSeasons) : null
  const career_ = career.get(short) ?? newRaw()

  // bowling type
  let bowlType: Role | null = null
  if (bowlCode && bowlCode !== '?') bowlType = PACE.has(bowlCode) ? 'FAST' : 'SPIN'
  else if (bowlCode === '?' && st.ballsBowled >= 12) {
    bowlType = career_.middle / Math.max(1, st.ballsBowled + 0) >= 0.6 ? 'SPIN' : 'FAST'
    notes.push('Bowling type inferred from IPL phase usage (middle overs vs powerplay/death)')
  }
  const bowlingStyle = bowlCode && bowlCode !== '?' ? BOWL_LABEL[bowlCode] : null
  if (bowlCode === '?' && st.ballsBowled >= 12) notes.push('Bowling style unverified')

  // role from usage
  const m = Math.max(1, st.matches)
  const bpm = st.ballsBowled / m
  const rpm = st.runs / m
  const bfpm = st.ballsFaced / m
  const isWK = keeper === 'WK' || (keeper !== 'wk' && keeper !== '' && st.stumpings >= 3)
  if (keeper === '?' && st.stumpings >= 3) notes.push('Wicketkeeper role inferred from stumpings')
  let role: Role
  let secondary: Role | null = null
  const bowlsReg = bpm >= 12 && bowlType !== null
  const isAR = bowlType !== null && ((bpm >= 6 && rpm >= 10) || (bpm >= 12 && rpm >= 7.5 && bfpm >= 6))
  if (isWK) {
    role = 'WK'
    secondary = 'BAT'
  } else if (isAR) {
    role = 'AR'
    secondary = bowlType
  } else if (bowlsReg) {
    role = bowlType!
    secondary = rpm >= 7 ? 'AR' : null
  } else if (st.matches < 3 && bowlType && st.ballsFaced < 15 && bowlCode !== '') {
    role = bowlType
  } else {
    role = 'BAT'
    if (bpm >= 4 && bowlType) secondary = bowlType
  }
  if (keeper === 'wk' && !secondary) secondary = 'WK'
  if (!det && !k) notes.push('Role derived from IPL usage only')

  const nationality = OVERSEAS[short] ?? 'India'
  const overseas = nationality !== 'India'
  const capped = overseas || CAPPED_INDIANS.has(short)

  const seasonTeams: SeasonTeam[] = [...a.seasonTeams.entries()].sort((x, y) => x[0] - y[0]).map(([season, team]) => ({ season, team }))
  const iplTeams = [...new Set(seasonTeams.map((s) => s.team.replace('Royal Challengers Bangalore', 'Royal Challengers Bengaluru').replace('Rising Pune Supergiants', 'Rising Pune Supergiant')))]
  const lastSeason = Math.max(...a.seasons)
  const lastTeamName = a.seasonTeams.get(lastSeason)!
  const lastTeam: TeamCode | null = FRANCHISE_ALIASES[lastTeamName] ?? null
  const status = a.seasons.has(LATEST) ? 'active' : 'inactive'
  const pools: Player['pools'] = []
  if (currentNames.includes(short)) pools.push('current')
  if (legendNames.has(short)) pools.push('legend')

  let id = short.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  while (ids.has(id)) id += '-x'
  ids.add(id)

  const photo = det?.imgUrl && det.imgUrl.startsWith('http') ? det.imgUrl : null
  const p: Player = {
    id,
    name: fullName,
    shortName: short,
    nationality,
    overseas,
    role,
    secondaryRole: secondary === role ? null : secondary,
    battingStyle: batting,
    bowlingStyle,
    iplTeams,
    seasonTeams,
    lastTeam,
    firstSeason: Math.min(...a.seasons),
    lastSeason,
    status,
    capped,
    pools,
    marquee: false,
    basePrice: 30,
    category: '',
    photoUrl: photo,
    stats: st,
    recentStats: rst,
    statsSource: `Computed from Cricsheet ball-by-ball data, IPL ${Math.min(...seasonOf.values())}–${LATEST}`,
    dataNotes: notes,
  }
  p.category = categoryFor(p)
  players.push(p)
}

// ---- app-generated base prices (a game setting, not a statistic)
function score(p: Player): number {
  const c = p.stats!
  const careerScore = c.runs / 110 + c.wickets * 0.4 + c.matches * 0.1
  if (p.pools.includes('current') && p.recentStats) {
    const r = p.recentStats
    const recentScore = r.runs / 30 + r.wickets * 1.2 + r.matches * 0.5 + (p.capped ? 4 : 0) + c.matches * 0.04
    return p.pools.includes('legend') ? Math.max(recentScore, careerScore) : recentScore
  }
  return careerScore
}
const ranked = [...players].sort((a, b) => score(b) - score(a))
ranked.forEach((p, i) => {
  const pct = i / ranked.length
  p.basePrice = pct < 0.08 ? 200 : pct < 0.2 ? 150 : pct < 0.38 ? 100 : pct < 0.56 ? 75 : pct < 0.76 ? 50 : 30
  if (!p.capped && p.basePrice > 75) p.basePrice = 75
})
ranked.slice(0, 20).forEach((p) => (p.marquee = true))
const curGroup = players.filter((p) => p.pools.includes('current'))

// ---- overseas sanity check: max 4 overseas per XI in recent seasons
const byName = new Map(players.map((p) => [p.shortName, p]))
let overLimit = 0
const suspects = new Map<string, number>()
for (const mt of matchTeamPlayers) {
  if (mt.season < LATEST - 1) continue
  const os = mt.players.filter((n) => OVERSEAS[n]).length
  if (os > 4) {
    overLimit++
    console.warn('>4 overseas', mt.season, mt.team, mt.players.filter((n) => OVERSEAS[n]))
  }
  if (os < 3) for (const n of mt.players) if (!OVERSEAS[n]) suspects.set(n, (suspects.get(n) ?? 0) + 1)
}

players.sort((a, b) => a.name.localeCompare(b.name))
const out = {
  meta: {
    generatedAt: new Date().toISOString(),
    dataThrough: `IPL ${LATEST}`,
    source:
      'Cricsheet ball-by-ball data (cricsheet.org) via github.com/ritesh-ojha/IPL-DATASET (MIT). Statistics are computed from deliveries and may differ slightly from official records (e.g. all-run boundaries counted as fours).',
    notes:
      'Nationality, batting/bowling style and capped status are curated; fields that could not be verified are listed in each player\'s dataNotes. Base prices and marquee flags are app-generated defaults for gameplay, not real auction prices.',
    counts: { total: players.length, current: curGroup.length, legend: players.filter((p) => p.pools.includes('legend')).length },
  },
  players,
}
const outFile = path.resolve('src/server/data/players.json')
fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, JSON.stringify(out))
console.log('wrote', outFile, out.meta.counts)
console.log('overseas >4 violations:', overLimit)
console.log('possible unflagged overseas (XIs with <3 overseas):', [...suspects.entries()].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]).slice(0, 25))
console.log('no curated knowledge:', missingKnowledge.length, missingKnowledge.join(', '))
const roleCount: Record<string, number> = {}
for (const p of players) roleCount[p.role] = (roleCount[p.role] ?? 0) + 1
console.log('roles', roleCount, 'with notes', players.filter((p) => p.dataNotes.length).length)
void byName
