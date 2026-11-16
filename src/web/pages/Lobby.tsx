import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { TeamCode } from '@shared/types'
import { TEAM_CODES } from '@shared/types'
import { TEAM_META, formatMoney } from '@shared/rules'
import { useRoom } from '../lib/room'
import { cls, ownerName } from '../lib/helpers'
import { TeamBadge } from '../components/ui'

export function InviteBox() {
  const { send, code, isHost } = useRoom()
  const [invite, setInvite] = useState<{ inviteKey: string; hasPassword: boolean } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  useEffect(() => {
    if (isHost) send('getInvite', {}, { quiet: true }).then((r) => r.ok && setInvite(r.data as typeof invite))
  }, [isHost, send])
  const origin = window.location.origin
  const links: [string, string][] = invite
    ? [
        ['Owner invite link', `${origin}/join/${code}?k=${invite.inviteKey}`],
        ['Spectator invite link', `${origin}/join/${code}?k=${invite.inviteKey}&as=spectator`],
      ]
    : []
  const copy = (k: string, v: string) => {
    navigator.clipboard?.writeText(v)
    setCopied(k)
    setTimeout(() => setCopied(null), 1400)
  }
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="label">Room code</div>
          <div className="font-display text-4xl tracking-[0.3em] text-gold-400">{code}</div>
        </div>
        <button className="btn-ghost btn-sm" onClick={() => copy('code', code)}>
          {copied === 'code' ? 'Copied' : 'Copy code'}
        </button>
      </div>
      {isHost ? (
        <>
          {links.map(([label, url]) => (
            <div key={label}>
              <div className="label mb-1">{label}</div>
              <div className="flex gap-2">
                <input readOnly className="input text-xs" value={url} onFocus={(e) => e.target.select()} />
                <button className="btn-ghost btn-sm shrink-0" onClick={() => copy(label, url)}>
                  {copied === label ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          ))}
          <p className="text-xs text-white/45">
            Invite links skip the room password{invite?.hasPassword ? '' : ' (none set)'}; every request still needs your approval. Regenerate the link from Host Control if it leaks.
          </p>
        </>
      ) : (
        <p className="text-xs text-white/45">Share the code with friends. The host approves everyone who joins.</p>
      )}
    </div>
  )
}

