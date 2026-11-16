import type { Player, PublicState, Team, TeamCode } from '@shared/types'
import { TEAM_CODES } from '@shared/types'
import { committedFor, formatMoney, minNextBid, overseasCount, reserveFor } from '@shared/rules'

/** Client-side hint only. The server re-validates every bid. */
export function bidBlocker(s: PublicState, lib: Record<string, Player>, team: Team, playerId: string, amount: number): string | null {
  const cfg = s.config
  const p = lib[playerId]
  if (!p) return null
  if (team.squad.length >= cfg.maxSquad) return `Squad full (${cfg.maxSquad})`
  if (p.overseas && overseasCount(team, lib) >= cfg.maxOverseas) return `Overseas limit reached (${cfg.maxOverseas})`
  const max = team.purse - reserveFor(team, cfg)
  if (amount > max) return `Max bid ${formatMoney(Math.max(0, max))}`
  return null
}

export function nextBid(s: PublicState): number | null {
  const c = s.current
  if (!c) return null
  return minNextBid(c.high?.amount ?? null, s.lots[c.playerId]?.basePrice ?? 0, s.config.increments)
}

export function availablePurse(s: PublicState, code: TeamCode) {
  return s.teams[code].purse - committedFor(s, code)
}

export function ownerName(s: PublicState, code: TeamCode): string | null {
  const m = Object.values(s.members).find((m) => m.status === 'approved' && m.role === 'owner' && m.teamIds.includes(code))
  return m?.name ?? null
}
export function ownerId(s: PublicState, code: TeamCode): string | null {
  const m = Object.values(s.members).find((m) => m.status === 'approved' && m.role === 'owner' && m.teamIds.includes(code))
  return m?.id ?? null
}

export function teamOfPlayer(s: PublicState, playerId: string): TeamCode | null {
  for (const c of TEAM_CODES) if (s.teams[c].squad.some((e) => e.playerId === playerId)) return c
  return null
}

export function relTime(ts: number, now = Date.now()) {
  const d = Math.round((now - ts) / 1000)
  if (d < 5) return 'just now'
  if (d < 60) return `${d}s ago`
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`
  return new Date(ts).toLocaleDateString()
}

export function clock(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** RFC 4180-ish CSV parser returning objects keyed by header. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let f = ''
  let q = false
  const t = text.replace(/^﻿/, '')
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          f += '"'
          i++
        } else q = false
      } else f += c
    } else if (c === '"') q = true
    else if (c === ',') {
      row.push(f)
      f = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      row.push(f)
      rows.push(row)
      row = []
      f = ''
    } else f += c
  }
  if (f || row.length) {
    row.push(f)
    rows.push(row)
  }
  const nonEmpty = rows.filter((r) => r.some((x) => x.trim() !== ''))
  if (nonEmpty.length < 2) return []
  const head = nonEmpty[0].map((h) => h.trim())
  return nonEmpty.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])))
}

export function download(name: string, body: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([body], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function cls(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(' ')
}
