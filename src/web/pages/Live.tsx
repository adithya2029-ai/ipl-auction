import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Player, PublicState, TeamCode } from '@shared/types'
import { TEAM_CODES } from '@shared/types'
import { ROLE_LABEL, TEAM_META, formatMoney, overseasCount, reserveFor, stepFor } from '@shared/rules'
import { useRoom, useServerNow } from '../lib/room'
import { bidBlocker, clock, cls, nextBid, ownerName } from '../lib/helpers'
import { Avatar, Countdown, Empty, KeyStats, Money, MoneyInput, PlayerProfile, PlayerTags, RoleChip, TeamBadge, statusLine } from '../components/ui'

export default function Live() {
  const { state, library, isHost } = useRoom()
  const [profile, setProfile] = useState<Player | null>(null)
  if (!state) return null
  if (state.phase === 'lobby')
    return (
      <div className="card p-8 text-center space-y-3 max-w-xl mx-auto mt-6">
        <div className="font-display text-3xl font-bold">The auction hasn’t started</div>
        <p className="text-white/55 text-sm">{isHost ? 'Finish the configuration and start the auction when everyone is ready.' : 'The host is setting up the auction. Claim your franchise in the lobby.'}</p>
        <Link className="btn-gold" to={isHost ? '../config' : '../lobby'}>
          {isHost ? 'Open configuration' : 'Back to lobby'}
        </Link>
      </div>
    )
  return (
    <div className="space-y-4">
      {isHost && <HostStrip />}
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)_340px] md:grid-cols-[minmax(0,1fr)_320px]">
        <div className="order-3 md:col-span-2 lg:col-span-1 lg:order-1">
          <TeamsRail />
        </div>
        <div className="order-1 lg:order-2 min-w-0">
          <Stage onProfile={setProfile} />
        </div>
        <div className="order-2 lg:order-3">
          <BidPanel />
        </div>
      </div>
      <BottomTabs onProfile={setProfile} />
      <PlayerProfile p={profile} onClose={() => setProfile(null)} extra={profile ? <LotHistory s={state} id={profile.id} lib={library} /> : null} />
    </div>
  )
}

function LotHistory({ s, id, lib }: { s: PublicState; id: string; lib: Record<string, Player> }) {
  const lot = s.lots[id]
  if (!lot) return null
  void lib
  return (
    <div className="rounded-lg border border-white/[0.07] p-3 text-sm space-y-1">
      <div className="label">This auction</div>
      <div>
        Status: <b className="capitalize">{lot.status}</b>
        {lot.soldTo && (
          <>
            {' '}
            · {lot.soldTo} for <Money v={lot.soldPrice} />
          </>
        )}{' '}
        · Base <Money v={lot.basePrice} />
        {lot.basePrice !== lot.originalBasePrice && <span className="text-white/40"> (originally {formatMoney(lot.originalBasePrice)})</span>}
      </div>
      {lot.attempts.map((a, i) => (
        <div key={i} className="text-white/60 text-xs">
          Round {a.round}: {a.result}
          {a.team && ` · ${a.team}`}
          {a.amount !== null && ` · ${formatMoney(a.amount)}`} · {a.bidCount} bids{a.via && a.via !== 'auction' ? ` · ${a.via}` : ''}
        </div>
      ))}
    </div>
  )
}

