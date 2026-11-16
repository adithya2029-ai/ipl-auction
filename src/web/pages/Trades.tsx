import { useMemo, useState } from 'react'
import type { TeamCode, Trade, TradeSide } from '@shared/types'
import { TEAM_CODES } from '@shared/types'
import { ROLE_LABEL, TEAM_META, formatMoney, overseasCount } from '@shared/rules'
import { useRoom } from '../lib/room'
import { availablePurse, cls, relTime } from '../lib/helpers'
import { Empty, Modal, Money, MoneyInput, TeamBadge } from '../components/ui'

const STATUS_STYLE: Record<string, string> = {
  pending: 'text-sky-300 border-sky-400/30',
  awaiting_host: 'text-gold-300 border-gold-400/40',
  completed: 'text-emerald-300 border-emerald-400/30',
  rejected: 'text-red-300 border-red-400/30',
  countered: 'text-indigo-300 border-indigo-400/30',
  cancelled: 'text-white/50 border-white/15',
  vetoed: 'text-red-300 border-red-400/30',
  failed: 'text-red-300 border-red-400/30',
  reversed: 'text-white/50 border-white/15',
}

export default function Trades() {
  const { state, myTeams, isHost } = useRoom()
  const [compose, setCompose] = useState<{ from: TeamCode; to: TeamCode; give?: TradeSide; receive?: TradeSide; counterOf?: Trade } | null>(null)
  if (!state) return null
  const cfg = state.config
  const trades = Object.values(state.trades).sort((a, b) => b.createdAt - a.createdAt)
  const open = (t: Trade) => t.status === 'pending' || t.status === 'awaiting_host'
  const incoming = trades.filter((t) => open(t) && myTeams.includes(t.to))
  const outgoing = trades.filter((t) => open(t) && myTeams.includes(t.from))
  const awaitingHost = trades.filter((t) => t.status === 'awaiting_host')
  const others = trades.filter((t) => open(t) && !myTeams.includes(t.to) && !myTeams.includes(t.from))
  const done = trades.filter((t) => !open(t))
  const tradingOpen = cfg.tradesEnabled && !state.archived && (state.phase === 'completed' || (state.phase === 'live' && cfg.tradesDuringAuction) || (state.phase === 'lobby' && state.season > 1))
  const why = !cfg.tradesEnabled ? 'Trading is disabled by the host.' : state.archived ? 'Room archived.' : state.phase === 'lobby' ? 'Trading opens once the auction starts.' : state.phase === 'live' && !cfg.tradesDuringAuction ? 'Trading during the auction is disabled. The transfer market opens after the auction.' : ''

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">{state.phase === 'completed' ? 'Transfer market' : 'Trade centre'}</h1>
          <p className="text-sm text-white/50">
            Player-for-player, player-for-cash and multi-player deals. Trades are validated and applied atomically: everything moves or nothing does.
            {cfg.tradeRequiresHostApproval && ' Agreed trades need host approval.'}
          </p>
        </div>
        {myTeams.length > 0 && (
          <button className="btn-gold" disabled={!tradingOpen} onClick={() => setCompose({ from: myTeams[0], to: TEAM_CODES.find((t) => !myTeams.includes(t))! })}>
            + Propose a trade
          </button>
        )}
      </div>
      {!tradingOpen && <div className="card p-3 text-sm text-amber-200/80">{why}</div>}

      <div className="grid lg:grid-cols-2 gap-5">
        <Panel title={`Incoming offers (${incoming.length})`}>
          {incoming.length ? incoming.map((t) => <TradeCard key={t.id} t={t} onCounter={() => setCompose({ from: t.to, to: t.from, give: t.receive, receive: t.give, counterOf: t })} />) : <Empty>No offers waiting for you</Empty>}
        </Panel>
        <Panel title={`Your proposals (${outgoing.length})`}>{outgoing.length ? outgoing.map((t) => <TradeCard key={t.id} t={t} />) : <Empty>You have no open proposals</Empty>}</Panel>
        {isHost && cfg.tradeRequiresHostApproval && (
          <Panel title={`Awaiting your approval (${awaitingHost.length})`}>{awaitingHost.length ? awaitingHost.map((t) => <TradeCard key={t.id} t={t} />) : <Empty>Nothing to approve</Empty>}</Panel>
        )}
        {others.length > 0 && <Panel title={`Other negotiations (${others.length})`}>{others.map((t) => <TradeCard key={t.id} t={t} />)}</Panel>}
      </div>

      <Panel title={`Trade history (${done.length})`}>{done.length ? done.map((t) => <TradeCard key={t.id} t={t} compact />) : <Empty>No completed or closed trades yet</Empty>}</Panel>

      {compose && <Compose init={compose} onClose={() => setCompose(null)} />}
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="card-hd">
        <div className="font-semibold">{title}</div>
      </div>
      <div className="p-3 space-y-3">{children}</div>
    </div>
  )
}

