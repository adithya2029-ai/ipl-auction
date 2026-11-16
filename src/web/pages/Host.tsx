import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import type { TeamCode } from '@shared/types'
import { TEAM_CODES } from '@shared/types'
import { ROLE_LABEL, formatMoney } from '@shared/rules'
import { forgetSession, useRoom } from '../lib/room'
import { cls } from '../lib/helpers'
import { Confirm, Modal, Money, MoneyInput, PlayerPicker, TeamBadge } from '../components/ui'
import { InviteBox } from './Lobby'

function Box({ title, desc, children, className }: { title: string; desc?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cls('card', className)}>
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

export default function Host() {
  const { state, isHost } = useRoom()
  if (!state) return null
  if (!isHost) return <Navigate to="../live" replace />
  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-3xl font-bold">Host control</h1>
        <p className="text-sm text-white/50">Every action is validated by the server and written to the permanent log. You can hand these controls to anyone at any time.</p>
      </div>
      <div className="grid xl:grid-cols-3 lg:grid-cols-2 gap-5">
        <FlowBox />
        <CurrentLotBox />
        <QueueBox />
        <UnsoldBox />
        <CorrectionsBox />
        <PurseBox />
        <ParticipantsBox />
        <TransferBox />
        <RoomBox />
      </div>
    </div>
  )
}

