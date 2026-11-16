import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Player, PublicState, RoomEvent, TeamCode } from '@shared/types'
import { TEAM_CODES } from '@shared/types'
import { TEAM_META, formatMoney } from '@shared/rules'
import { useRoom } from '../lib/room'
import { clock, cls } from '../lib/helpers'
import { Avatar, Empty, Money, Stat, TeamBadge } from '../components/ui'

const GROUPS: Record<string, string[]> = {
  All: [],
  Bids: ['bid'],
  Results: ['sold', 'unsold', 'skipped', 'queue_skipped', 'manual_assign', 'sale_corrected', 'sale_reverted', 'undo', 'rtm_offered', 'rtm_used', 'rtm_declined', 'rtm_raised'],
  Trades: ['trade_proposed', 'trade_countered', 'trade_accepted', 'trade_rejected', 'trade_completed', 'trade_cancelled', 'trade_vetoed', 'trade_reversed'],
  Host: ['host_changed', 'host_transfer_requested', 'host_transfer_declined', 'host_transfer_cancelled', 'paused', 'resumed', 'auction_started', 'auction_completed', 'auction_reopened', 'unsold_round_started', 'session_started', 'config_updated', 'purse_adjusted', 'timer_reset', 'base_price_changed', 'host_hammer'],
  Members: ['join_requested', 'member_approved', 'member_rejected', 'member_removed', 'member_banned', 'member_unbanned', 'team_claimed', 'team_assigned', 'team_released'],
}

function describe(e: RoomEvent, s: PublicState, lib: Record<string, Player>): React.ReactNode {
  const d = e.data as Record<string, any>
  const pn = (id: unknown) => <b>{lib[String(id)]?.name ?? String(id)}</b>
  const mn = (id: unknown) => <b>{s.members[String(id)]?.name ?? 'someone'}</b>
  const side = (x: { players: string[]; cash: number }) => [...x.players.map((id) => lib[id]?.name ?? id), ...(x.cash ? [formatMoney(x.cash)] : [])].join(' + ') || 'nothing'
  switch (e.type) {
    case 'bid': return <>{d.team} bid <Money v={d.amount} /> for {pn(d.playerId)}</>
    case 'nominated': return <>{pn(d.playerId)} under the hammer (round {d.round}, base {formatMoney(d.basePrice)})</>
    case 'sold': return <>{pn(d.playerId)} <span className="text-emerald-300">SOLD</span> to {d.team} for <Money v={d.amount} />{d.via === 'rtm' ? ' via RTM' : ''}</>
    case 'unsold': return <>{pn(d.playerId)} unsold{d.reason && d.reason !== 'no bids' ? ` (${d.reason})` : ''}</>
    case 'skipped': return <>{pn(d.playerId)} skipped</>
    case 'queue_skipped': return <>{(d.players as string[]).length} queued players set aside</>
    case 'host_hammer': return <>Host brought the hammer down on {pn(d.playerId)}</>
    case 'timer_expired': return <>Timer expired for {pn(d.playerId)}</>
    case 'timer_reset': return <>Host set the timer to {d.seconds}s</>
    case 'base_price_changed': return <>Base price of {pn(d.playerId)} set to {formatMoney(d.amount)}</>
    case 'pool_added': return <>{(d.players as string[]).length} players added to the auction</>
    case 'lineup_set': return <>{d.team} updated its playing XI</>
    case 'recalled': return <>{pn(d.playerId)} recalled to the queue</>
    case 'manual_assign': return <>{pn(d.playerId)} assigned to {d.team} for <Money v={d.amount} /></>
    case 'sale_corrected': return <>Sale corrected: {pn(d.playerId)} {d.fromTeam} {formatMoney(d.fromAmount)} → {d.team} {formatMoney(d.amount)}</>
    case 'sale_reverted': return <>Sale reverted: {pn(d.playerId)} returned from {d.team} (refund {formatMoney(d.amount)})</>
    case 'undo': return <>Host undid last {String(d.txType).replace('_', ' ')}</>
    case 'rtm_offered': return <>{d.team} offered RTM on {pn(d.playerId)} at {formatMoney(d.price)}</>
    case 'rtm_used': return <>{d.team} used RTM on {pn(d.playerId)}</>
    case 'rtm_raised': return <>{d.team} made a final raise to {formatMoney(d.amount)}</>
    case 'rtm_declined': return <>{d.team} declined RTM</>
    case 'trade_proposed': return <>{d.from} proposed: {side(d.give)} for {side(d.receive)} ({d.to})</>
    case 'trade_countered': return <>{d.from} countered: {side(d.give)} for {side(d.receive)} ({d.to})</>
    case 'trade_completed': return <><span className="text-emerald-300">Trade completed</span>: {d.from} sent {side(d.give)} to {d.to} for {side(d.receive)}</>
    case 'trade_rejected': return <>Trade rejected</>
    case 'trade_accepted': return <>Trade accepted{d.awaitingHost ? ', awaiting host approval' : ''}</>
    case 'trade_cancelled': return <>Trade withdrawn</>
    case 'trade_vetoed': return <>Trade vetoed by host</>
    case 'trade_reversed': return <>Trade reversed by host</>
    case 'host_changed': return <>Host changed: {mn(d.from)} → {mn(d.to)}{d.reason === 'claimed_while_host_offline' ? ' (claimed while host offline)' : ''}</>
    case 'host_transfer_requested': return <>{mn(d.from)} offered host controls to {mn(d.to)}</>
    case 'paused': return <>Auction paused</>
    case 'resumed': return <>Auction resumed</>
    case 'auction_started': return <>{String(d.type).toUpperCase()} auction started (season {d.season}, {d.pool} players)</>
    case 'auction_completed': return <>Auction marked complete</>
    case 'auction_reopened': return <>Auction reopened</>
    case 'unsold_round_started': return <>Unsold round started ({(d.players as string[]).length} players, round {d.round})</>
    case 'session_started': return <>New season {d.season} set up ({d.auctionType})</>
    case 'purse_adjusted': return <>{d.team} purse adjusted by {formatMoney(d.delta)}{d.reason ? `: ${d.reason}` : ''}</>
    case 'join_requested': return <>{d.name} requested to join as {d.role}</>
    case 'member_approved': return <>{d.name} approved as {d.role}{d.team ? ` (${d.team})` : ''}</>
    case 'team_claimed': return <>{mn(d.memberId)} took {d.team}</>
    case 'config_updated': return <>Settings changed: {(d.keys as string[]).join(', ')}</>
    default: return <span className="text-white/60">{e.type.replace(/_/g, ' ')}</span>
  }
}

