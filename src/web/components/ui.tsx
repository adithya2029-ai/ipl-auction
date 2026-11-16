import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Player, PlayerStats, TeamCode } from '@shared/types'
import { ROLE_LABEL, TEAM_META, formatMoney, parseMoney } from '@shared/rules'
import { cls } from '../lib/helpers'
import { useRoom } from '../lib/room'

export function TeamBadge({ code, size = 'md', dim }: { code: TeamCode | null | undefined; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'; dim?: boolean }) {
  if (!code) return <span className="inline-block rounded-md bg-white/5 text-white/30 text-[10px] px-1.5 py-0.5">—</span>
  const m = TEAM_META[code]
  const sz = { xs: 'h-5 min-w-5 text-[9px] px-1', sm: 'h-7 min-w-7 text-[10px] px-1.5', md: 'h-9 min-w-9 text-xs px-2', lg: 'h-12 min-w-12 text-sm px-2.5', xl: 'h-16 min-w-16 text-lg px-3' }[size]
  return (
    <span
      title={m.name}
      className={cls('inline-flex items-center justify-center rounded-lg font-display font-bold tracking-wider shrink-0', sz, dim && 'opacity-50')}
      style={{ background: `linear-gradient(135deg, ${m.primary} 0%, ${m.primary} 55%, ${m.accent} 140%)`, color: code === 'CSK' ? '#1a2240' : '#fff', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.15)' }}
    >
      {m.short}
    </span>
  )
}

export function Avatar({ player, size = 48 }: { player: Player | undefined; size?: number }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [player?.photoUrl])
  const initials = (player?.name ?? '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  const style = { width: size, height: size }
  if (player?.photoUrl && !broken)
    return (
      <img
        src={player.photoUrl}
        alt={player.name}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        style={style}
        className="rounded-xl object-cover bg-ink-700 shrink-0 object-top"
      />
    )
  return (
    <div style={{ ...style, fontSize: size * 0.36 }} className="rounded-xl bg-gradient-to-br from-ink-600 to-ink-800 border border-white/10 flex items-center justify-center font-display font-bold text-white/70 shrink-0">
      {initials}
    </div>
  )
}

export function RoleChip({ p }: { p: Player }) {
  const color = { BAT: 'text-sky-300 border-sky-400/25 bg-sky-400/10', WK: 'text-violet-300 border-violet-400/25 bg-violet-400/10', AR: 'text-emerald-300 border-emerald-400/25 bg-emerald-400/10', FAST: 'text-orange-300 border-orange-400/25 bg-orange-400/10', SPIN: 'text-pink-300 border-pink-400/25 bg-pink-400/10' }[p.role]
  return <span className={cls('chip', color)}>{ROLE_LABEL[p.role]}</span>
}

export function PlayerTags({ p }: { p: Player }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {p.overseas && <span className="chip text-amber-200 border-amber-300/25 bg-amber-300/10">Overseas</span>}
      {p.pools.includes('legend') && <span className="chip text-gold-300 border-gold-400/30 bg-gold-400/10">Legend</span>}
      {!p.capped && <span className="chip text-white/60 border-white/15 bg-white/5">Uncapped</span>}
      {p.marquee && <span className="chip text-gold-300 border-gold-400/30 bg-transparent">Marquee</span>}
      {p.custom && <span className="chip text-white/60 border-white/15">Custom</span>}
    </span>
  )
}

export function statusLine(p: Player) {
  if (p.status === 'active') return p.lastSeason ? `Active · played IPL ${p.lastSeason}` : 'Active'
  return p.lastSeason ? `Not in latest IPL season · last played ${p.lastSeason}` : 'Retired / inactive'
}

export function Money({ v, className }: { v: number | null | undefined; className?: string }) {
  return <span className={cls('num', className)}>{formatMoney(v)}</span>
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4" onMouseDown={onClose}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className={cls('card w-full max-h-[92vh] overflow-y-auto scroll-thin animate-slideIn rounded-b-none sm:rounded-xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}
      >
        <div className="card-hd sticky top-0 bg-ink-850 z-10">
          <div className="font-semibold">{title}</div>
          <button className="btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}

export function Toasts() {
  const { toasts, dismiss } = useRoom()
  return (
    <div className="fixed z-[60] bottom-3 right-3 left-3 sm:left-auto sm:w-96 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={cls(
            'pointer-events-auto text-left rounded-lg px-3.5 py-2.5 text-sm shadow-xl border animate-slideIn whitespace-pre-line backdrop-blur',
            t.kind === 'warning' && 'bg-red-950/90 border-red-400/30 text-red-100',
            t.kind === 'success' && 'bg-emerald-950/90 border-emerald-400/30 text-emerald-50',
            t.kind === 'trade' && 'bg-indigo-950/90 border-indigo-400/30 text-indigo-50',
            t.kind === 'host' && 'bg-ink-800/95 border-gold-400/30 text-gold-300',
            t.kind === 'info' && 'bg-ink-800/95 border-white/10 text-white',
          )}
        >
          {t.text}
        </button>
      ))}
    </div>
  )
}

