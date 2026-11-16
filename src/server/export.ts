import type { RoomEvent, RoomState } from '../shared/types'
import { TEAM_CODES } from '../shared/types'
import { ROLE_LABEL, TEAM_META } from '../shared/rules'

const esc = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const csv = (rows: unknown[][]) => rows.map((r) => r.map(esc).join(',')).join('\n') + '\n'
const cr = (l: number | null) => (l === null ? '' : (l / 100).toFixed(2))

export function exportFile(s: RoomState, events: RoomEvent[], file: string): { type: string; body: string } | null {
  const lib = s.library
  const name = (id: string) => lib[id]?.name ?? id
  switch (file) {
    case 'results.csv': {
      const rows: unknown[][] = [['player', 'role', 'nationality', 'overseas', 'status', 'team', 'price_lakh', 'price_crore', 'acquired_via', 'round', 'base_price_lakh', 'attempts']]
      for (const lot of Object.values(s.lots)) {
        const p = lib[lot.playerId]
        const last = lot.attempts[lot.attempts.length - 1]
        rows.push([p?.name, p ? ROLE_LABEL[p.role] : '', p?.nationality, p?.overseas ? 'yes' : 'no', lot.status, lot.soldTo ?? '', lot.soldPrice ?? '', cr(lot.soldPrice), last?.via ?? (lot.status === 'retained' ? 'retained' : ''), last?.round ?? '', lot.basePrice, lot.attempts.length])
      }
      return { type: 'text/csv', body: csv(rows) }
    }
    case 'squads.csv': {
      const rows: unknown[][] = [['team', 'team_name', 'player', 'role', 'nationality', 'overseas', 'price_lakh', 'acquired_via', 'in_xi', 'captain', 'vice_captain']]
      for (const code of TEAM_CODES) {
        const t = s.teams[code]
        for (const e of t.squad) {
          const p = lib[e.playerId]
          rows.push([code, TEAM_META[code].name, p?.name, p ? ROLE_LABEL[p.role] : '', p?.nationality, p?.overseas ? 'yes' : 'no', e.price, e.via, t.xi.includes(e.playerId) ? 'yes' : '', t.captain === e.playerId ? 'yes' : '', t.viceCaptain === e.playerId ? 'yes' : ''])
        }
      }
      return { type: 'text/csv', body: csv(rows) }
    }
    case 'teams.csv': {
      const rows: unknown[][] = [['team', 'purse_remaining_lakh', 'spent_lakh', 'squad', 'overseas', 'rtm_cards_left']]
      for (const code of TEAM_CODES) {
        const t = s.teams[code]
        rows.push([code, t.purse, t.spent, t.squad.length, t.squad.filter((e) => lib[e.playerId]?.overseas).length, t.rtmCards])
      }
      return { type: 'text/csv', body: csv(rows) }
    }
    case 'history.csv': {
      const rows: unknown[][] = [['seq', 'time_utc', 'type', 'actor', 'actor_name', 'player', 'team', 'amount_lakh', 'details']]
      for (const e of events) {
        const d = e.data as Record<string, unknown>
        rows.push([e.seq, new Date(e.ts).toISOString(), e.type, e.actor ?? 'system', e.actor ? s.members[e.actor]?.name ?? '' : '', d.playerId ? name(String(d.playerId)) : '', d.team ?? '', d.amount ?? '', JSON.stringify(d)])
      }
      return { type: 'text/csv', body: csv(rows) }
    }
    case 'full.json': {
      const { library, ...state } = s
      return { type: 'application/json', body: JSON.stringify({ exportedAt: new Date().toISOString(), state, players: library, events }, null, 1) }
    }
  }
  return null
}