export default function History() {
  const { state, library, history, isHost, token, code } = useRoom()
  const [events, setEvents] = useState<RoomEvent[]>([])
  const [group, setGroup] = useState('All')
  const [loading, setLoading] = useState(false)
  const [more, setMore] = useState(true)
  const [lotQuery, setLotQuery] = useState<string | null>(null)
  const [lotBids, setLotBids] = useState<RoomEvent[]>([])
  const version = state?.version

  const load = useCallback(
    async (reset: boolean) => {
      setLoading(true)
      try {
        const before = reset ? undefined : events[events.length - 1]?.seq
        const types = GROUPS[group]
        const ev = await history({ before, limit: 200, types: types.length ? types : undefined })
        setEvents(reset ? ev : [...events, ...ev])
        setMore(ev.length === 200)
      } finally {
        setLoading(false)
      }
    },
    [events, group, history],
  )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void load(true), [group, version])
  useEffect(() => {
    if (!lotQuery) return
    history({ types: ['bid'], limit: 5000 }).then((ev) => setLotBids(ev.filter((e) => e.data.playerId === lotQuery)))
  }, [lotQuery, history, version])

  const [counts, setCounts] = useState({ hostChanges: 0, pauses: 0, bids: 0 })
  useEffect(() => {
    history({ types: ['host_changed', 'paused', 'bid'], limit: 5000 })
      .then((ev) => setCounts({ hostChanges: ev.filter((e) => e.type === 'host_changed').length, pauses: ev.filter((e) => e.type === 'paused').length, bids: ev.filter((e) => e.type === 'bid').length }))
      .catch(() => {})
  }, [history, version])
  const stats = useMemo(() => (state ? computeStats(state, library) : null), [state, library])
  if (!state || !stats) return null
  const maxSpent = Math.max(1, ...TEAM_CODES.map((t) => state.teams[t].spent))
  const exp = (f: string) => `/api/rooms/${code}/export/${f}?token=${encodeURIComponent(token)}`

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">Auction history &amp; statistics</h1>
          <p className="text-sm text-white/50">Every nomination, bid, sale, trade, host change and pause is recorded permanently.</p>
        </div>
        {isHost && (
          <div className="flex flex-wrap gap-2">
            {[
              ['results.csv', 'Results CSV'],
              ['squads.csv', 'Squads CSV'],
              ['teams.csv', 'Teams CSV'],
              ['history.csv', 'Full log CSV'],
              ['full.json', 'Complete JSON'],
            ].map(([f, l]) => (
              <a key={f} className="btn-ghost btn-sm" href={exp(f)}>
                ⤓ {l}
              </a>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
        <Stat label="Total expenditure" value={<Money v={stats.total} className="text-gold-300" />} sub="auction + RTM + manual" />
        <Stat label="Players sold" value={stats.sold} />
        <Stat label="Unsold / skipped" value={stats.unsold} />
        <Stat label="Unsold rounds" value={Math.max(0, state.round - 1)} />
        <Stat label="Trades completed" value={stats.trades} />
        <Stat label="Host changes" value={counts.hostChanges} sub={`${counts.pauses} pauses · ${counts.bids} bids`} />
        <Stat label="Most expensive" value={stats.top ? <Money v={stats.top.price} /> : '—'} sub={stats.top ? `${library[stats.top.id]?.name} · ${stats.top.team}` : ''} />
        <Stat label="Lowest purchase" value={stats.low ? <Money v={stats.low.price} /> : '—'} sub={stats.low ? `${library[stats.low.id]?.name} · ${stats.low.team}` : ''} />
      </div>

      <div className="grid xl:grid-cols-[1fr_1fr] gap-5">
        <div className="card">
          <div className="card-hd">
            <div className="font-semibold">Team-wise expenditure</div>
            <span className="text-xs text-white/45">
              Biggest spender: <b className="text-white">{stats.bigSpender ?? '—'}</b> · Highest purse: <b className="text-white">{stats.richest}</b>
            </span>
          </div>
          <div className="p-4 space-y-2">
            {[...TEAM_CODES]
              .sort((a, b) => state.teams[b].spent - state.teams[a].spent)
              .map((t) => (
                <div key={t} className="flex items-center gap-3">
                  <TeamBadge code={t} size="sm" />
                  <div className="flex-1 h-6 rounded bg-white/[0.04] overflow-hidden relative">
                    <div className="h-full" style={{ width: `${(state.teams[t].spent / maxSpent) * 100}%`, background: `linear-gradient(90deg, ${TEAM_META[t].primary}, ${TEAM_META[t].primary}aa)` }} />
                    <span className="absolute inset-0 flex items-center px-2 text-xs num">
                      {formatMoney(state.teams[t].spent)} spent · {formatMoney(state.teams[t].purse)} left
                    </span>
                  </div>
                  <span className="text-xs text-white/50 w-14 text-right num">{state.teams[t].squad.length} pl.</span>
                </div>
              ))}
          </div>
        </div>
        <div className="card">
          <div className="card-hd">
            <div className="font-semibold">Top buys</div>
          </div>
          <div className="p-2 grid sm:grid-cols-2 gap-1 max-h-[22rem] overflow-y-auto scroll-thin">
            {stats.buys.slice(0, 30).map((b) => (
              <button key={b.id} onClick={() => setLotQuery(b.id)} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/[0.04] text-left">
                <Avatar player={library[b.id]} size={30} />
                <span className="flex-1 min-w-0 text-sm truncate">{library[b.id]?.name}</span>
                <TeamBadge code={b.team} size="xs" />
                <Money v={b.price} className="text-sm text-gold-300" />
              </button>
            ))}
            {stats.buys.length === 0 && <Empty>No purchases yet</Empty>}
          </div>
        </div>
      </div>

      {lotQuery && (
        <div className="card">
          <div className="card-hd">
            <div className="font-semibold">Bid trail: {library[lotQuery]?.name}</div>
            <button className="btn-ghost btn-sm" onClick={() => setLotQuery(null)}>
              Close
            </button>
          </div>
          <div className="p-3 text-sm space-y-1">
            {state.lots[lotQuery]?.attempts.map((a, i) => (
              <div key={i} className="text-white/60 text-xs">
                Round {a.round}: {a.result}
                {a.team ? ` · ${a.team}` : ''}
                {a.amount !== null ? ` · ${formatMoney(a.amount)}` : ''} · {a.bidCount} bids
              </div>
            ))}
            <div className="flex flex-wrap gap-1.5 pt-2">
              {[...lotBids].reverse().map((b) => (
                <span key={b.seq} className="chip border-white/10 text-white/80">
                  {String(b.data.team)} <Money v={b.data.amount as number} />
                </span>
              ))}
              {lotBids.length === 0 && <span className="text-white/40 text-xs">No bids recorded</span>}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-hd flex-wrap">
          <div className="font-semibold">Timeline</div>
          <div className="flex gap-1 flex-wrap">
            {Object.keys(GROUPS).map((g) => (
              <button key={g} className={group === g ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'} onClick={() => setGroup(g)}>
                {g}
              </button>
            ))}
          </div>
        </div>
        <div className="divide-y divide-white/[0.04]">
          {events.map((e) => (
            <div key={e.seq} className={cls('px-4 py-2 flex gap-3 text-sm', e.type === 'sold' && 'bg-emerald-400/[0.03]', e.type.startsWith('trade_completed') && 'bg-indigo-400/[0.04]', e.type === 'host_changed' && 'bg-gold-400/[0.05]')}>
              <span className="text-[11px] text-white/35 w-20 shrink-0 num pt-0.5">{clock(e.ts)}</span>
              {typeof e.data.team === 'string' && TEAM_CODES.includes(e.data.team as TeamCode) ? <TeamBadge code={e.data.team as TeamCode} size="xs" /> : <span className="w-5" />}
              <span className="flex-1 min-w-0">{describe(e, state, library)}</span>
              {e.actor && state.members[e.actor] && <span className="text-[11px] text-white/35 hidden sm:inline">{state.members[e.actor].name}</span>}
            </div>
          ))}
          {events.length === 0 && !loading && <Empty>No events yet</Empty>}
        </div>
        {more && events.length > 0 && (
          <div className="p-3 text-center">
            <button className="btn-ghost btn-sm" disabled={loading} onClick={() => load(false)}>
              {loading ? 'Loading…' : 'Load older'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function computeStats(s: PublicState, lib: Record<string, Player>) {
  void lib
  const buys: { id: string; price: number; team: TeamCode }[] = []
  for (const l of Object.values(s.lots)) if (l.status === 'sold' && l.soldTo && l.soldPrice !== null) buys.push({ id: l.playerId, price: l.soldPrice, team: l.soldTo })
  buys.sort((a, b) => b.price - a.price)
  const total = buys.reduce((n, b) => n + b.price, 0)
  const sorted = [...TEAM_CODES].sort((a, b) => s.teams[b].spent - s.teams[a].spent)
  const richest = [...TEAM_CODES].sort((a, b) => s.teams[b].purse - s.teams[a].purse)[0]
  return {
    buys,
    total,
    sold: buys.length,
    unsold: Object.values(s.lots).filter((l) => l.status === 'unsold' || l.status === 'skipped').length,
    top: buys[0] ?? null,
    low: buys.length ? buys[buys.length - 1] : null,
    bigSpender: s.teams[sorted[0]].spent > 0 ? sorted[0] : null,
    richest: `${richest} (${formatMoney(s.teams[richest].purse)})`,
    trades: Object.values(s.trades).filter((t) => t.status === 'completed').length,
  }
}
