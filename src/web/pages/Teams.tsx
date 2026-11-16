import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { Player, Role, TeamCode } from '@shared/types'
import { ROLES, TEAM_CODES } from '@shared/types'
import { ROLE_LABEL, ROLE_PLURAL, TEAM_META, overseasCount, roleCounts } from '@shared/rules'
import { useRoom } from '../lib/room'
import { cls, ownerName } from '../lib/helpers'
import { Avatar, Money, PlayerProfile, RoleChip, Stat, TeamBadge } from '../components/ui'

export default function Teams() {
  const { team } = useParams()
  const code = TEAM_CODES.find((t) => t === team?.toUpperCase())
  return code ? <TeamDetail code={code} /> : <Compare />
}

function Compare() {
  const { state, library } = useRoom()
  const nav = useNavigate()
  const [sort, setSort] = useState<'purse' | 'spent' | 'squad'>('purse')
  if (!state) return null
  const rows = TEAM_CODES.map((t) => {
    const team = state.teams[t]
    const os = overseasCount(team, library)
    return { t, team, os, rc: roleCounts(team, library), owner: ownerName(state, t) }
  }).sort((a, b) => (sort === 'purse' ? b.team.purse - a.team.purse : sort === 'spent' ? b.team.spent - a.team.spent : b.team.squad.length - a.team.squad.length))
  const maxSpent = Math.max(1, ...rows.map((r) => r.team.spent))
  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">Franchise comparison</h1>
          <p className="text-sm text-white/50">Purses, squad balance and composition across all ten teams. Select a team for its full dashboard.</p>
        </div>
        <div className="flex gap-1">
          {(['purse', 'spent', 'squad'] as const).map((k) => (
            <button key={k} className={sort === k ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'} onClick={() => setSort(k)}>
              Sort by {k}
            </button>
          ))}
        </div>
      </div>
      <div className="card overflow-x-auto scroll-thin">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="text-left label">
              <th className="px-4 py-3">Franchise</th>
              <th className="px-2 py-3 text-right">Purse left</th>
              <th className="px-2 py-3">Spent</th>
              <th className="px-2 py-3 text-center">Squad</th>
              <th className="px-2 py-3 text-center">OS</th>
              <th className="px-2 py-3 text-center">IND</th>
              {ROLES.map((r) => (
                <th key={r} className="px-2 py-3 text-center" title={ROLE_PLURAL[r]}>
                  {r}
                </th>
              ))}
              <th className="px-2 py-3 text-center">RTM</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ t, team, os, rc, owner }) => (
              <tr key={t} className="table-row cursor-pointer" onClick={() => nav(t)}>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <TeamBadge code={t} size="sm" />
                    <div>
                      <div className="font-medium">{TEAM_META[t].name}</div>
                      <div className="text-[11px] text-white/45">{owner ?? 'No owner'}</div>
                    </div>
                  </div>
                </td>
                <td className="px-2 text-right">
                  <Money v={team.purse} className="text-base text-gold-300 font-semibold" />
                </td>
                <td className="px-2 w-44">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded bg-white/[0.06] overflow-hidden">
                      <div className="h-full rounded" style={{ width: `${(team.spent / maxSpent) * 100}%`, background: TEAM_META[t].primary }} />
                    </div>
                    <Money v={team.spent} className="text-xs w-16 text-right" />
                  </div>
                </td>
                <td className="px-2 text-center num">
                  {team.squad.length}/{state.config.maxSquad}
                </td>
                <td className={cls('px-2 text-center num', os >= state.config.maxOverseas && 'text-amber-300')}>{os}</td>
                <td className="px-2 text-center num">{team.squad.length - os}</td>
                {ROLES.map((r) => (
                  <td key={r} className="px-2 text-center num text-white/75">
                    {rc[r]}
                  </td>
                ))}
                <td className="px-2 text-center num">{team.rtmCards}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-3">
        {rows.map(({ t, team }) => (
          <Link key={t} to={t} className="card p-3 hover:border-gold-400/40 transition">
            <div className="flex items-center gap-2 mb-2">
              <TeamBadge code={t} size="sm" />
              <span className="font-semibold text-sm">{t}</span>
              <Money v={team.purse} className="ml-auto text-sm text-gold-300" />
            </div>
            <div className="space-y-0.5">
              {[...team.squad]
                .sort((a, b) => b.price - a.price)
                .slice(0, 6)
                .map((e) => (
                  <div key={e.playerId} className="flex text-xs text-white/70 gap-2">
                    <span className="truncate flex-1">{library[e.playerId]?.name}</span>
                    <Money v={e.price} className="text-white/50" />
                  </div>
                ))}
              {team.squad.length > 6 && <div className="text-[11px] text-white/35">+{team.squad.length - 6} more</div>}
              {team.squad.length === 0 && <div className="text-xs text-white/35">No players yet</div>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

function TeamDetail({ code }: { code: TeamCode }) {
  const { state, library, myTeams, isHost, send } = useRoom()
  const [roleFilter, setRoleFilter] = useState<Role | 'ALL' | 'OS' | 'IND'>('ALL')
  const [profile, setProfile] = useState<Player | null>(null)
  const team = state?.teams[code]
  const [xi, setXi] = useState<string[]>([])
  const [captain, setCaptain] = useState<string | null>(null)
  const [vc, setVc] = useState<string | null>(null)
  useEffect(() => {
    if (team) {
      setXi(team.xi)
      setCaptain(team.captain)
      setVc(team.viceCaptain)
    }
  }, [team])
  const squad = useMemo(() => (team ? [...team.squad].sort((a, b) => b.price - a.price) : []), [team])
  if (!state || !team) return null
  const canEdit = (myTeams.includes(code) || isHost) && !state.archived
  const rc = roleCounts(team, library)
  const os = overseasCount(team, library)
  const xiOs = xi.filter((id) => library[id]?.overseas).length
  const dirty = JSON.stringify([xi, captain, vc]) !== JSON.stringify([team.xi, team.captain, team.viceCaptain])
  const xiWk = xi.some((id) => library[id]?.role === 'WK' || library[id]?.secondaryRole === 'WK')
  const xiBowlers = xi.filter((id) => ['FAST', 'SPIN', 'AR'].includes(library[id]?.role ?? '')).length
  const filtered = squad.filter((e) => {
    const p = library[e.playerId]
    if (!p) return false
    if (roleFilter === 'ALL') return true
    if (roleFilter === 'OS') return p.overseas
    if (roleFilter === 'IND') return !p.overseas
    return p.role === roleFilter
  })
  const toggleXi = (id: string) => {
    if (xi.includes(id)) {
      setXi(xi.filter((x) => x !== id))
      if (captain === id) setCaptain(null)
      if (vc === id) setVc(null)
    } else if (xi.length < 11) setXi([...xi, id])
  }
  const m = TEAM_META[code]

  return (
    <div className="space-y-5">
      <div className="card overflow-hidden">
        <div className="p-5 flex flex-wrap items-center gap-4" style={{ background: `linear-gradient(110deg, ${m.primary}55 0%, transparent 60%)` }}>
          <TeamBadge code={code} size="xl" />
          <div className="flex-1 min-w-0">
            <Link to=".." relative="path" className="text-xs text-white/50 hover:text-white">
              ← All franchises
            </Link>
            <div className="font-display text-3xl sm:text-4xl font-bold leading-tight">{m.name}</div>
            <div className="text-sm text-white/60">Owner: {ownerName(state, code) ?? 'unassigned'}</div>
          </div>
          <div className="flex gap-1 flex-wrap">
            {TEAM_CODES.map((t) => (
              <Link key={t} to={`../${t}`} relative="path" className={cls('rounded-md p-0.5', t === code && 'ring-1 ring-gold-400')}>
                <TeamBadge code={t} size="xs" />
              </Link>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 p-4 border-t border-white/[0.06]">
          <Stat label="Remaining purse" value={<Money v={team.purse} className="text-gold-300" />} />
          <Stat label="Total spent" value={<Money v={team.spent} />} />
          <Stat label="Squad" value={`${team.squad.length}/${state.config.maxSquad}`} sub={team.squad.length < state.config.minSquad ? `${state.config.minSquad - team.squad.length} below minimum` : 'minimum met'} />
          <Stat label="Overseas" value={`${os}/${state.config.maxOverseas}`} sub={`${team.squad.length - os} Indian`} />
          {ROLES.map((r) => (
            <Stat key={r} label={ROLE_PLURAL[r]} value={rc[r]} />
          ))}
        </div>
      </div>

      <div className="grid xl:grid-cols-[1fr_380px] gap-5">
        <div className="card">
          <div className="card-hd flex-wrap">
            <div className="font-semibold">Squad ({team.squad.length})</div>
            <div className="flex gap-1 flex-wrap">
              {(['ALL', ...ROLES, 'OS', 'IND'] as const).map((r) => (
                <button key={r} onClick={() => setRoleFilter(r)} className={roleFilter === r ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}>
                  {r === 'ALL' ? 'All' : r === 'OS' ? 'Overseas' : r === 'IND' ? 'Indian' : ROLE_PLURAL[r]}
                </button>
              ))}
            </div>
          </div>
          <div>
            {filtered.length === 0 && <div className="text-sm text-white/40 p-6 text-center">No players match.</div>}
            {filtered.map((e) => {
              const p = library[e.playerId]
              const inXi = xi.includes(e.playerId)
              return (
                <div key={e.playerId} className={cls('flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.04]', inXi && 'bg-emerald-400/[0.04]')}>
                  <button onClick={() => setProfile(p)}>
                    <Avatar player={p} size={40} />
                  </button>
                  <button onClick={() => setProfile(p)} className="min-w-0 flex-1 text-left">
                    <div className="text-sm font-medium truncate">
                      {p.name}
                      {captain === p.id && <span className="ml-1.5 chip border-gold-400/50 text-gold-300">C</span>}
                      {vc === p.id && <span className="ml-1.5 chip border-white/30 text-white/80">VC</span>}
                    </div>
                    <div className="text-[11px] text-white/45 flex gap-1.5 flex-wrap items-center">
                      <RoleChip p={p} />
                      {p.nationality}
                      {p.overseas && <span className="text-amber-300">OS</span>}· {e.via}
                    </div>
                  </button>
                  <Money v={e.price} className="text-base font-semibold" />
                  {canEdit && (
                    <button className={inXi ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'} onClick={() => toggleXi(e.playerId)} disabled={!inXi && xi.length >= 11}>
                      {inXi ? 'In XI' : 'Bench'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div className="card h-fit xl:sticky xl:top-28">
          <div className="card-hd">
            <div className="font-semibold">Playing XI</div>
            <span className={cls('text-xs num', xi.length === 11 ? 'text-emerald-300' : 'text-white/50')}>{xi.length}/11</span>
          </div>
          <div className="p-3 space-y-1">
            {xi.length === 0 && <div className="text-sm text-white/40 py-4 text-center">{canEdit ? 'Pick players from the squad to build your XI.' : 'No XI selected yet.'}</div>}
            {xi.map((id, i) => {
              const p = library[id]
              return (
                <div key={id} className="flex items-center gap-2 text-sm py-1">
                  <span className="w-5 text-white/35 num">{i + 1}</span>
                  <span className="flex-1 truncate">
                    {p?.name} <span className="text-[11px] text-white/40">{p ? ROLE_LABEL[p.role] : ''}{p?.overseas ? ' · OS' : ''}</span>
                  </span>
                  {canEdit && (
                    <>
                      <button disabled={i === 0} className="btn-ghost btn-sm px-1.5" onClick={() => setXi(moveItem(xi, i, i - 1))}>
                        ↑
                      </button>
                      <button className={cls('btn-sm px-2', captain === id ? 'btn-gold' : 'btn-ghost')} onClick={() => (setCaptain(captain === id ? null : id), vc === id && setVc(null))}>
                        C
                      </button>
                      <button className={cls('btn-sm px-2', vc === id ? 'btn-gold' : 'btn-ghost')} onClick={() => (setVc(vc === id ? null : id), captain === id && setCaptain(null))}>
                        VC
                      </button>
                    </>
                  )}
                </div>
              )
            })}
          </div>
          <div className="px-4 pb-3 text-xs space-y-0.5">
            <div className={xiOs > state.config.xiOverseasLimit ? 'text-red-300' : 'text-white/50'}>
              Overseas {xiOs}/{state.config.xiOverseasLimit}
            </div>
            {xi.length > 0 && !xiWk && <div className="text-amber-300/80">No wicketkeeper selected</div>}
            {xi.length >= 8 && xiBowlers < 5 && <div className="text-amber-300/80">Fewer than five bowling options</div>}
            <div className="text-white/40">Bench: {team.squad.length - xi.length} players</div>
          </div>
          {canEdit && (
            <div className="p-3 border-t border-white/[0.06] flex gap-2">
              <button className="btn-ghost flex-1" disabled={!dirty} onClick={() => (setXi(team.xi), setCaptain(team.captain), setVc(team.viceCaptain))}>
                Reset
              </button>
              <button className="btn-gold flex-1" disabled={!dirty || xiOs > state.config.xiOverseasLimit} onClick={() => send('setLineup', { team: code, xi, captain, viceCaptain: vc }, { success: 'Line-up saved' })}>
                Save XI
              </button>
            </div>
          )}
        </div>
      </div>
      <PlayerProfile p={profile} onClose={() => setProfile(null)} />
    </div>
  )
}

function moveItem<T>(a: T[], i: number, j: number) {
  const b = [...a]
  const [x] = b.splice(i, 1)
  b.splice(j, 0, x)
  return b
}