function SideView({ team, side }: { team: TeamCode; side: TradeSide }) {
  const { library } = useRoom()
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-1.5">
        <TeamBadge code={team} size="xs" />
        <span className="label">{team} sends</span>
      </div>
      <div className="space-y-0.5">
        {side.players.map((id) => (
          <div key={id} className="text-sm truncate">
            {library[id]?.name ?? id}
            <span className="text-[11px] text-white/40"> {library[id] ? ROLE_LABEL[library[id].role] : ''}{library[id]?.overseas ? ' · OS' : ''}</span>
          </div>
        ))}
        {side.cash > 0 && <Money v={side.cash} className="text-sm text-gold-300" />}
        {side.players.length === 0 && side.cash === 0 && <div className="text-sm text-white/35">Nothing</div>}
      </div>
    </div>
  )
}

function TradeCard({ t, onCounter, compact }: { t: Trade; onCounter?: () => void; compact?: boolean }) {
  const { state, myTeams, isHost, send } = useRoom()
  if (!state) return null
  const mineTo = myTeams.includes(t.to)
  const mineFrom = myTeams.includes(t.from)
  const proposer = state.members[t.proposedBy]?.name
  return (
    <div className={cls('rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 space-y-3', t.status === 'pending' && mineTo && 'border-indigo-400/40')}>
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className={cls('chip bg-transparent', STATUS_STYLE[t.status])}>{t.status.replace('_', ' ')}</span>
        {t.parentId && <span className="chip border-indigo-400/30 text-indigo-300">counteroffer</span>}
        <span className="text-white/40">
          {t.from} → {t.to} · by {proposer ?? 'unknown'} · {relTime(t.createdAt)} · {t.phaseAtProposal === 'live' ? 'during auction' : t.phaseAtProposal === 'completed' ? 'post-auction' : 'between seasons'}
        </span>
      </div>
      <div className="flex gap-3 items-start">
        <SideView team={t.from} side={t.give} />
        <div className="text-white/30 pt-5">⇄</div>
        <SideView team={t.to} side={t.receive} />
      </div>
      {t.message && !compact && <div className="text-sm text-white/65 italic border-l-2 border-white/10 pl-2">“{t.message}”</div>}
      {t.failureReason && <div className="text-xs text-red-300">{t.failureReason}</div>}
      {t.status === 'pending' && mineTo && (
        <div className="flex flex-wrap gap-2">
          <button className="btn-gold btn-sm" onClick={() => send('respondTrade', { tradeId: t.id, accept: true }, { success: state.config.tradeRequiresHostApproval ? 'Accepted. Waiting for host approval' : 'Trade completed' })}>
            Accept
          </button>
          <button className="btn-ghost btn-sm" onClick={onCounter}>
            Counteroffer
          </button>
          <button className="btn-danger btn-sm" onClick={() => send('respondTrade', { tradeId: t.id, accept: false })}>
            Reject
          </button>
        </div>
      )}
      {(t.status === 'pending' || t.status === 'awaiting_host') && (mineFrom || isHost) && (
        <div className="flex flex-wrap gap-2">
          {t.status === 'awaiting_host' && isHost && (
            <>
              <button className="btn-gold btn-sm" onClick={() => send('hostDecideTrade', { tradeId: t.id, approve: true }, { success: 'Trade approved' })}>
                Approve trade
              </button>
              <button className="btn-danger btn-sm" onClick={() => send('hostDecideTrade', { tradeId: t.id, approve: false })}>
                Veto
              </button>
            </>
          )}
          <button className="btn-ghost btn-sm" onClick={() => send('cancelTrade', { tradeId: t.id })}>
            {mineFrom ? 'Withdraw' : 'Cancel (host)'}
          </button>
        </div>
      )}
    </div>
  )
}