function HostStrip() {
  const { state, send } = useRoom()
  if (!state) return null
  const c = state.current
  const live = state.phase === 'live'
  return (
    <div className="card px-3 py-2 flex flex-wrap items-center gap-2 border-gold-400/25">
      <span className="label text-gold-400 mr-1">Host</span>
      {live && !c && (
        <button className="btn-gold btn-sm" disabled={!state.queue.length || state.archived} onClick={() => send('nominate')}>
          Next player ▶
        </button>
      )}
      {live && c && (
        <>
          <button className="btn-gold btn-sm" onClick={() => send('hammer')}>
            {c.phase === 'bidding' ? (c.high ? 'Hammer: SOLD' : 'Hammer: no bids') : 'Close RTM step'}
          </button>
          <button className="btn-ghost btn-sm" onClick={() => send('markUnsold')}>
            Mark unsold
          </button>
          <button className="btn-ghost btn-sm" onClick={() => send('skip')}>
            Skip
          </button>
          <button className="btn-ghost btn-sm" onClick={() => send('resetTimer', { seconds: state.config.bidTimerSeconds })}>
            Reset timer
          </button>
        </>
      )}
      {live && (state.paused ? (
        <button className="btn-gold btn-sm" onClick={() => send('resume')}>
          Resume
        </button>
      ) : (
        <button className="btn-ghost btn-sm" onClick={() => send('pause')}>
          Pause
        </button>
      ))}
      {state.phase === 'completed' && <span className="text-sm text-white/60">Auction complete. Reopen from Host Control to continue.</span>}
      <span className="text-xs text-white/40 ml-auto">
        {state.queue.length} in queue · {Object.values(state.lots).filter((l) => l.status === 'unsold' || l.status === 'skipped').length} unsold/skipped
      </span>
      <Link to="../host" className="btn-ghost btn-sm">
        Full controls
      </Link>
    </div>
  )
}

