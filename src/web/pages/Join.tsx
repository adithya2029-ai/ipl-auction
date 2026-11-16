import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, saveSession, sessions } from '../lib/room'
import { Brand } from './Home'

export default function Join() {
  const { code = '' } = useParams()
  const [q] = useSearchParams()
  const invite = q.get('k') ?? ''
  const nav = useNavigate()
  const [meta, setMeta] = useState<{ name: string; requiresPassword: boolean; archived: boolean; spectatorsAllowed: boolean } | null>(null)
  const [err, setErr] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'owner' | 'spectator'>(q.get('as') === 'spectator' ? 'spectator' : 'owner')
  const [busy, setBusy] = useState(false)
  const C = code.toUpperCase()

  useEffect(() => {
    if (sessions()[C]) nav(`/r/${C}/lobby`, { replace: true })
    api<typeof meta & object>(`/api/rooms/${C}`)
      .then(setMeta)
      .catch((e) => setErr(e.message))
  }, [C, nav])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      const r = await api<{ token: string; memberId: string }>(`/api/rooms/${C}/join`, { name, password, role, invite })
      saveSession(C, { token: r.token, memberId: r.memberId, name, roomName: meta?.name, savedAt: Date.now() })
      nav(`/r/${C}/lobby`)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen px-4 py-10">
      <div className="max-w-md mx-auto space-y-8">
        <Brand />
        <form onSubmit={submit} className="card p-5 space-y-4">
          <div>
            <div className="label">Private room</div>
            <div className="font-display text-3xl font-bold">{meta?.name ?? '…'}</div>
            <div className="font-display tracking-[0.3em] text-gold-400">{C}</div>
          </div>
          {meta?.archived && <div className="text-sm text-amber-200">This room is archived and not accepting new participants.</div>}
          <div>
            <label className="label">Your name</label>
            <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} required maxLength={30} autoFocus />
          </div>
          <div>
            <label className="label">Join as</label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {(['owner', 'spectator'] as const).map((r) => (
                <button
                  type="button"
                  key={r}
                  disabled={r === 'spectator' && meta?.spectatorsAllowed === false}
                  onClick={() => setRole(r)}
                  className={role === r ? 'btn-gold' : 'btn-ghost'}
                >
                  {r === 'owner' ? 'Franchise owner' : 'Spectator'}
                </button>
              ))}
            </div>
          </div>
          {meta?.requiresPassword && !invite && (
            <div>
              <label className="label">Room password</label>
              <input className="input mt-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
          )}
          {invite && <div className="text-xs text-emerald-300/80">Invitation link detected. No password needed.</div>}
          {err && <div className="text-sm text-red-300">{err}</div>}
          <button className="btn-gold w-full py-2.5" disabled={busy || !meta || meta.archived}>
            Request to join
          </button>
          <p className="text-xs text-white/40">The host approves every participant. You will stay signed in on this device and can reconnect any time.</p>
        </form>
      </div>
    </div>
  )
}