export function Countdown({ deadline, paused, remaining, total, now }: { deadline: number | null; paused: boolean; remaining: number | null; total: number; now: number }) {
  const ms = paused ? remaining ?? 0 : deadline ? Math.max(0, deadline - now) : 0
  const secs = Math.ceil(ms / 1000)
  const frac = Math.max(0, Math.min(1, ms / (total * 1000)))
  const r = 52
  const c = 2 * Math.PI * r
  const color = paused ? '#64748b' : secs <= 3 ? '#ef4444' : secs <= 6 ? '#f59e0b' : '#dcbc63'
  return (
    <div className="relative w-32 h-32 shrink-0" aria-label={`${secs} seconds left`}>
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
        <circle cx="60" cy="60" r={r} stroke="rgba(255,255,255,0.08)" strokeWidth="8" fill="none" />
        <circle cx="60" cy="60" r={r} stroke={color} strokeWidth="8" fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} style={{ transition: 'stroke-dashoffset 0.2s linear, stroke 0.3s' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className={cls('num text-4xl font-bold leading-none', secs <= 3 && !paused && 'text-red-400')}>{paused ? '❚❚' : secs}</div>
        <div className="label mt-1">{paused ? 'paused' : 'seconds'}</div>
      </div>
    </div>
  )
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2 min-w-0">
      <div className="label truncate">{label}</div>
      <div className="num text-xl font-semibold leading-tight truncate">{value}</div>
      {sub && <div className="text-[11px] text-white/45 truncate">{sub}</div>}
    </div>
  )
}

export function KeyStats({ s, compact }: { s: PlayerStats | null; compact?: boolean }) {
  if (!s) return <div className="text-sm text-white/40">Statistics unavailable for this player.</div>
  const bowls = s.ballsBowled >= 60
  const items: [string, ReactNode][] = [
    ['Matches', s.matches],
    ['Runs', s.runs],
    ['Bat avg', s.battingAvg ?? '—'],
    ['Strike rate', s.strikeRate ?? '—'],
  ]
  if (bowls) items.push(['Wickets', s.wickets], ['Economy', s.economy ?? '—'])
  else items.push(['50s / 100s', `${s.fifties}/${s.hundreds}`], ['High score', `${s.highScore}${s.highScoreNotOut ? '*' : ''}`])
  return (
    <div className={cls('grid gap-2', compact ? 'grid-cols-3' : 'grid-cols-3 sm:grid-cols-6')}>
      {items.map(([l, v]) => (
        <Stat key={l} label={l} value={v} />
      ))}
    </div>
  )
}

