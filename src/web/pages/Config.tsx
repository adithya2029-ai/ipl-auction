import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { AuctionConfig, TeamCode } from '@shared/types'
import { TEAM_CODES } from '@shared/types'
import { DEFAULT_SET_ORDER, TEAM_META, formatMoney, overseasCount } from '@shared/rules'
import { useRoom } from '../lib/room'
import { cls, parseCsv } from '../lib/helpers'
import { Confirm, Money, MoneyInput, PlayerPicker, TeamBadge, Toggle } from '../components/ui'

const LIVE_SAFE = new Set<keyof AuctionConfig>([
  'timerSeconds', 'bidTimerSeconds', 'autoProgress', 'autoProgressDelay', 'increments', 'allowJumpBids', 'tradesEnabled', 'tradesDuringAuction',
  'tradeRequiresHostApproval', 'tradeCashAllowed', 'spectatorsAllowed', 'spectatorsSeeTrades', 'xiOverseasLimit', 'hostClaimAfterSeconds',
  'rtmDecisionSeconds', 'setOrder', 'shuffleWithinSet', 'maxSquad', 'minSquad', 'maxOverseas', 'reservePurseForMinSquad', 'reserveBasePrice',
  'rtmFinalRaise', 'allowMultipleTeamsPerOwner',
])

function Section({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <section className="card">
      <div className="card-hd">
        <div>
          <div className="font-display text-lg font-semibold">{title}</div>
          {desc && <div className="text-xs text-white/45">{desc}</div>}
        </div>
      </div>
      <div className="p-4 space-y-3">{children}</div>
    </section>
  )
}

function NumField({ label, value, onChange, disabled, min = 0, max = 9999, suffix, hint }: { label: string; value: number; onChange: (v: number) => void; disabled?: boolean; min?: number; max?: number; suffix?: string; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="relative mt-1">
        <input type="number" className="input pr-14" value={value} min={min} max={max} disabled={disabled} onChange={(e) => onChange(Math.round(Number(e.target.value)))} />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/40">{suffix}</span>}
      </div>
      {hint && <span className="text-[11px] text-white/40">{hint}</span>}
    </label>
  )
}