export default function Lobby() {
  const { state, me, isHost, send, myTeams } = useRoom()
  const [assign, setAssign] = useState<Record<string, TeamCode | ''>>({})
  if (!state) return null
  const members = Object.values(state.members)
  const pending = members.filter((m) => m.status === 'pending')
  const approved = members.filter((m) => m.status === 'approved')
  const taken = (t: TeamCode) => approved.find((m) => m.teamIds.includes(t))
  const owners = approved.filter((m) => m.role === 'owner').length

  return (
    <div className="grid lg:grid-cols-[1fr_380px] gap-5">
      <div className="space-y-5">
        <div className="card">
          <div className="card-hd">
            <div>
              <div className="font-display text-xl font-semibold">Franchises</div>
              <div className="text-xs text-white/45">{owners}/10 owner slots filled · one franchise per owner{state.config.allowMultipleTeamsPerOwner ? ' (multiple allowed)' : ''}</div>
            </div>
            {state.phase === 'lobby' && isHost && (
              <Link to="../config" className="btn-gold">
                Configure &amp; start →
              </Link>
            )}
            {state.phase !== 'lobby' && (
              <Link to="../live" className="btn-gold">
                Go to live auction →
              </Link>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 p-4">
            {TEAM_CODES.map((t) => {
              const holder = taken(t)
              const mine = myTeams.includes(t)
              const team = state.teams[t]
              return (
                <div
                  key={t}
                  className={cls('rounded-xl border p-3 flex xl:flex-col gap-3 items-center xl:items-start', mine ? 'border-gold-400/60 bg-gold-400/[0.06]' : 'border-white/[0.07] bg-white/[0.02]')}
                >
                  <TeamBadge code={t} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold leading-tight">{TEAM_META[t].name}</div>
                    <div className="text-xs text-white/50 truncate flex items-center gap-1.5">
                      {holder ? (
                        <>
                          <span className={cls('h-1.5 w-1.5 rounded-full', state.online.includes(holder.id) ? 'bg-emerald-400' : 'bg-white/25')} />
                          {holder.name}
                        </>
                      ) : (
                        'Available'
                      )}
                    </div>
                    <div className="text-[11px] text-white/40 mt-0.5">
                      {formatMoney(team.purse)} · {team.squad.length} players
                    </div>
                  </div>
                  {!holder && me?.role === 'owner' && (myTeams.length === 0 || state.config.allowMultipleTeamsPerOwner || state.phase === 'lobby') && (
                    <button className="btn-ghost btn-sm" onClick={() => send('claimTeam', { team: t })}>
                      Claim
                    </button>
                  )}
                  {mine && state.phase === 'lobby' && (
                    <button className="btn-ghost btn-sm" onClick={() => send('releaseTeam', { team: t })}>
                      Release
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {isHost && pending.length > 0 && (
          <div className="card border-gold-400/30">
            <div className="card-hd">
              <div className="font-semibold">Join requests ({pending.length})</div>
            </div>
            <div className="divide-y divide-white/[0.05]">
              {pending.map((m) => (
                <div key={m.id} className="px-4 py-3 flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-[10rem]">
                    <div className="font-medium">{m.name}</div>
                    <div className="text-xs text-white/45">wants to join as {m.role === 'owner' ? 'franchise owner' : 'spectator'}</div>
                  </div>
                  {m.role === 'owner' && (
                    <select className="input w-auto" value={assign[m.id] ?? ''} onChange={(e) => setAssign({ ...assign, [m.id]: e.target.value as TeamCode })}>
                      <option value="">Let them choose</option>
                      {TEAM_CODES.filter((t) => !taken(t)).map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  )}
                  <button className="btn-gold btn-sm" disabled={m.role === 'owner' && owners >= 10} onClick={() => send('approveMember', { memberId: m.id, team: assign[m.id] || undefined })}>
                    Approve{m.role === 'owner' ? ' as owner' : ''}
                  </button>
                  {m.role === 'owner' && (
                    <button className="btn-ghost btn-sm" onClick={() => send('approveMember', { memberId: m.id, role: 'spectator' })}>
                      As spectator
                    </button>
                  )}
                  <button className="btn-danger btn-sm" onClick={() => send('rejectMember', { memberId: m.id })}>
                    Decline
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {state.phase === 'lobby' && (
          <div className="card p-4 text-sm text-white/60 space-y-1">
            <div className="font-semibold text-white">What happens next</div>
            <p>
              {isHost
                ? 'Approve your friends, then open Configuration to choose the auction type, player pool, purse, timers, retentions and RTM rules. Start the auction from there.'
                : 'Claim your franchise. The host will configure and start the auction. You can browse the Players database meanwhile.'}
            </p>
          </div>
        )}
      </div>

      <div className="space-y-5">
        <InviteBox />
        <div className="card">
          <div className="card-hd">
            <div className="font-semibold">Participants</div>
            <span className="text-xs text-white/45">{state.online.length} online</span>
          </div>
          <div className="divide-y divide-white/[0.05]">
            {approved.map((m) => (
              <div key={m.id} className="px-4 py-2.5 flex items-center gap-3">
                <span className={cls('h-2 w-2 rounded-full', state.online.includes(m.id) ? 'bg-emerald-400' : 'bg-white/20')} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">
                    {m.name} {m.id === me?.id && <span className="text-white/40">(you)</span>}
                  </div>
                  <div className="text-[11px] text-white/45">
                    {m.id === state.hostId ? 'Host · ' : ''}
                    {m.role === 'owner' ? (m.teamIds.length ? m.teamIds.join(', ') : 'No franchise yet') : 'Spectator'}
                  </div>
                </div>
                {m.teamIds.map((t) => (
                  <TeamBadge key={t} code={t} size="sm" />
                ))}
                {m.id === state.hostId && <span className="chip border-gold-400/40 text-gold-300">HOST</span>}
              </div>
            ))}
          </div>
        </div>
        {!isHost && (
          <div className="text-xs text-white/40 px-1">
            Teams without an owner: {TEAM_CODES.filter((t) => !ownerName(state, t)).join(', ') || 'none'}
          </div>
        )}
      </div>
    </div>
  )
}
