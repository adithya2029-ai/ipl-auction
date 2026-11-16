import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, forgetSession, saveSession, sessions } from '../lib/room'
import { relTime } from '../lib/helpers'

export function Brand({ small }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={small ? 'h-8 w-8' : 'h-11 w-11'}>
        <svg viewBox="0 0 32 32" className="w-full h-full">
          <rect width="32" height="32" rx="8" fill="#121a31" stroke="rgba(220,188,99,0.4)" />
          <path d="M9 23l8-14 2 1-8 14z" fill="#dcbc63" />
          <circle cx="22" cy="21" r="3" fill="#fff" />
        </svg>
      </div>
      <div className="leading-none">
        <div className={`font-display font-bold tracking-wide ${small ? 'text-lg' : 'text-2xl'}`}>
          AUCTION <span className="text-gold-400">WAR ROOM</span>
        </div>
        {!small && <div className="label mt-1">Private IPL franchise auctions</div>}
      </div>
    </div>
  )
}

export default function Home() {
  const nav = useNavigate()
  const [roomName, setRoomName] = useState('')
  const [hostName, setHostName] = useState('')
  const [password, setPassword] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [, force] = useState(0)
  const saved = Object.entries(sessions()).sort((a, b) => b[1].savedAt - a[1].savedAt)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      const r = await api<{ code: string; token: string; memberId: string }>('/api/rooms', { roomName, hostName, password })
      saveSession(r.code, { token: r.token, memberId: r.memberId, name: hostName, roomName: roomName || 'IPL Auction War Room', savedAt: Date.now() })
      nav(`/r/${r.code}/lobby`)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen px-4 py-8 sm:py-14">
      <div className="max-w-5xl mx-auto">
        <Brand />
        <h1 className="mt-10 font-display text-4xl sm:text-6xl font-bold leading-[0.95] max-w-3xl">
          Your private franchise universe. <span className="text-gold-400">Ten owners. One hammer.</span>
        </h1>
        <p className="mt-4 text-white/60 max-w-2xl">
          Run mega and mini auctions with current IPL players and legends, bid in real time, trade during and after the auction, and keep every rupee accounted for.
        </p>

        <div className="mt-10 grid md:grid-cols-2 gap-5">
          <form onSubmit={create} className="card p-5 space-y-3">
            <div className="font-display text-xl font-semibold">Create a private room</div>
            <div>
              <label className="label">Room name</label>
              <input className="input mt-1" value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="Sunday League Mega Auction" maxLength={60} />
            </div>
            <div>
              <label className="label">Your name</label>
              <input className="input mt-1" value={hostName} onChange={(e) => setHostName(e.target.value)} placeholder="Shown to other owners" maxLength={30} required />
            </div>
            <div>
              <label className="label">Room password (optional)</label>
              <input className="input mt-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Friends need this unless they use your invite link" />
            </div>
            {err && <div className="text-sm text-red-300">{err}</div>}
            <button className="btn-gold w-full py-2.5" disabled={busy}>
              {busy ? 'Creating…' : 'Create room'}
            </button>
            <p className="text-xs text-white/40">You start as host. Host controls can be handed to anyone later, even mid-bid.</p>
          </form>

          <div className="space-y-5">
            <form
              className="card p-5 space-y-3"
              onSubmit={(e) => {
                e.preventDefault()
                const c = joinCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
                if (c) nav(sessions()[c] ? `/r/${c}/lobby` : `/join/${c}`)
              }}
            >
              <div className="font-display text-xl font-semibold">Join with a room code</div>
              <div className="flex gap-2">
                <input className="input font-display tracking-[0.3em] uppercase text-lg" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="ABC123" maxLength={8} />
                <button className="btn-ghost px-5">Join</button>
              </div>
            </form>

            {saved.length > 0 && (
              <div className="card">
                <div className="card-hd">
                  <div className="font-semibold">Your rooms on this device</div>
                </div>
                <div>
                  {saved.map(([code, s]) => (
                    <div key={code} className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.05] last:border-0">
                      <Link to={`/r/${code}/lobby`} className="flex-1 min-w-0">
                        <div className="font-medium truncate">{s.roomName ?? 'Room'}</div>
                        <div className="text-xs text-white/45">
                          <span className="font-display tracking-widest text-white/70">{code}</span> · as {s.name} · {relTime(s.savedAt)}
                        </div>
                      </Link>
                      <button
                        className="btn-ghost btn-sm"
                        title="Forget on this device"
                        onClick={() => {
                          forgetSession(code)
                          force((x) => x + 1)
                        }}
                      >
                        Forget
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