export default function Config() {
  const { state, isHost, send, players, library } = useRoom()
  const [draft, setDraft] = useState<AuctionConfig | null>(null)
  const [confirmStart, setConfirmStart] = useState(false)
  const cfg = state?.config
  useEffect(() => {
    if (cfg) setDraft(structuredClone(cfg))
  }, [cfg])
  const lobby = state?.phase === 'lobby'
  const poolCount = useMemo(() => {
    if (!state || !draft) return 0
    const owned = new Set(TEAM_CODES.flatMap((c) => state.teams[c].squad.map((e) => e.playerId)))
    const ids = draft.poolMode === 'custom' ? draft.customPoolIds : players.filter((p) => p.pools.some((t) => draft.pools.includes(t))).map((p) => p.id)
    return ids.filter((id) => !owned.has(id) && library[id]).length
  }, [state, draft, players, library])
  if (!state || !draft || !cfg) return null

  const ro = (k: keyof AuctionConfig) => !isHost || (!lobby && !LIVE_SAFE.has(k)) || state.archived
  const set = <K extends keyof AuctionConfig>(k: K, v: AuctionConfig[K]) => setDraft({ ...draft, [k]: v })
  const changed = (Object.keys(draft) as (keyof AuctionConfig)[]).filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(cfg[k]))
  const save = async () => {
    const patch = Object.fromEntries(changed.map((k) => [k, draft[k]]))
    const r = await send('updateConfig', { patch }, { success: 'Settings saved' })
    if (!r.ok) setDraft(structuredClone(cfg))
  }
  const totalRetained = TEAM_CODES.reduce((n, t) => n + state.teams[t].squad.length, 0)

  return (
    <div className="space-y-5 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">Auction configuration</h1>
          <p className="text-sm text-white/50">
            {lobby ? 'Nothing is hard-coded. Every rule below applies to this room only.' : 'The auction is running. Only settings that are safe to change mid-auction are editable.'}
            {!isHost && ' Only the host can change settings.'}
          </p>
        </div>
        {lobby && isHost && (
          <button className="btn-gold px-6 py-3 text-base" disabled={changed.length > 0 || state.archived} onClick={() => setConfirmStart(true)} title={changed.length ? 'Save your changes first' : ''}>
            Start {cfg.auctionType} auction
          </button>
        )}
      </div>

      <div className="grid xl:grid-cols-2 gap-5">
        <Section title="Format & squads" desc="Auction type, purse and squad composition limits">
          <div className="grid grid-cols-2 gap-2">
            {(['mega', 'mini'] as const).map((t) => (
              <button key={t} disabled={ro('auctionType')} onClick={() => set('auctionType', t)} className={draft.auctionType === t ? 'btn-gold' : 'btn-ghost'}>
                {t === 'mega' ? 'Mega auction' : 'Mini auction'}
              </button>
            ))}
          </div>
          <p className="text-xs text-white/45">
            {draft.auctionType === 'mega' ? 'Mega: squads are built from scratch, with optional retentions and RTM.' : 'Mini: franchises keep retained squads; remaining purse is the starting purse minus retained salaries.'}
          </p>
          <label className="block">
            <span className="label">Starting purse per franchise</span>
            <MoneyInput className="mt-1" value={draft.startingPurse} onChange={(v) => v !== null && set('startingPurse', v)} />
            {ro('startingPurse') && !lobby && <span className="text-[11px] text-white/40">Locked after start. Use purse adjustment in Host Control for corrections.</span>}
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <NumField label="Max squad" value={draft.maxSquad} onChange={(v) => set('maxSquad', v)} disabled={ro('maxSquad')} min={1} max={60} />
            <NumField label="Min squad" value={draft.minSquad} onChange={(v) => set('minSquad', v)} disabled={ro('minSquad')} max={60} />
            <NumField label="Max overseas" value={draft.maxOverseas} onChange={(v) => set('maxOverseas', v)} disabled={ro('maxOverseas')} max={60} />
            <NumField label="Overseas in XI" value={draft.xiOverseasLimit} onChange={(v) => set('xiOverseasLimit', v)} disabled={ro('xiOverseasLimit')} max={11} />
          </div>
          <Toggle
            checked={draft.reservePurseForMinSquad}
            disabled={ro('reservePurseForMinSquad')}
            onChange={(v) => set('reservePurseForMinSquad', v)}
            label="Keep purse in reserve to complete the minimum squad"
            hint={`Max bid = purse − (open minimum slots × ${formatMoney(draft.reserveBasePrice)})`}
          />
          {draft.reservePurseForMinSquad && (
            <label className="block max-w-xs">
              <span className="label">Reserve price per open slot</span>
              <MoneyInput className="mt-1" value={draft.reserveBasePrice} onChange={(v) => v !== null && set('reserveBasePrice', v)} />
            </label>
          )}
        </Section>

        <Section title="Player pool" desc={`${poolCount} players will go under the hammer`}>
          <div className="grid grid-cols-2 gap-2">
            <button disabled={ro('poolMode')} onClick={() => set('poolMode', 'pools')} className={draft.poolMode === 'pools' ? 'btn-gold' : 'btn-ghost'}>
              Whole pools
            </button>
            <button disabled={ro('poolMode')} onClick={() => set('poolMode', 'custom')} className={draft.poolMode === 'custom' ? 'btn-gold' : 'btn-ghost'}>
              Custom selection
            </button>
          </div>
          {draft.poolMode === 'pools' ? (
            <div className="grid sm:grid-cols-3 gap-2">
              {([
                [['current'], 'Current IPL players', 'Played IPL in the last two seasons'],
                [['legend'], 'IPL legends', 'Historical greats, career stats'],
                [['current', 'legend'], 'Combined', 'Current stars and legends together'],
              ] as const).map(([pools, label, hint]) => {
                const active = draft.pools.length === pools.length && pools.every((p) => draft.pools.includes(p))
                return (
                  <button key={label} disabled={ro('pools')} onClick={() => set('pools', [...pools])} className={cls('rounded-lg border p-3 text-left transition', active ? 'border-gold-400/70 bg-gold-400/10' : 'border-white/10 hover:bg-white/5')}>
                    <div className="font-semibold text-sm">{label}</div>
                    <div className="text-xs text-white/45">{hint}</div>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="text-sm text-white/60">
              {draft.customPoolIds.length} players selected.{' '}
              <Link to="../players" className="text-gold-400 hover:underline">
                Select players in the Player database →
              </Link>
            </div>
          )}
          <p className="text-xs text-white/45">Players already retained are excluded automatically. Base prices and marquee status are edited in the Player database. After the auction starts, the host can still add players from there.</p>
        </Section>

        <Section title="Bidding & timer" desc="Increments, jump bids and countdown behaviour">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <NumField label="First-bid timer" value={draft.timerSeconds} onChange={(v) => set('timerSeconds', v)} disabled={ro('timerSeconds')} min={3} max={600} suffix="sec" />
            <NumField label="Reset after bid" value={draft.bidTimerSeconds} onChange={(v) => set('bidTimerSeconds', v)} disabled={ro('bidTimerSeconds')} min={3} max={600} suffix="sec" />
            <NumField label="Auto-next delay" value={draft.autoProgressDelay} onChange={(v) => set('autoProgressDelay', v)} disabled={ro('autoProgressDelay') || !draft.autoProgress} min={1} max={120} suffix="sec" />
          </div>
          <Toggle checked={draft.autoProgress} disabled={ro('autoProgress')} onChange={(v) => set('autoProgress', v)} label="Automatic player progression" hint="Next player goes under the hammer automatically after each lot. Off = host nominates manually." />
          <Toggle checked={draft.allowJumpBids} disabled={ro('allowJumpBids')} onChange={(v) => set('allowJumpBids', v)} label="Allow jump bids" hint="Owners may bid above the next increment." />
          <div>
            <div className="label mb-1.5">Bid increments</div>
            <div className="space-y-2">
              {draft.increments.map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="text-white/50 w-24 shrink-0">{i === 0 ? 'Below' : 'Then below'}</span>
                  {s.upTo === null || i === draft.increments.length - 1 ? (
                    <span className="input w-36 text-white/50">and above</span>
                  ) : (
                    <MoneyInput className="w-36" value={s.upTo} onChange={(v) => set('increments', draft.increments.map((x, j) => (j === i ? { ...x, upTo: v } : x)))} />
                  )}
                  <span className="text-white/50">step</span>
                  <MoneyInput className="w-36" value={s.step} onChange={(v) => v !== null && set('increments', draft.increments.map((x, j) => (j === i ? { ...x, step: v } : x)))} />
                  {!ro('increments') && draft.increments.length > 1 && (
                    <button className="btn-ghost btn-sm" onClick={() => set('increments', draft.increments.filter((_, j) => j !== i).map((x, j, arr) => (j === arr.length - 1 ? { ...x, upTo: null } : x)))}>
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            {!ro('increments') && (
              <button
                className="btn-ghost btn-sm mt-2"
                onClick={() => {
                  const inc = [...draft.increments]
                  const last = inc[inc.length - 1]
                  const prevUp = inc.length > 1 ? inc[inc.length - 2].upTo ?? 0 : 0
                  inc[inc.length - 1] = { ...last, upTo: prevUp + 500 }
                  inc.push({ upTo: null, step: last.step * 2 })
                  set('increments', inc)
                }}
              >
                + Add slab
              </button>
            )}
          </div>
        </Section>

        <Section title="Player set order" desc="Order in which categories are auctioned">
          <div className="flex flex-col gap-1 max-h-72 overflow-y-auto scroll-thin pr-1">
            {draft.setOrder.map((setName, i) => (
              <div key={setName} className="flex items-center gap-2 text-sm rounded-md bg-white/[0.03] px-2 py-1">
                <span className="w-6 text-white/35 num">{i + 1}</span>
                <span className="flex-1">{setName}</span>
                {!ro('setOrder') && (
                  <>
                    <button className="btn-ghost btn-sm" disabled={i === 0} onClick={() => set('setOrder', swap(draft.setOrder, i, i - 1))}>
                      ↑
                    </button>
                    <button className="btn-ghost btn-sm" disabled={i === draft.setOrder.length - 1} onClick={() => set('setOrder', swap(draft.setOrder, i, i + 1))}>
                      ↓
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2 flex-wrap">
            <Toggle checked={draft.shuffleWithinSet} disabled={ro('shuffleWithinSet')} onChange={(v) => set('shuffleWithinSet', v)} label="Shuffle players within each set" hint="Off = highest base price first" />
            {!ro('setOrder') && (
              <button className="btn-ghost btn-sm" onClick={() => set('setOrder', [...DEFAULT_SET_ORDER])}>
                Reset order
              </button>
            )}
          </div>
        </Section>

        <Section title="Retentions" desc={lobby ? `${totalRetained} players retained across franchises` : 'Locked after the auction starts'}>
          {draft.auctionType === 'mega' && (
            <>
              <Toggle checked={draft.retentionsEnabled} disabled={ro('retentionsEnabled')} onChange={(v) => set('retentionsEnabled', v)} label="Allow retentions before the mega auction" />
              {draft.retentionsEnabled && (
                <div className="grid grid-cols-2 gap-3 max-w-md">
                  <NumField label="Max retentions" value={draft.maxRetentions} onChange={(v) => set('maxRetentions', v)} disabled={ro('maxRetentions')} />
                  <NumField label="Max overseas retained" value={draft.maxOverseasRetentions} onChange={(v) => set('maxOverseasRetentions', v)} disabled={ro('maxOverseasRetentions')} />
                </div>
              )}
            </>
          )}
          {draft.auctionType === 'mini' && <p className="text-xs text-white/50">Mini auction: enter each franchise’s retained squad below (or carry it over from a previous season). Remaining purse is calculated automatically.</p>}
          {(draft.auctionType === 'mini' || draft.retentionsEnabled) && <RetentionEditor />}
        </Section>

        <Section title="Right to Match (RTM)" desc="Previous franchise may match the winning bid">
          <Toggle checked={draft.rtmEnabled} disabled={ro('rtmEnabled')} onChange={(v) => set('rtmEnabled', v)} label="Enable RTM cards" hint="Eligibility: the player’s last IPL franchise in season 1, or the franchise that released him in later seasons." />
          {draft.rtmEnabled && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <NumField label="Cards per team" value={draft.rtmCardsPerTeam} onChange={(v) => set('rtmCardsPerTeam', v)} disabled={ro('rtmCardsPerTeam')} max={20} />
                <NumField label="Retention + RTM cap" value={draft.rtmCombinedCap} onChange={(v) => set('rtmCombinedCap', v)} disabled={ro('rtmCombinedCap')} hint="0 = no combined cap" />
                <NumField label="Decision time" value={draft.rtmDecisionSeconds} onChange={(v) => set('rtmDecisionSeconds', v)} disabled={ro('rtmDecisionSeconds')} min={3} suffix="sec" />
              </div>
              <Toggle checked={draft.rtmFinalRaise} disabled={ro('rtmFinalRaise')} onChange={(v) => set('rtmFinalRaise', v)} label="Winning bidder gets one final raise after RTM is used" />
            </>
          )}
        </Section>

        <Section title="Trades" desc="Trading during and after the auction">
          <Toggle checked={draft.tradesEnabled} disabled={ro('tradesEnabled')} onChange={(v) => set('tradesEnabled', v)} label="Trading enabled" />
          <Toggle checked={draft.tradesDuringAuction} disabled={ro('tradesDuringAuction') || !draft.tradesEnabled} onChange={(v) => set('tradesDuringAuction', v)} label="Allow trades while the auction is running" hint="Between lots, during bidding and while paused. The player under the hammer can never be traded." />
          <Toggle checked={draft.tradeCashAllowed} disabled={ro('tradeCashAllowed') || !draft.tradesEnabled} onChange={(v) => set('tradeCashAllowed', v)} label="Allow cash in trades" />
          <Toggle checked={draft.tradeRequiresHostApproval} disabled={ro('tradeRequiresHostApproval') || !draft.tradesEnabled} onChange={(v) => set('tradeRequiresHostApproval', v)} label="Trades need host approval after both sides agree" />
        </Section>

        <Section title="Participants & spectators">
          <Toggle checked={draft.spectatorsAllowed} disabled={ro('spectatorsAllowed')} onChange={(v) => set('spectatorsAllowed', v)} label="Allow spectators (by invitation and approval)" />
          <Toggle checked={draft.spectatorsSeeTrades} disabled={ro('spectatorsSeeTrades')} onChange={(v) => set('spectatorsSeeTrades', v)} label="Spectators can see trade negotiations" />
          <Toggle checked={draft.allowMultipleTeamsPerOwner} disabled={ro('allowMultipleTeamsPerOwner')} onChange={(v) => set('allowMultipleTeamsPerOwner', v)} label="Allow one person to run several franchises" hint="Useful when fewer than 10 friends play." />
          <NumField label="Others may take over as host if the host is offline for" value={draft.hostClaimAfterSeconds} onChange={(v) => set('hostClaimAfterSeconds', v)} disabled={ro('hostClaimAfterSeconds')} min={10} max={3600} suffix="sec" />
        </Section>
      </div>

      {isHost && changed.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-30 bg-ink-900/95 backdrop-blur border-t border-gold-400/30">
          <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center gap-3 justify-end">
            <span className="text-sm text-white/60 mr-auto">{changed.length} unsaved change{changed.length > 1 ? 's' : ''}</span>
            <button className="btn-ghost" onClick={() => setDraft(structuredClone(cfg))}>
              Discard
            </button>
            <button className="btn-gold" onClick={save}>
              Save settings
            </button>
          </div>
        </div>
      )}

      <Confirm
        open={confirmStart}
        onClose={() => setConfirmStart(false)}
        title={`Start the ${cfg.auctionType} auction?`}
        confirmLabel="Start auction"
        onConfirm={() => send('startAuction', {}, { success: 'Auction started' })}
        body={
          <ul className="space-y-1">
            <li>{poolCount} players in the pool</li>
            <li>Starting purse {formatMoney(cfg.startingPurse)} · squads {cfg.minSquad}–{cfg.maxSquad} · max {cfg.maxOverseas} overseas</li>
            <li>{totalRetained} retained players</li>
            <li>RTM {cfg.rtmEnabled ? `on (${cfg.rtmCardsPerTeam} per team)` : 'off'} · trades {cfg.tradesEnabled ? 'on' : 'off'}</li>
            <li className="text-white/50">Purse, pool and retention settings lock once started.</li>
          </ul>
        }
      />
    </div>
  )
}

function swap<T>(a: T[], i: number, j: number) {
  const b = [...a]
  ;[b[i], b[j]] = [b[j], b[i]]
  return b
}

function RetentionEditor() {
  const { state, isHost, send, players, library } = useRoom()
  const [team, setTeam] = useState<TeamCode>('MI')
  const [price, setPrice] = useState<number | null>(1800)
  if (!state) return null
  const lobby = state.phase === 'lobby'
  const editable = isHost && lobby && !state.archived
  const owned = new Set(TEAM_CODES.flatMap((c) => state.teams[c].squad.map((e) => e.playerId)))
  const t = state.teams[team]
  const retainedTotal = t.squad.reduce((n, e) => n + e.price, 0)

  async function importCsv(file: File) {
    const rows = parseCsv(await file.text()).map((r) => ({ team: r.team ?? r.Team, player: r.player ?? r.Player ?? r.name, price: Number(r.price ?? r.Price) }))
    await send('importRetentions', { rows }, { success: `Imported ${rows.length} retentions` })
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1 flex-wrap">
        {TEAM_CODES.map((c) => (
          <button key={c} onClick={() => setTeam(c)} className={cls('rounded-lg p-0.5 border', team === c ? 'border-gold-400' : 'border-transparent')}>
            <TeamBadge code={c} size="sm" />
            <div className="text-[10px] text-white/50 num">{state.teams[c].squad.length}</div>
          </button>
        ))}
      </div>
      <div className="rounded-lg border border-white/[0.07]">
        <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06] text-sm">
          <span className="font-semibold">{TEAM_META[team].name}</span>
          <span className="text-white/60">
            Retained <Money v={retainedTotal} /> · Remaining <Money v={t.purse} className="text-gold-300" /> · OS {overseasCount(t, library)}
          </span>
        </div>
        {t.squad.length === 0 && <div className="text-sm text-white/40 px-3 py-3">No retained players.</div>}
        {t.squad.map((e) => (
          <div key={e.playerId} className="flex items-center gap-2 px-3 py-1.5 text-sm border-b border-white/[0.04] last:border-0">
            <span className="flex-1 truncate">
              {library[e.playerId]?.name ?? e.playerId}
              {library[e.playerId]?.overseas && <span className="text-amber-300 text-xs"> · OS</span>}
            </span>
            {editable ? (
              <RetentionPrice value={e.price} onSave={(v) => send('setRetention', { team, playerId: e.playerId, price: v })} />
            ) : (
              <Money v={e.price} />
            )}
            {editable && (
              <button className="btn-ghost btn-sm" onClick={() => send('releasePlayer', { team, playerId: e.playerId })}>
                Release
              </button>
            )}
          </div>
        ))}
      </div>
      {editable && (
        <div className="grid sm:grid-cols-[1fr_9rem] gap-2">
          <PlayerPicker players={players} exclude={owned} placeholder={`Retain a player for ${team}…`} onPick={(p) => price !== null && send('setRetention', { team, playerId: p.id, price })} />
          <MoneyInput value={price} onChange={setPrice} placeholder="Price" />
        </div>
      )}
      {editable && (
        <div className="flex items-center gap-3 text-xs text-white/50">
          <label className="btn-ghost btn-sm cursor-pointer">
            Import retentions CSV
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
          </label>
          <a className="hover:text-white underline" href="/api/templates/retentions.csv">
            Template (team, player, price in lakh)
          </a>
        </div>
      )}
    </div>
  )
}

function RetentionPrice({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [v, setV] = useState<number | null>(value)
  useEffect(() => setV(value), [value])
  return (
    <div className="flex gap-1 items-center">
      <MoneyInput className="w-32" value={v} onChange={setV} />
      {v !== value && v !== null && (
        <button className="btn-gold btn-sm" onClick={() => onSave(v)}>
          Save
        </button>
      )}
    </div>
  )
}