function TeamsRail() {
  const { state, library } = useRoom()
  if (!state) return null
  const high = state.current?.high?.team
  return (
    <div className="card">
      <div className="card-hd py-2.5">
        <div className="font-semibold text-sm">Franchises</div>
        <div className="label">purse · squad</div>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-1">
        {TEAM_CODES.map((t) => {
          const team = state.teams[t]
          const owner = ownerName(state, t)
          const online = Object.values(state.members).some((m) => m.teamIds.includes(t) && state.online.includes(m.id))
          return (
            <Link
              to={`../teams/${t}`}
              key={t}
              className={cls('flex items-center gap-2.5 px-3 py-2 border-b border-white/[0.05] transition', high === t ? 'bg-gold-400/10 shadow-[inset_3px_0_0_#dcbc63]' : 'hover:bg-white/[0.03]')}
            >
              <TeamBadge code={t} size="sm" dim={!owner} />
              <div className="min-w-0 flex-1">
                <div className="text-xs text-white/60 truncate flex items-center gap-1">
                  <span className={cls('h-1.5 w-1.5 rounded-full shrink-0', online ? 'bg-emerald-400' : 'bg-white/20')} />
                  {owner ?? 'No owner'}
                </div>
                <div className="text-[11px] text-white/40 num">
                  {team.squad.length}/{state.config.maxSquad} · OS {overseasCount(team, library)}/{state.config.maxOverseas}
                  {team.rtmCards > 0 && ` · RTM ${team.rtmCards}`}
                </div>
              </div>
              <Money v={team.purse} className={cls('text-base font-semibold', high === t ? 'text-gold-300' : '')} />
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function Stage({ onProfile }: { onProfile: (p: Player) => void }) {
  const { state, library } = useRoom()
  if (!state) return null
  const c = state.current
  const p = c ? library[c.playerId] : undefined
  if (!c || !p) return <IdleStage onProfile={onProfile} />
  const lot = state.lots[c.playerId]
  const high = c.high
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-2 border-b border-white/[0.06] flex items-center gap-2 text-xs">
        <span className="chip border-red-400/30 text-red-300 bg-red-500/10">
          <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" /> UNDER THE HAMMER
        </span>
        <span className="text-white/50">{lot.set}</span>
        {lot.attempts.length > 0 && <span className="text-amber-300/80">Returning · {lot.attempts.length} earlier attempt{lot.attempts.length > 1 ? 's' : ''}</span>}
        <span className="ml-auto text-white/40">Round {state.round}</span>
      </div>
      <div className="p-4 sm:p-6 grid sm:grid-cols-[auto_1fr] gap-5">
        <button onClick={() => onProfile(p)} className="mx-auto sm:mx-0">
          <Avatar player={p} size={150} />
        </button>
        <div className="min-w-0 space-y-2 text-center sm:text-left">
          <button onClick={() => onProfile(p)} className="font-display text-4xl sm:text-5xl font-bold leading-none hover:text-gold-300 transition">
            {p.name}
          </button>
          <div className="flex flex-wrap gap-1.5 justify-center sm:justify-start items-center">
            <RoleChip p={p} />
            {p.secondaryRole && <span className="chip text-white/60 border-white/15">{ROLE_LABEL[p.secondaryRole]}</span>}
            <PlayerTags p={p} />
          </div>
          <div className="text-sm text-white/65">
            {p.nationality}
            {p.battingStyle && ` · ${p.battingStyle}`}
            {p.bowlingStyle && ` · ${p.bowlingStyle}`}
          </div>
          <div className="text-xs text-white/45">
            {statusLine(p)}
            {p.iplTeams.length > 0 && ` · ${p.iplTeams.length} IPL team${p.iplTeams.length > 1 ? 's' : ''}`}
            {lot.rtmTeam && state.config.rtmEnabled && ` · RTM eligible: ${lot.rtmTeam}`}
          </div>
        </div>
      </div>
      <div className="px-4 sm:px-6 pb-4">
        <KeyStats s={p.stats} />
        <div className="text-[10px] text-white/30 mt-1.5">IPL career · computed from ball-by-ball data</div>
      </div>
      <div className="grid grid-cols-2 border-t border-white/[0.06]">
        <div className="p-4 sm:p-5 border-r border-white/[0.06]">
          <div className="label">Base price</div>
          <Money v={lot.basePrice} className="text-2xl sm:text-3xl font-semibold text-white/80" />
        </div>
        <div key={c.bids.length} className="p-4 sm:p-5 animate-flash">
          <div className="label">{high ? 'Current highest bid' : 'Awaiting opening bid'}</div>
          <div className="flex items-center gap-3">
            <Money v={high?.amount ?? null} className="text-4xl sm:text-5xl font-bold text-gold-300" />
            {high && <TeamBadge code={high.team} size="lg" />}
          </div>
          {high && <div className="text-xs text-white/50 mt-1">{TEAM_META[high.team].name}</div>}
        </div>
      </div>
      {c.rtm && <RtmBanner />}
    </div>
  )
}

function IdleStage({ onProfile }: { onProfile: (p: Player) => void }) {
  const { state, library, isHost } = useRoom()
  const now = useServerNow(500)
  const lots = state?.lots
  const last = useMemo(() => {
    let best: { id: string; at: number; result: string; team: TeamCode | null; amount: number | null } | null = null
    for (const l of Object.values(lots ?? {})) {
      const a = l.attempts[l.attempts.length - 1]
      if (a && (!best || a.endedAt > best.at)) best = { id: l.playerId, at: a.endedAt, result: a.result, team: a.team, amount: a.amount }
    }
    return best
  }, [lots])
  if (!state) return null
  const nextUp = state.queue[0] ? library[state.queue[0]] : undefined
  const autoIn = state.autoNextAt ? Math.max(0, Math.ceil((state.autoNextAt - now) / 1000)) : null
  return (
    <div className="card p-6 min-h-[22rem] flex flex-col items-center justify-center text-center gap-5">
      {last && library[last.id] && now - last.at < 60_000 && (
        <div className="space-y-2">
          <div className="label">Last lot</div>
          <div className="flex items-center gap-3 justify-center">
            <Avatar player={library[last.id]} size={64} />
            <div className="text-left">
              <div className="font-display text-2xl font-bold">{library[last.id].name}</div>
              {last.result === 'sold' ? (
                <div className="flex items-center gap-2">
                  <span className="font-display text-xl text-emerald-300 tracking-wider">SOLD</span>
                  <TeamBadge code={last.team} size="sm" />
                  <Money v={last.amount} className="text-xl text-gold-300" />
                </div>
              ) : (
                <div className="font-display text-xl text-white/60 tracking-wider uppercase">{last.result}</div>
              )}
            </div>
          </div>
        </div>
      )}
      {state.phase === 'completed' ? (
        <div>
          <div className="font-display text-3xl font-bold">Auction complete</div>
          <p className="text-white/50 text-sm mt-1">Squads are final. The transfer market is {state.config.tradesEnabled ? 'open' : 'closed'}.</p>
          <div className="flex gap-2 justify-center mt-3">
            <Link to="../teams" className="btn-gold">
              View squads
            </Link>
            <Link to="../trades" className="btn-ghost">
              Trade centre
            </Link>
          </div>
        </div>
      ) : nextUp ? (
        <div className="space-y-2">
          <div className="label">{autoIn !== null ? `Next player in ${autoIn}s` : state.paused ? 'Paused' : isHost ? 'Ready when you are' : 'Waiting for the host'}</div>
          <button onClick={() => onProfile(nextUp)} className="text-white/70 text-sm hover:text-white">
            Up next: <b>{nextUp.name}</b> · {state.lots[nextUp.id]?.set}
          </button>
        </div>
      ) : (
        <div className="space-y-1">
          <div className="font-display text-2xl font-bold">Round complete</div>
          <p className="text-white/50 text-sm">{isHost ? 'Start an unsold round from Host Control or end the auction.' : 'Waiting for the host to start an unsold round or end the auction.'}</p>
        </div>
      )}
    </div>
  )
}

function RtmBanner() {
  const { state, myTeams, send } = useRoom()
  const [raise, setRaise] = useState<number | null>(null)
  if (!state?.current?.rtm || !state.current.high) return null
  const c = state.current
  const rtm = c.rtm!
  const winner = c.high!.team
  const mineRtm = myTeams.includes(rtm.team)
  const mineWinner = myTeams.includes(winner)
  const lotKey = c.lotKey
  return (
    <div className="border-t border-gold-400/30 bg-gold-400/[0.07] p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="chip border-gold-400/40 text-gold-300">RIGHT TO MATCH</span>
        <TeamBadge code={rtm.team} size="sm" />
        <span className="text-sm">
          {c.phase === 'rtm_decision' && <>may match {winner}’s bid of <Money v={rtm.price} className="text-gold-300" /></>}
          {c.phase === 'rtm_raise' && <>used RTM. {winner} may make one final raise above <Money v={rtm.price} /></>}
          {c.phase === 'rtm_match' && <>{winner} raised to <Money v={rtm.raisedTo} className="text-gold-300" />. {rtm.team} must match or decline.</>}
        </span>
      </div>
      {c.phase === 'rtm_decision' && mineRtm && (
        <div className="flex gap-2">
          <button className="btn-gold" onClick={() => send('rtm', { action: 'use', lotKey })}>
            Use RTM at {formatMoney(rtm.price)}
          </button>
          <button className="btn-ghost" onClick={() => send('rtm', { action: 'decline', lotKey })}>
            Decline
          </button>
        </div>
      )}
      {c.phase === 'rtm_raise' && mineWinner && (
        <div className="flex gap-2 flex-wrap">
          <MoneyInput className="w-44" value={raise} onChange={setRaise} placeholder={`More than ${rtm.price}`} />
          <button className="btn-gold" disabled={!raise || raise <= rtm.price} onClick={() => send('rtm', { action: 'raise', amount: raise, lotKey })}>
            Final raise
          </button>
          <button className="btn-ghost" onClick={() => send('rtm', { action: 'no_raise', lotKey })}>
            No raise. Let {rtm.team} have him
          </button>
        </div>
      )}
      {c.phase === 'rtm_match' && mineRtm && (
        <div className="flex gap-2">
          <button className="btn-gold" onClick={() => send('rtm', { action: 'match', lotKey })}>
            Match {formatMoney(rtm.raisedTo)}
          </button>
          <button className="btn-ghost" onClick={() => send('rtm', { action: 'decline', lotKey })}>
            Decline
          </button>
        </div>
      )}
    </div>
  )
}

function BidPanel() {
  const { state, myTeams, me, members } = useRoomWithMembers()
  const now = useServerNow(100)
  if (!state) return null
  const c = state.current
  const total = c ? (c.phase !== 'bidding' ? state.config.rtmDecisionSeconds : c.bids.length ? state.config.bidTimerSeconds : state.config.timerSeconds) : state.config.timerSeconds
  return (
    <div className="space-y-4">
      <div className="card p-4 flex items-center gap-4">
        <Countdown deadline={c?.deadline ?? null} paused={state.paused || !c} remaining={c?.pausedRemaining ?? (c ? null : 0)} total={total} now={now} />
        <div className="min-w-0">
          <div className="label">{!c ? 'No live lot' : c.phase === 'bidding' ? 'Bidding open' : 'RTM in progress'}</div>
          <div className="text-sm text-white/60 mt-1">
            {c ? (
              <>
                {c.bids.length} bid{c.bids.length === 1 ? '' : 's'}
                {c.high && (
                  <>
                    {' '}
                    · leader <b className="text-white">{c.high.team}</b>
                  </>
                )}
              </>
            ) : state.paused ? (
              'Auction paused'
            ) : (
              'Waiting for the next nomination'
            )}
          </div>
          {c && <div className="text-[11px] text-white/35 mt-1">Timer resets to {state.config.bidTimerSeconds}s after every bid</div>}
        </div>
      </div>

      {me?.role === 'spectator' && <div className="card p-4 text-sm text-white/55">You are spectating. Bidding is limited to franchise owners.</div>}
      {me?.role === 'owner' && myTeams.length === 0 && (
        <div className="card p-4 text-sm text-white/55">
          You don’t own a franchise yet.{' '}
          <Link to="../lobby" className="text-gold-400">
            Claim one in the lobby
          </Link>
        </div>
      )}
      {myTeams.map((t) => (
        <TeamBidBox key={t} team={t} soloKeyboard={myTeams.length === 1} />
      ))}

      <div className="card">
        <div className="card-hd py-2.5">
          <div className="font-semibold text-sm">Bid history</div>
          <span className="label">this lot</span>
        </div>
        <div className="max-h-72 overflow-y-auto scroll-thin">
          {!c || c.bids.length === 0 ? (
            <Empty>No bids yet</Empty>
          ) : (
            [...c.bids].reverse().map((b, i) => (
              <div key={c.bids.length - i} className={cls('flex items-center gap-2.5 px-4 py-2 border-b border-white/[0.04]', i === 0 && 'bg-gold-400/[0.06]')}>
                <TeamBadge code={b.team} size="xs" />
                <span className="text-xs text-white/50 flex-1 truncate">{members[b.memberId]?.name ?? ''}</span>
                <span className="text-[10px] text-white/30">{clock(b.at)}</span>
                <Money v={b.amount} className={cls('text-base font-semibold', i === 0 && 'text-gold-300')} />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function useRoomWithMembers() {
  const r = useRoom()
  return { ...r, members: r.state?.members ?? {} }
}

function TeamBidBox({ team, soloKeyboard }: { team: TeamCode; soloKeyboard: boolean }) {
  const { state, library, send } = useRoom()
  const [custom, setCustom] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const s = state!
  const c = s.current
  const t = s.teams[team]
  const next = nextBid(s)
  const maxBid = Math.max(0, t.purse - reserveFor(t, s.config))
  const isHigh = c?.high?.team === team
  const open = !!c && c.phase === 'bidding' && !s.paused && s.phase === 'live'
  const blocker = c && next !== null ? bidBlocker(s, library, t, c.playerId, next) : null
  const can = open && !isHigh && !blocker && !busy
  const step = c ? stepFor(c.high?.amount ?? 0, s.config.increments) : 0

  const bid = async (amount: number | null) => {
    if (!c || amount === null) return
    setBusy(true)
    await send('bid', { team, amount, lotKey: c.lotKey })
    setBusy(false)
    setCustom(null)
  }

  useEffect(() => {
    if (!soloKeyboard) return
    const k = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      if ((e.key === 'b' || e.key === 'B') && can) bid(next)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })

  return (
    <div className={cls('card p-4 space-y-3', isHigh && 'border-gold-400/50 animate-pulseGold')}>
      <div className="flex items-center gap-3">
        <TeamBadge code={team} size="md" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">{TEAM_META[team].name}</div>
          <div className="text-xs text-white/50">
            Purse <Money v={t.purse} className="text-white" /> · max bid <Money v={maxBid} className="text-white" />
          </div>
        </div>
      </div>
      <button
        className={cls('w-full rounded-xl py-4 font-display text-2xl font-bold tracking-wide transition select-none', can ? 'bg-gold-400 text-ink-950 hover:bg-gold-300 active:scale-[0.99]' : 'bg-white/[0.06] text-white/35 cursor-not-allowed')}
        disabled={!can}
        onClick={() => bid(next)}
      >
        {isHigh ? 'YOU LEAD' : next !== null && c ? `BID ${formatMoney(next)}` : 'BID'}
      </button>
      {open && !isHigh && blocker && <div className="text-xs text-red-300">{blocker}</div>}
      {open && isHigh && <div className="text-xs text-gold-300 text-center">You hold the highest bid. Wait to be outbid.</div>}
      {s.config.allowJumpBids && open && !isHigh && next !== null && (
        <div className="grid grid-cols-3 gap-1.5">
          {[2, 4, 10].map((m) => {
            const amt = next + step * (m - 1)
            return (
              <button key={m} className="btn-ghost btn-sm" disabled={!!bidBlocker(s, library, t, c!.playerId, amt) || busy} onClick={() => bid(amt)}>
                {formatMoney(amt)}
              </button>
            )
          })}
        </div>
      )}
      {s.config.allowJumpBids && open && !isHigh && (
        <div className="flex gap-1.5">
          <MoneyInput className="flex-1" value={custom} onChange={setCustom} placeholder="Custom bid" />
          <button className="btn-ghost" disabled={!custom || (next !== null && custom < next) || busy} onClick={() => bid(custom)}>
            Bid
          </button>
        </div>
      )}
      {soloKeyboard && open && <div className="text-[10px] text-white/30 text-center">Tip: press B to place the next bid</div>}
    </div>
  )
}

function BottomTabs({ onProfile }: { onProfile: (p: Player) => void }) {
  const { state, library } = useRoom()
  const [tab, setTab] = useState<'queue' | 'sold' | 'unsold'>('queue')
  if (!state) return null
  const lots = Object.values(state.lots)
  const sold = lots
    .filter((l) => l.status === 'sold')
    .map((l) => ({ l, at: l.attempts[l.attempts.length - 1]?.endedAt ?? 0 }))
    .sort((a, b) => b.at - a.at)
  const unsold = lots.filter((l) => l.status === 'unsold' || l.status === 'skipped')
  const tabs = [
    ['queue', `Up next (${state.queue.length})`],
    ['sold', `Sold (${sold.length})`],
    ['unsold', `Unsold / skipped (${unsold.length})`],
  ] as const
  const Row = ({ id, right }: { id: string; right: React.ReactNode }) => {
    const p = library[id]
    if (!p) return null
    return (
      <button onClick={() => onProfile(p)} className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-white/[0.04] text-left min-w-0">
        <Avatar player={p} size={34} />
        <div className="min-w-0 flex-1">
          <div className="text-sm truncate">{p.name}</div>
          <div className="text-[11px] text-white/45 truncate">
            {ROLE_LABEL[p.role]} · {p.nationality}
            {p.overseas ? ' · OS' : ''}
          </div>
        </div>
        {right}
      </button>
    )
  }
  return (
    <div className="card">
      <div className="flex gap-1 px-2 pt-2 border-b border-white/[0.06] overflow-x-auto">
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={cls('px-3 py-2 text-sm border-b-2 whitespace-nowrap', tab === k ? 'border-gold-400' : 'border-transparent text-white/50')}>
            {label}
          </button>
        ))}
      </div>
      <div className="p-2 grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-1 max-h-80 overflow-y-auto scroll-thin">
        {tab === 'queue' &&
          (state.queue.length ? (
            state.queue.slice(0, 60).map((id, i) => <Row key={id} id={id} right={<span className="text-right"><span className="block text-[10px] text-white/35">#{i + 1} · {state.lots[id]?.set}</span><Money v={state.lots[id]?.basePrice} className="text-sm text-white/70" /></span>} />)
          ) : (
            <Empty>Queue is empty</Empty>
          ))}
        {tab === 'sold' &&
          (sold.length ? (
            sold.map(({ l }) => (
              <Row
                key={l.playerId}
                id={l.playerId}
                right={
                  <span className="flex items-center gap-1.5">
                    <TeamBadge code={l.soldTo} size="xs" />
                    <Money v={l.soldPrice} className="text-sm text-gold-300" />
                  </span>
                }
              />
            ))
          ) : (
            <Empty>Nothing sold yet</Empty>
          ))}
        {tab === 'unsold' &&
          (unsold.length ? (
            unsold.map((l) => <Row key={l.playerId} id={l.playerId} right={<span className="text-right text-[11px] text-white/45">{l.status}<br />base {formatMoney(l.basePrice)}</span>} />)
          ) : (
            <Empty>No unsold players</Empty>
          ))}
      </div>
    </div>
  )
}