export function FullStats({ s, title }: { s: PlayerStats | null; title: string }) {
  if (!s) return null
  const rows: [string, ReactNode][] = [
    ['Matches', s.matches],
    ['Seasons', s.seasons],
    ['Innings', s.batInnings],
    ['Runs', s.runs],
    ['Average', s.battingAvg ?? '—'],
    ['Strike rate', s.strikeRate ?? '—'],
    ['High score', `${s.highScore}${s.highScoreNotOut ? '*' : ''}`],
    ['100s / 50s', `${s.hundreds} / ${s.fifties}`],
    ['4s / 6s', `${s.fours} / ${s.sixes}`],
    ['Wickets', s.wickets],
    ['Economy', s.economy ?? '—'],
    ['Bowl avg', s.bowlingAvg ?? '—'],
    ['Best', s.bestBowling ?? '—'],
    ['Overs', s.ballsBowled ? `${Math.floor(s.ballsBowled / 6)}.${s.ballsBowled % 6}` : '0'],
    ['Catches', s.catches],
    ['Stumpings', s.stumpings],
  ]
  return (
    <div>
      <div className="label mb-2">{title}</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2 border-b border-white/[0.05] py-1">
            <span className="text-white/50">{k}</span>
            <span className="num font-semibold">{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function PlayerProfile({ p, onClose, extra }: { p: Player | null; onClose: () => void; extra?: ReactNode }) {
  return (
    <Modal open={!!p} onClose={onClose} title={p?.name} wide>
      {p && (
        <div className="space-y-5">
          <div className="flex gap-4 items-start">
            <Avatar player={p} size={88} />
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <RoleChip p={p} />
                {p.secondaryRole && <span className="chip text-white/60 border-white/15">{ROLE_LABEL[p.secondaryRole]}</span>}
                <PlayerTags p={p} />
              </div>
              <div className="text-sm text-white/70">
                {p.nationality} · {p.battingStyle ?? 'Batting style unknown'}
                {p.bowlingStyle ? ` · ${p.bowlingStyle}` : ''}
              </div>
              <div className="text-sm text-white/50">{statusLine(p)}</div>
              <div className="text-sm">
                Base price <Money v={p.basePrice} className="text-gold-300 font-semibold" /> · <span className="text-white/60">{p.category}</span>
              </div>
            </div>
          </div>
          {extra}
          <FullStats s={p.stats} title={`IPL career ${p.firstSeason ? `(${p.firstSeason}–${p.lastSeason})` : ''}`} />
          {p.recentStats && <FullStats s={p.recentStats} title="Recent form (last two IPL seasons in data)" />}
          {p.seasonTeams.length > 0 && (
            <div>
              <div className="label mb-2">IPL teams by season</div>
              <div className="flex flex-wrap gap-1.5">
                {p.seasonTeams.map((st) => (
                  <span key={st.season} className="chip border-white/10 text-white/70 bg-white/[0.03]">
                    {st.season} · {st.team}
                  </span>
                ))}
              </div>
            </div>
          )}
          {!p.seasonTeams.length && p.iplTeams.length > 0 && <div className="text-sm text-white/60">Teams: {p.iplTeams.join(', ')}</div>}
          <div className="text-[11px] text-white/35 space-y-1">
            {p.statsSource && <div>Source: {p.statsSource}. Computed from deliveries; may differ slightly from official records.</div>}
            {p.dataNotes.map((n) => (
              <div key={n} className="text-amber-200/60">
                ⚠ {n}
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}

export function PlayerPicker({ players, onPick, placeholder = 'Search players…', exclude }: { players: Player[]; onPick: (p: Player) => void; placeholder?: string; exclude?: Set<string> }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  const results = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return []
    return players.filter((p) => !exclude?.has(p.id) && (p.name.toLowerCase().includes(t) || p.shortName.toLowerCase().includes(t))).slice(0, 12)
  }, [q, players, exclude])
  return (
    <div className="relative" ref={ref}>
      <input className="input" value={q} placeholder={placeholder} onChange={(e) => (setQ(e.target.value), setOpen(true))} onFocus={() => setOpen(true)} />
      {open && results.length > 0 && (
        <div className="absolute z-30 mt-1 w-full card max-h-72 overflow-y-auto scroll-thin shadow-2xl">
          {results.map((p) => (
            <button
              key={p.id}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 text-left"
              onClick={() => {
                onPick(p)
                setQ('')
                setOpen(false)
              }}
            >
              <Avatar player={p} size={28} />
              <span className="text-sm flex-1 truncate">{p.name}</span>
              <span className="text-[11px] text-white/40">{ROLE_LABEL[p.role]}</span>
              <Money v={p.basePrice} className="text-xs text-white/60" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function MoneyInput({ value, onChange, placeholder, className }: { value: number | null; onChange: (v: number | null) => void; placeholder?: string; className?: string }) {
  const [txt, setTxt] = useState(value === null ? '' : String(value))
  useEffect(() => {
    if (parseMoney(txt) !== value) setTxt(value === null ? '' : String(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  const parsed = parseMoney(txt)
  return (
    <div className={cls('relative', className)}>
      <input className="input pr-20" inputMode="decimal" value={txt} placeholder={placeholder ?? 'e.g. 250 or 2.5cr'} onChange={(e) => (setTxt(e.target.value), onChange(parseMoney(e.target.value)))} />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/45 num">{txt && parsed !== null ? formatMoney(parsed) : 'lakh'}</span>
    </div>
  )
}

export function Toggle({ checked, onChange, label, disabled, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; hint?: ReactNode }) {
  return (
    <label className={cls('flex items-start gap-3 py-1.5', disabled ? 'opacity-50' : 'cursor-pointer')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cls('mt-0.5 relative h-5 w-9 rounded-full transition shrink-0', checked ? 'bg-gold-400' : 'bg-white/15')}
      >
        <span className={cls('absolute top-0.5 h-4 w-4 rounded-full bg-white transition', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
      <span>
        <span className="text-sm">{label}</span>
        {hint && <span className="block text-xs text-white/45">{hint}</span>}
      </span>
    </label>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="text-sm text-white/40 py-8 text-center">{children}</div>
}

export function Confirm({ open, title, body, confirmLabel = 'Confirm', danger, onConfirm, onClose }: { open: boolean; title: string; body: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <div className="text-sm text-white/75">{body}</div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className={danger ? 'btn-danger' : 'btn-gold'}
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}