function FlowBox() {
  const { state, send } = useRoom()
  const nav = useNavigate()
  const [confirm, setConfirm] = useState<null | 'end' | 'reopen' | 'mini' | 'mega'>(null)
  const s = state!
  return (
    <Box title="Auction flow" desc={`Phase: ${s.phase}${s.paused ? ' (paused)' : ''} · round ${s.round} · season ${s.season}`}>
      <div className="grid grid-cols-2 gap-2">
        {s.phase === 'lobby' && (
          <button className="btn-gold col-span-2" onClick={() => nav('../config')}>
            Configure &amp; start auction
          </button>
        )}
        {s.phase === 'live' && (
          <>
            {s.paused ? (
              <button className="btn-gold" onClick={() => send('resume')}>
                Resume auction
              </button>
            ) : (
              <button className="btn-ghost" onClick={() => send('pause')}>
                Pause auction
              </button>
            )}
            <button className="btn-ghost" disabled={!!s.current} onClick={() => setConfirm('end')}>
              End auction
            </button>
          </>
        )}
        {s.phase === 'completed' && (
          <>
            <button className="btn-gold" onClick={() => setConfirm('reopen')}>
              Reopen auction
            </button>
            <button className="btn-ghost" onClick={() => setConfirm('mini')}>
              New season: mini auction
            </button>
            <button className="btn-ghost col-span-2" onClick={() => setConfirm('mega')}>
              New season: mega auction (release everyone)
            </button>
          </>
        )}
      </div>
      {s.phase === 'live' && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-white/60">Automatic progression</span>
          <button className={s.config.autoProgress ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'} onClick={() => send('updateConfig', { patch: { autoProgress: !s.config.autoProgress } })}>
            {s.config.autoProgress ? `On (${s.config.autoProgressDelay}s)` : 'Off'}
          </button>
        </div>
      )}
      {s.phase === 'live' && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-white/60">Trading</span>
          <div className="flex gap-1">
            <button className={s.config.tradesEnabled ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'} onClick={() => send('updateConfig', { patch: { tradesEnabled: !s.config.tradesEnabled } })}>
              {s.config.tradesEnabled ? 'Enabled' : 'Disabled'}
            </button>
            <button className={s.config.tradeRequiresHostApproval ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'} onClick={() => send('updateConfig', { patch: { tradeRequiresHostApproval: !s.config.tradeRequiresHostApproval } })}>
              Host approval {s.config.tradeRequiresHostApproval ? 'on' : 'off'}
            </button>
          </div>
        </div>
      )}
      <Confirm open={confirm === 'end'} onClose={() => setConfirm(null)} title="End the auction?" body="Squads become final and the transfer market opens. You can reopen the auction later." onConfirm={() => send('endAuction')} />
      <Confirm open={confirm === 'reopen'} onClose={() => setConfirm(null)} title="Reopen the auction?" body="Bidding resumes from the current state. You can recall unsold players or start another unsold round." onConfirm={() => send('reopenAuction')} />
      <Confirm open={confirm === 'mini'} onClose={() => setConfirm(null)} title="Start a new season with a mini auction?" body="Every franchise keeps its squad as retained players. Before starting, release players in Configuration → Retentions and set the new purse. This season’s results are archived in history." onConfirm={() => send('startNewSession', { auctionType: 'mini' })} />
      <Confirm open={confirm === 'mega'} onClose={() => setConfirm(null)} title="Start a new season with a mega auction?" body="All squads are released back into the pool (RTM eligible to their previous franchise). This season’s results are archived." danger onConfirm={() => send('startNewSession', { auctionType: 'mega' })} />
    </Box>
  )
}

function CurrentLotBox() {
  const { state, library, send } = useRoom()
  const [secs, setSecs] = useState(15)
  const [base, setBase] = useState<number | null>(null)
  const s = state!
  const c = s.current
  const p = c ? library[c.playerId] : null
  useEffect(() => setBase(c ? s.lots[c.playerId].basePrice : null), [c?.lotKey]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Box title="Player under the hammer" desc={p ? `${p.name} · ${c!.phase.replace('_', ' ')}` : 'No live lot'}>
      {!c || !p ? (
        <div className="space-y-2">
          <button className="btn-gold w-full" disabled={s.phase !== 'live' || !s.queue.length} onClick={() => send('nominate')}>
            Put next player under the hammer
          </button>
          <div className="text-xs text-white/45">Next: {s.queue[0] ? library[s.queue[0]]?.name : 'queue empty'}</div>
        </div>
      ) : (
        <>
          <div className="text-sm">
            High bid: {c.high ? <><TeamBadge code={c.high.team} size="xs" /> <Money v={c.high.amount} className="text-gold-300" /></> : 'none'} · {c.bids.length} bids
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-gold" onClick={() => send('hammer')}>
              {c.phase === 'bidding' ? 'Mark sold now' : 'Resolve RTM step'}
            </button>
            <button className="btn-ghost" onClick={() => send('markUnsold')}>
              Mark unsold
            </button>
            <button className="btn-ghost" onClick={() => send('skip')}>
              Skip (recall later)
            </button>
            <button className="btn-ghost" onClick={() => send(s.paused ? 'resume' : 'pause')}>
              {s.paused ? 'Resume' : 'Pause'}
            </button>
          </div>
          <div className="flex gap-2 items-center">
            <input type="number" className="input w-20" value={secs} min={3} max={600} onChange={(e) => setSecs(Number(e.target.value))} />
            <button className="btn-ghost btn-sm" onClick={() => send('resetTimer', { seconds: secs })}>
              Set timer to {secs}s
            </button>
          </div>
          {c.bids.length === 0 && (
            <div className="flex gap-2 items-center">
              <MoneyInput className="flex-1" value={base} onChange={setBase} />
              <button className="btn-ghost btn-sm" disabled={!base} onClick={() => send('setBasePrice', { playerId: c.playerId, amount: base }, { success: 'Base price changed' })}>
                Change base
              </button>
            </div>
          )}
        </>
      )}
    </Box>
  )
}

function QueueBox() {
  const { state, library, players, send } = useRoom()
  const s = state!
  const sidelined = Object.values(s.lots).filter((l) => l.status === 'skipped' || l.status === 'unsold')
  const pickable = useMemo(() => players.filter((p) => s.lots[p.id] && ['pending', 'unsold', 'skipped'].includes(s.lots[p.id].status)), [players, s.lots])
  return (
    <Box title="Queue & recall" desc={`${s.queue.length} queued · ${sidelined.length} skipped/unsold`}>
      <div>
        <div className="label mb-1">Nominate a specific player</div>
        <PlayerPicker players={pickable} placeholder="Search available players…" onPick={(p) => send('nominate', { playerId: p.id })} />
      </div>
      <div className="max-h-40 overflow-y-auto scroll-thin space-y-0.5">
        {s.queue.slice(0, 15).map((id, i) => (
          <div key={id} className="flex items-center gap-2 text-sm">
            <span className="w-5 text-white/35 num">{i + 1}</span>
            <span className="flex-1 truncate">{library[id]?.name}</span>
            <span className="text-[11px] text-white/40 truncate max-w-[8rem]">{s.lots[id]?.set}</span>
            <button className="btn-ghost btn-sm" onClick={() => send('skip', { playerId: id })}>
              Skip
            </button>
          </div>
        ))}
      </div>
      {s.queue.length > 0 && (
        <button className="btn-ghost btn-sm" onClick={() => send('skipRemaining', {}, { success: 'Queue cleared into unsold/skipped' })}>
          End this pass: set remaining {s.queue.length} aside
        </button>
      )}
      {sidelined.length > 0 && (
        <div>
          <div className="label mb-1">Recall to front of queue</div>
          <div className="max-h-40 overflow-y-auto scroll-thin space-y-0.5">
            {sidelined.slice(0, 50).map((l) => (
              <div key={l.playerId} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate">{library[l.playerId]?.name}</span>
                <span className="text-[11px] text-white/40">{l.status}</span>
                <button className="btn-ghost btn-sm" disabled={s.phase !== 'live'} onClick={() => send('recall', { playerId: l.playerId })}>
                  Recall
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Box>
  )
}

function UnsoldBox() {
  const { state, library, send } = useRoom()
  const s = state!
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [onlyAuctioned, setOnlyAuctioned] = useState(true)
  const list = Object.values(s.lots)
    .filter((l) => (l.status === 'unsold' || l.status === 'skipped') && (!onlyAuctioned || l.attempts.length > 0))
    .sort((a, b) => b.basePrice - a.basePrice)
  const all = list.length > 0 && list.every((l) => sel.has(l.playerId))
  return (
    <Box title="Unsold rounds" desc={`Unlimited rounds. ${s.round > 1 ? `${s.round - 1} unsold round(s) run so far.` : 'None run yet.'}`}>
      <div className="flex items-center gap-2 text-xs">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={all} onChange={() => setSel(all ? new Set() : new Set(list.map((l) => l.playerId)))} /> Select all ({list.length})
        </label>
        <label className="flex items-center gap-1.5 ml-auto text-white/55">
          <input type="checkbox" checked={onlyAuctioned} onChange={(e) => setOnlyAuctioned(e.target.checked)} /> only players already auctioned
        </label>
      </div>
      <div className="max-h-56 overflow-y-auto scroll-thin rounded-lg border border-white/[0.06]">
        {list.length === 0 && <div className="text-sm text-white/40 p-3">No unsold players.</div>}
        {list.map((l) => {
          const p = library[l.playerId]
          return (
            <label key={l.playerId} className="flex items-center gap-2 px-3 py-1.5 text-sm border-b border-white/[0.04] cursor-pointer hover:bg-white/[0.03]">
              <input type="checkbox" checked={sel.has(l.playerId)} onChange={() => setSel((x) => (x.has(l.playerId) ? (x.delete(l.playerId), new Set(x)) : new Set(x.add(l.playerId))))} />
              <span className="flex-1 truncate">
                {p?.name} <span className="text-[11px] text-white/40">{p ? ROLE_LABEL[p.role] : ''}</span>
              </span>
              <span className="text-[11px] text-white/40">
                {l.attempts.length} attempt{l.attempts.length === 1 ? '' : 's'} · base {formatMoney(l.originalBasePrice)}
                {l.basePrice !== l.originalBasePrice && ` → ${formatMoney(l.basePrice)}`}
              </span>
            </label>
          )
        })}
      </div>
      <button className="btn-gold w-full" disabled={!sel.size || s.phase !== 'live' || !!s.current} onClick={() => send('startUnsoldRound', { playerIds: [...sel] }, { success: 'Unsold round started' }).then((r) => r.ok && setSel(new Set()))}>
        Start unsold round with {sel.size} player{sel.size === 1 ? '' : 's'}
      </button>
      {s.phase === 'completed' && <div className="text-xs text-amber-200/70">Reopen the auction to run another unsold round.</div>}
    </Box>
  )
}

function CorrectionsBox() {
  const { state, library, send } = useRoom()
  const s = state!
  const [edit, setEdit] = useState<string | null>(null)
  const [team, setTeam] = useState<TeamCode>('MI')
  const [price, setPrice] = useState<number | null>(null)
  const [assign, setAssign] = useState<{ id: string } | null>(null)
  const [undoConfirm, setUndoConfirm] = useState(false)
  const sold = Object.values(s.lots)
    .filter((l) => l.status === 'sold')
    .sort((a, b) => (b.attempts[b.attempts.length - 1]?.endedAt ?? 0) - (a.attempts[a.attempts.length - 1]?.endedAt ?? 0))
  const lastTx = [...s.ledger].reverse().find((t) => !t.undone && ['sale', 'manual_assign', 'trade', 'purse_adjust', 'sale_correction'].includes(t.type))
  const describeTx = () => {
    if (!lastTx) return 'Nothing to undo'
    const d = lastTx.data as Record<string, any>
    if (lastTx.type === 'trade') return `Trade ${d.from} ⇄ ${d.to}`
    if (lastTx.type === 'purse_adjust') return `Purse adjustment ${d.team} ${formatMoney(d.delta)}`
    return `${lastTx.type.replace('_', ' ')}: ${library[d.playerId]?.name} → ${d.team} ${formatMoney(d.amount)}`
  }
  const available = useMemo(() => Object.values(library).filter((p) => !s.lots[p.id] || ['pending', 'unsold', 'skipped'].includes(s.lots[p.id].status)), [library, s.lots])
  return (
    <Box title="Corrections" desc="Fix mistakes without restarting anything">
      <div className="rounded-lg bg-white/[0.03] p-3 flex items-center gap-2">
        <div className="flex-1 min-w-0 text-sm">
          <div className="label">Last transaction</div>
          <div className="truncate">{describeTx()}</div>
        </div>
        <button className="btn-ghost btn-sm" disabled={!lastTx || s.phase === 'lobby'} onClick={() => setUndoConfirm(true)}>
          Undo
        </button>
      </div>
      <div>
        <div className="label mb-1">Assign a player directly (manual sale)</div>
        <PlayerPicker players={available} placeholder="Search player to assign…" onPick={(p) => (setAssign({ id: p.id }), setPrice(s.lots[p.id]?.basePrice ?? p.basePrice))} />
      </div>
      <div className="label">Sold players</div>
      <div className="max-h-56 overflow-y-auto scroll-thin space-y-0.5">
        {sold.length === 0 && <div className="text-sm text-white/40">Nothing sold yet.</div>}
        {sold.map((l) => (
          <div key={l.playerId} className="flex items-center gap-2 text-sm">
            <TeamBadge code={l.soldTo} size="xs" />
            <span className="flex-1 truncate">{library[l.playerId]?.name}</span>
            <Money v={l.soldPrice} className="text-xs" />
            <button className="btn-ghost btn-sm" onClick={() => (setEdit(l.playerId), setTeam(l.soldTo!), setPrice(l.soldPrice))}>
              Correct
            </button>
          </div>
        ))}
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={`Correct sale: ${edit ? library[edit]?.name : ''}`}>
        {edit && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1">
              {TEAM_CODES.map((t) => (
                <button key={t} onClick={() => setTeam(t)} className={cls('rounded-md p-0.5 border', team === t ? 'border-gold-400' : 'border-transparent')}>
                  <TeamBadge code={t} size="sm" />
                </button>
              ))}
            </div>
            <MoneyInput value={price} onChange={setPrice} />
            <div className="flex flex-wrap gap-2 justify-end">
              <button className="btn-danger" onClick={() => send('revertSale', { playerId: edit, to: 'unsold' }).then((r) => r.ok && setEdit(null))}>
                Revert to unsold
              </button>
              <button className="btn-ghost" onClick={() => send('revertSale', { playerId: edit, to: 'queue' }).then((r) => r.ok && setEdit(null))}>
                Re-auction (front of queue)
              </button>
              <button className="btn-gold" disabled={price === null} onClick={() => send('correctSale', { playerId: edit, team, amount: price }, { success: 'Sale corrected' }).then((r) => r.ok && setEdit(null))}>
                Save correction
              </button>
            </div>
            <p className="text-xs text-white/45">The original buyer is refunded and the new buyer is charged in one atomic step, with squad and overseas checks applied.</p>
          </div>
        )}
      </Modal>
      <Modal open={!!assign} onClose={() => setAssign(null)} title={`Assign ${assign ? library[assign.id]?.name : ''}`}>
        {assign && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1">
              {TEAM_CODES.map((t) => (
                <button key={t} onClick={() => setTeam(t)} className={cls('rounded-md p-0.5 border', team === t ? 'border-gold-400' : 'border-transparent')}>
                  <TeamBadge code={t} size="sm" />
                </button>
              ))}
            </div>
            <MoneyInput value={price} onChange={setPrice} />
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setAssign(null)}>
                Cancel
              </button>
              <button className="btn-gold" disabled={price === null || s.phase === 'lobby'} onClick={() => send('manualAssign', { playerId: assign.id, team, amount: price }, { success: 'Player assigned' }).then((r) => r.ok && setAssign(null))}>
                Assign to {team}
              </button>
            </div>
          </div>
        )}
      </Modal>
      <Confirm open={undoConfirm} onClose={() => setUndoConfirm(false)} title="Undo last transaction?" body={describeTx()} confirmLabel="Undo" onConfirm={() => send('undoLast', {}, { success: 'Undone' })} />
    </Box>
  )
}

function PurseBox() {
  const { state, send } = useRoom()
  const s = state!
  const [team, setTeam] = useState<TeamCode>('MI')
  const [delta, setDelta] = useState<number | null>(null)
  const [neg, setNeg] = useState(false)
  const [reason, setReason] = useState('')
  const [rtm, setRtm] = useState(0)
  useEffect(() => setRtm(s.teams[team].rtmCards), [team, s.teams])
  return (
    <Box title="Purse & RTM adjustments" desc="Recorded in the ledger and undoable">
      <div className="flex flex-wrap gap-1">
        {TEAM_CODES.map((t) => (
          <button key={t} onClick={() => setTeam(t)} className={cls('rounded-md p-0.5 border', team === t ? 'border-gold-400' : 'border-transparent')}>
            <TeamBadge code={t} size="sm" />
          </button>
        ))}
      </div>
      <div className="text-sm">
        {team} purse: <Money v={s.teams[team].purse} className="text-gold-300" /> · RTM cards: {s.teams[team].rtmCards}
      </div>
      <div className="flex gap-2">
        <button className="btn-ghost w-12" onClick={() => setNeg(!neg)}>
          {neg ? '−' : '+'}
        </button>
        <MoneyInput className="flex-1" value={delta} onChange={setDelta} placeholder="Amount" />
      </div>
      <input className="input" placeholder="Reason (shown in history)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button className="btn-ghost w-full" disabled={!delta || s.phase === 'lobby'} onClick={() => send('adjustPurse', { team, delta: (neg ? -1 : 1) * (delta ?? 0), reason }, { success: 'Purse adjusted' })}>
        Apply {neg ? '−' : '+'}
        {formatMoney(delta ?? 0)} to {team}
      </button>
      <div className="flex gap-2 items-center">
        <span className="text-sm text-white/60 flex-1">RTM cards for {team}</span>
        <input type="number" className="input w-20" min={0} max={20} value={rtm} onChange={(e) => setRtm(Number(e.target.value))} />
        <button className="btn-ghost btn-sm" onClick={() => send('setRtmCards', { team, cards: rtm })}>
          Set
        </button>
      </div>
    </Box>
  )
}

function ParticipantsBox() {
  const { state, send, me } = useRoom()
  const s = state!
  const [confirm, setConfirm] = useState<{ id: string; ban: boolean } | null>(null)
  const list = Object.values(s.members).sort((a, b) => a.joinedAt - b.joinedAt)
  const taken = new Set(list.filter((m) => m.status === 'approved').flatMap((m) => m.teamIds))
  return (
    <Box title="Participants" desc={`${list.filter((m) => m.status === 'approved').length} approved · ${list.filter((m) => m.status === 'pending').length} pending`} className="lg:col-span-2 xl:col-span-1">
      <div className="space-y-2 max-h-[28rem] overflow-y-auto scroll-thin pr-1">
        {list.map((m) => (
          <div key={m.id} className="rounded-lg border border-white/[0.06] p-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <span className={cls('h-2 w-2 rounded-full', s.online.includes(m.id) ? 'bg-emerald-400' : 'bg-white/20')} />
              <span className="font-medium text-sm flex-1 truncate">
                {m.name} {m.id === me?.id && <span className="text-white/40">(you)</span>}
              </span>
              <span className="text-[11px] text-white/45">{m.status === 'approved' ? m.role : m.status}</span>
            </div>
            {m.status === 'pending' && (
              <div className="flex gap-1.5 flex-wrap">
                <button className="btn-gold btn-sm" onClick={() => send('approveMember', { memberId: m.id })}>
                  Approve
                </button>
                <button className="btn-ghost btn-sm" onClick={() => send('approveMember', { memberId: m.id, role: 'spectator' })}>
                  As spectator
                </button>
                <button className="btn-danger btn-sm" onClick={() => send('rejectMember', { memberId: m.id })}>
                  Decline
                </button>
              </div>
            )}
            {m.status === 'approved' && (
              <div className="flex gap-1.5 flex-wrap items-center">
                <select className="input w-auto py-1 text-xs" value={m.teamIds[0] ?? ''} onChange={(e) => e.target.value && send('assignTeam', { memberId: m.id, team: e.target.value })}>
                  <option value="">{m.teamIds.length ? m.teamIds.join(', ') : 'Assign franchise…'}</option>
                  {TEAM_CODES.filter((t) => !taken.has(t) || m.teamIds.includes(t)).map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <button className="btn-ghost btn-sm" onClick={() => send('setMemberRole', { memberId: m.id, role: m.role === 'owner' ? 'spectator' : 'owner' })}>
                  Make {m.role === 'owner' ? 'spectator' : 'owner'}
                </button>
                {m.id !== s.hostId && (
                  <>
                    <button className="btn-ghost btn-sm" onClick={() => setConfirm({ id: m.id, ban: false })}>
                      Remove
                    </button>
                    <button className="btn-danger btn-sm" onClick={() => setConfirm({ id: m.id, ban: true })}>
                      Ban
                    </button>
                  </>
                )}
              </div>
            )}
            {(m.status === 'banned' || m.status === 'removed' || m.status === 'rejected') && (
              <button className="btn-ghost btn-sm" onClick={() => send('unbanMember', { memberId: m.id })}>
                Restore (back to pending)
              </button>
            )}
          </div>
        ))}
      </div>
      <Confirm
        open={!!confirm}
        onClose={() => setConfirm(null)}
        danger
        title={confirm?.ban ? 'Ban participant?' : 'Remove participant?'}
        body={`${confirm ? s.members[confirm.id]?.name : ''} will be disconnected. Their franchise keeps its squad and purse but has no owner until you reassign it.`}
        onConfirm={() => confirm && send('removeMember', { memberId: confirm.id, ban: confirm.ban })}
      />
    </Box>
  )
}

function TransferBox() {
  const { state, send, me } = useRoom()
  const s = state!
  const [to, setTo] = useState('')
  const [confirm, setConfirm] = useState(false)
  const candidates = Object.values(s.members).filter((m) => m.status === 'approved' && m.id !== me?.id)
  return (
    <Box title="Transfer host privileges" desc="Safe hand-over: the auction, timer, bids and purses are untouched">
      {s.pendingHostTransfer ? (
        <div className="space-y-2 text-sm">
          <div>
            Waiting for <b>{s.members[s.pendingHostTransfer.to]?.name}</b> to accept…
          </div>
          <button className="btn-ghost btn-sm" onClick={() => send('cancelHostTransfer')}>
            Cancel transfer
          </button>
        </div>
      ) : (
        <>
          <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Choose a participant…</option>
            {candidates.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} {m.teamIds.length ? `(${m.teamIds.join(', ')})` : m.role === 'spectator' ? '(spectator)' : ''} {s.online.includes(m.id) ? '' : '· offline'}
              </option>
            ))}
          </select>
          <button className="btn-gold w-full" disabled={!to} onClick={() => setConfirm(true)}>
            Offer host controls
          </button>
          <p className="text-xs text-white/45">They must accept. Until then you remain host. Only one host exists at any moment; you become a normal participant afterwards.</p>
        </>
      )}
      <Confirm open={confirm} onClose={() => setConfirm(false)} title="Offer host controls?" body={`${s.members[to]?.name} will receive a prompt. Once accepted, you lose host controls immediately.`} onConfirm={() => send('requestHostTransfer', { memberId: to }, { success: 'Host offer sent' })} />
    </Box>
  )
}

function RoomBox() {
  const { state, send, code } = useRoom()
  const nav = useNavigate()
  const s = state!
  const [name, setName] = useState(s.name)
  const [pw, setPw] = useState('')
  const [del, setDel] = useState('')
  const [delOpen, setDelOpen] = useState(false)
  return (
    <Box title="Room settings" desc="Access, archive and deletion">
      <InviteBox />
      <div className="flex gap-2">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        <button className="btn-ghost btn-sm" disabled={!name.trim() || name === s.name} onClick={() => send('renameRoom', { name }, { success: 'Renamed' })}>
          Rename
        </button>
      </div>
      <div className="flex gap-2">
        <input className="input" type="password" placeholder="New room password (blank = none)" value={pw} onChange={(e) => setPw(e.target.value)} />
        <button className="btn-ghost btn-sm" onClick={() => send('setPassword', { password: pw }, { success: pw ? 'Password set' : 'Password removed' }).then(() => setPw(''))}>
          {pw ? 'Set' : 'Clear'}
        </button>
      </div>
      <button className="btn-ghost btn-sm" onClick={() => send('regenerateInvite', {}, { success: 'New invite link generated. Old links stop working.' })}>
        Regenerate invite link
      </button>
      <div className="flex gap-2">
        <button className="btn-ghost btn-sm" disabled={!!s.current} onClick={() => send('setArchived', { archived: !s.archived })}>
          {s.archived ? 'Restore room' : 'Archive room (read-only)'}
        </button>
        <button className="btn-danger btn-sm" onClick={() => setDelOpen(true)}>
          Delete room
        </button>
      </div>
      <Modal open={delOpen} onClose={() => setDelOpen(false)} title="Delete room permanently">
        <div className="space-y-3 text-sm">
          <p className="text-white/70">This deletes all squads, history and settings for everyone. Export results first if you want a record. Type the room code to confirm.</p>
          <input className="input font-display tracking-widest uppercase" value={del} onChange={(e) => setDel(e.target.value.toUpperCase())} placeholder={code} />
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setDelOpen(false)}>
              Cancel
            </button>
            <button
              className="btn-danger"
              disabled={del !== code}
              onClick={() =>
                send('deleteRoom', { confirm: del }).then((r) => {
                  if (r.ok) {
                    forgetSession(code)
                    nav('/')
                  }
                })
              }
            >
              Delete forever
            </button>
          </div>
        </div>
      </Modal>
    </Box>
  )
}
