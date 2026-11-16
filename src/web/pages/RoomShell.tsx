import { useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useNavigate, useParams } from 'react-router-dom'
import { RoomProvider, forgetSession, sessions, useRoom, useServerNow } from '../lib/room'
import { Toasts, TeamBadge } from '../components/ui'
import { cls } from '../lib/helpers'
import { Brand } from './Home'

export default function RoomShell() {
  const { code = '' } = useParams()
  const C = code.toUpperCase()
  const s = sessions()[C]
  if (!s) return <Navigate to={`/join/${C}`} replace />
  return (
    <RoomProvider code={C} token={s.token}>
      <Inner />
      <Toasts />
    </RoomProvider>
  )
}

function GateScreen() {
  const { gate, code, connError } = useRoom()
  const nav = useNavigate()
  const msg: Record<string, [string, string]> = {
    pending: ['Waiting for the host', 'Your request has been sent. This page updates automatically once the host approves you.'],
    rejected: ['Request declined', 'The host declined your request to join this room.'],
    banned: ['Access revoked', 'You have been banned from this room.'],
    removed: ['Removed from room', 'The host removed you from this room. Ask them to restore access.'],
    deleted: ['Room deleted', 'The host deleted this room.'],
  }
  const err = connError && /auth/.test(connError)
  const [title, body] = err ? ['Session not recognised', 'This device’s saved session for the room is no longer valid.'] : msg[gate?.status ?? ''] ?? ['Connecting…', 'Establishing a secure connection to the auction server.']
  const terminal = err || (gate && gate.status !== 'pending')
  return (
    <div className="min-h-screen px-4 py-10">
      <div className="max-w-md mx-auto space-y-8">
        <Brand />
        <div className="card p-6 space-y-3">
          <div className="label">{gate?.roomName ?? 'Room'} · {code}</div>
          <div className="font-display text-3xl font-bold">{title}</div>
          <p className="text-white/60 text-sm">{body}</p>
          {gate?.status === 'pending' && <div className="h-1 rounded bg-white/10 overflow-hidden"><div className="h-full w-1/3 bg-gold-400 animate-pulse" /></div>}
          {terminal && (
            <button
              className="btn-ghost"
              onClick={() => {
                forgetSession(code)
                nav(gate?.status === 'deleted' ? '/' : `/join/${code}`)
              }}
            >
              {gate?.status === 'deleted' ? 'Back to home' : 'Request access again'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const NAV = [
  ['lobby', 'Lobby'],
  ['config', 'Configuration'],
  ['live', 'Live Auction'],
  ['teams', 'Teams'],
  ['players', 'Players'],
  ['trades', 'Trade Centre'],
  ['history', 'History'],
] as const

function Inner() {
  const { state, gate, connected, isHost, me, code, send, myTeams } = useRoom()
  const now = useServerNow(1000)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (state) {
      const all = sessions()
      if (all[code] && all[code].roomName !== state.name) localStorage.setItem('iplwr.sessions', JSON.stringify({ ...all, [code]: { ...all[code], roomName: state.name } }))
    }
  }, [state, code])
  if (!state || gate) return <GateScreen />

  const host = state.members[state.hostId]
  const pendingForMe = state.pendingHostTransfer?.to === me?.id
  const hostOffline = !state.online.includes(state.hostId)
  const offlineFor = hostOffline ? Math.floor((now - state.hostLastSeenAt) / 1000) : 0
  const canClaim = hostOffline && !isHost && offlineFor >= state.config.hostClaimAfterSeconds
  const statusLabel = state.archived ? 'Archived' : state.phase === 'lobby' ? 'Setup' : state.phase === 'completed' ? 'Completed' : state.paused ? 'Paused' : 'Live'
  const statusColor = state.archived ? 'bg-white/10 text-white/60' : state.phase === 'live' ? (state.paused ? 'bg-amber-400/15 text-amber-300' : 'bg-red-500/15 text-red-300') : state.phase === 'completed' ? 'bg-emerald-400/15 text-emerald-300' : 'bg-sky-400/15 text-sky-300'
  const pendingJoins = Object.values(state.members).filter((m) => m.status === 'pending').length
  const incomingTrades = Object.values(state.trades).filter((t) => t.status === 'pending' && myTeams.includes(t.to)).length

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 bg-ink-900/90 backdrop-blur border-b border-white/[0.06]">
        <div className="max-w-[1600px] mx-auto px-3 sm:px-5 py-2 flex items-center gap-3 flex-wrap">
          <Link to="/" className="shrink-0" title="Home">
            <Brand small />
          </Link>
          <div className="hidden md:block h-6 w-px bg-white/10" />
          <div className="min-w-0 flex-1 flex items-center gap-x-4 gap-y-1 flex-wrap text-sm">
            <span className="font-semibold truncate max-w-[14rem]">{state.name}</span>
            <button
              className="font-display tracking-[0.25em] text-gold-400 hover:text-gold-300"
              title="Copy room code"
              onClick={() => {
                navigator.clipboard?.writeText(code)
                setCopied(true)
                setTimeout(() => setCopied(false), 1200)
              }}
            >
              {copied ? 'COPIED' : code}
            </button>
            <span className="text-white/55 hidden sm:inline">
              {state.config.auctionType === 'mega' ? 'Mega' : 'Mini'} auction · Season {state.season}
              {state.phase !== 'lobby' && ` · ${state.round <= 1 ? 'Main round' : `Unsold round ${state.round - 1}`}`}
            </span>
            <span className={cls('chip border-transparent', statusColor)}>
              {state.phase === 'live' && !state.paused && <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />}
              {statusLabel}
            </span>
            <span className="text-white/55 text-xs">
              Host: <span className="text-white">{host?.name}</span>
              {hostOffline && <span className="text-amber-300"> (offline)</span>}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {myTeams.map((t) => (
              <TeamBadge key={t} code={t} size="sm" />
            ))}
            <span className={cls('h-2 w-2 rounded-full', connected ? 'bg-emerald-400' : 'bg-red-400 animate-pulse')} title={connected ? 'Connected' : 'Reconnecting'} />
          </div>
        </div>
        <nav className="max-w-[1600px] mx-auto px-2 sm:px-4 flex gap-1 overflow-x-auto scroll-thin">
          {[...NAV, ...(isHost ? ([['host', 'Host Control']] as const) : [])].map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cls('relative px-3 py-2 text-sm whitespace-nowrap border-b-2 transition', isActive ? 'border-gold-400 text-white' : 'border-transparent text-white/55 hover:text-white')
              }
            >
              {label}
              {to === 'lobby' && isHost && pendingJoins > 0 && <span className="ml-1.5 chip border-transparent bg-gold-400 text-ink-950">{pendingJoins}</span>}
              {to === 'trades' && incomingTrades > 0 && <span className="ml-1.5 chip border-transparent bg-indigo-400 text-ink-950">{incomingTrades}</span>}
              {to === 'live' && state.phase === 'live' && !state.paused && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-red-400 align-middle" />}
            </NavLink>
          ))}
        </nav>
      </header>

      {!connected && <div className="bg-red-500/15 text-red-200 text-sm text-center py-1.5">Connection lost. Reconnecting… your bids are safe on the server.</div>}
      {state.archived && <div className="bg-white/5 text-white/70 text-sm text-center py-1.5">This room is archived and read-only.</div>}
      {pendingForMe && (
        <div className="bg-gold-400/15 border-b border-gold-400/30 px-4 py-2.5 flex flex-wrap gap-3 items-center justify-center text-sm">
          <span>
            <b>{host?.name}</b> wants to hand you host controls. The auction continues exactly where it is.
          </span>
          <button className="btn-gold btn-sm" onClick={() => send('respondHostTransfer', { accept: true }, { success: 'You are now the host' })}>
            Accept host role
          </button>
          <button className="btn-ghost btn-sm" onClick={() => send('respondHostTransfer', { accept: false })}>
            Decline
          </button>
        </div>
      )}
      {isHost && state.pendingHostTransfer && (
        <div className="bg-white/5 px-4 py-2 flex gap-3 items-center justify-center text-sm">
          Waiting for {state.members[state.pendingHostTransfer.to]?.name} to accept host controls…
          <button className="btn-ghost btn-sm" onClick={() => send('cancelHostTransfer')}>
            Cancel
          </button>
        </div>
      )}
      {canClaim && me?.status === 'approved' && (
        <div className="bg-amber-400/10 px-4 py-2 flex gap-3 items-center justify-center text-sm text-amber-100">
          The host has been offline for {offlineFor}s.
          <button className="btn-gold btn-sm" onClick={() => send('claimHost', {}, { success: 'You are now the host' })}>
            Take over as host
          </button>
        </div>
      )}

      <main className="flex-1 max-w-[1600px] w-full mx-auto px-3 sm:px-5 py-4 sm:py-5">
        <Outlet />
      </main>
    </div>
  )
}