function Compose({ init, onClose }: { init: { from: TeamCode; to: TeamCode; give?: TradeSide; receive?: TradeSide; counterOf?: Trade }; onClose: () => void }) {
  const { state, library, myTeams, send } = useRoom()
  const [from, setFrom] = useState<TeamCode>(init.from)
  const [to, setTo] = useState<TeamCode>(init.to)
  const [give, setGive] = useState<string[]>(init.give?.players ?? [])
  const [receive, setReceive] = useState<string[]>(init.receive?.players ?? [])
  const [giveCash, setGiveCash] = useState<number | null>(init.give?.cash || null)
  const [recvCash, setRecvCash] = useState<number | null>(init.receive?.cash || null)
  const [msg, setMsg] = useState('')
  const locked = useMemo(() => {
    const s = new Set<string>()
    for (const t of Object.values(state?.trades ?? {}))
      if ((t.status === 'pending' || t.status === 'awaiting_host') && t.id !== init.counterOf?.id) [...t.give.players, ...t.receive.players].forEach((x) => s.add(x))
    return s
  }, [state?.trades, init.counterOf])
  if (!state) return null
  const cfg = state.config
  const A = state.teams[from]
  const B = state.teams[to]
  const gc = giveCash ?? 0
  const rc = recvCash ?? 0
  const osOf = (ids: string[]) => ids.filter((id) => library[id]?.overseas).length
  const sizeA = A.squad.length - give.length + receive.length
  const sizeB = B.squad.length - receive.length + give.length
  const osA = overseasCount(A, library) - osOf(give) + osOf(receive)
  const osB = overseasCount(B, library) - osOf(receive) + osOf(give)
  const purseA = A.purse - gc + rc
  const purseB = B.purse - rc + gc
  const problems: string[] = []
  if (give.length + receive.length === 0) problems.push('Include at least one player')
  if (sizeA > cfg.maxSquad) problems.push(`${from} would exceed the squad limit`)
  if (sizeB > cfg.maxSquad) problems.push(`${to} would exceed the squad limit`)
  if (osA > cfg.maxOverseas) problems.push(`${from} would exceed the overseas limit`)
  if (osB > cfg.maxOverseas) problems.push(`${to} would exceed the overseas limit`)
  const committedA = A.purse - availablePurse(state, from)
  const committedB = B.purse - availablePurse(state, to)
  if (purseA < Math.max(0, committedA)) problems.push(`${from} cannot afford this${committedA > 0 ? ' (purse committed to a live bid)' : ''}`)
  if (purseB < Math.max(0, committedB)) problems.push(`${to} cannot afford this${committedB > 0 ? ' (purse committed to a live bid)' : ''}`)
  const toggle = (arr: string[], set: (x: string[]) => void, id: string) => set(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id])

  async function submit() {
    const payload = { give: { players: give, cash: gc }, receive: { players: receive, cash: rc }, message: msg }
    const r = init.counterOf ? await send('counterTrade', { tradeId: init.counterOf.id, ...payload }, { success: 'Counteroffer sent' }) : await send('proposeTrade', { from, to, ...payload }, { success: `Offer sent to ${to}` })
    if (r.ok) onClose()
  }

  const SquadPick = ({ team, chosen, set }: { team: TeamCode; chosen: string[]; set: (x: string[]) => void }) => (
    <div className="max-h-64 overflow-y-auto scroll-thin rounded-lg border border-white/[0.07]">
      {state.teams[team].squad.length === 0 && <div className="text-xs text-white/40 p-3">No players</div>}
      {[...state.teams[team].squad]
        .sort((a, b) => b.price - a.price)
        .map((e) => {
          const p = library[e.playerId]
          const busy = locked.has(e.playerId)
          return (
            <label key={e.playerId} className={cls('flex items-center gap-2 px-3 py-1.5 text-sm border-b border-white/[0.04]', busy ? 'opacity-40' : 'cursor-pointer hover:bg-white/[0.03]')}>
              <input type="checkbox" disabled={busy} checked={chosen.includes(e.playerId)} onChange={() => toggle(chosen, set, e.playerId)} />
              <span className="flex-1 truncate">
                {p?.name}
                <span className="text-[11px] text-white/40"> {p ? ROLE_LABEL[p.role] : ''}{p?.overseas ? ' · OS' : ''}{busy ? ' · in another trade' : ''}</span>
              </span>
              <Money v={e.price} className="text-xs text-white/50" />
            </label>
          )
        })}
    </div>
  )

  return (
    <Modal open onClose={onClose} title={init.counterOf ? `Counteroffer to ${to}` : 'Propose a trade'} wide>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="label">You ({from}) send</span>
              {!init.counterOf && myTeams.length > 1 && (
                <select className="input w-auto py-1" value={from} onChange={(e) => (setFrom(e.target.value as TeamCode), setGive([]))}>
                  {myTeams.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              )}
            </div>
            <SquadPick team={from} chosen={give} set={setGive} />
            {cfg.tradeCashAllowed && <MoneyInput value={giveCash} onChange={setGiveCash} placeholder="Cash you add (lakh)" />}
            <div className="text-xs text-white/45">
              After: squad {sizeA}/{cfg.maxSquad} · OS {osA}/{cfg.maxOverseas} · purse {formatMoney(purseA)}
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="label">You receive from</span>
              {init.counterOf ? (
                <TeamBadge code={to} size="xs" />
              ) : (
                <select className="input w-auto py-1" value={to} onChange={(e) => (setTo(e.target.value as TeamCode), setReceive([]))}>
                  {TEAM_CODES.filter((t) => t !== from).map((t) => (
                    <option key={t} value={t}>
                      {t} · {TEAM_META[t].name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <SquadPick team={to} chosen={receive} set={setReceive} />
            {cfg.tradeCashAllowed && <MoneyInput value={recvCash} onChange={setRecvCash} placeholder="Cash they add (lakh)" />}
            <div className="text-xs text-white/45">
              After: squad {sizeB}/{cfg.maxSquad} · OS {osB}/{cfg.maxOverseas} · purse {formatMoney(purseB)}
            </div>
          </div>
        </div>
        <textarea className="input min-h-[60px]" placeholder="Message (optional)" value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={500} />
        {problems.length > 0 && <div className="text-xs text-amber-200/80">{problems.join(' · ')}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-gold" disabled={problems.length > 0} onClick={submit}>
            {init.counterOf ? 'Send counteroffer' : 'Send offer'}
          </button>
        </div>
        <p className="text-[11px] text-white/35">The server re-checks ownership, squad and overseas limits and purse (including money committed to a live bid) at the moment of acceptance.</p>
      </div>
    </Modal>
  )
}
