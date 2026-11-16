import { useMemo, useState } from 'react'
import type { Player, Role } from '@shared/types'
import { ROLES, TEAM_CODES } from '@shared/types'
import { ROLE_LABEL, formatMoney } from '@shared/rules'
import { useRoom } from '../lib/room'
import { cls, parseCsv, teamOfPlayer } from '../lib/helpers'
import { Avatar, Confirm, Modal, Money, MoneyInput, PlayerProfile, PlayerTags, RoleChip, TeamBadge, Toggle } from '../components/ui'

type SortKey = 'name' | 'basePrice' | 'matches' | 'runs' | 'wickets' | 'strikeRate' | 'economy' | 'battingAvg' | 'lastSeason'

const SORTS: [SortKey, string][] = [
  ['basePrice', 'Base price'],
  ['name', 'Name'],
  ['matches', 'Matches'],
  ['runs', 'Runs'],
  ['wickets', 'Wickets'],
  ['strikeRate', 'Strike rate'],
  ['battingAvg', 'Batting avg'],
  ['economy', 'Economy'],
  ['lastSeason', 'Last season'],
]

export default function Players() {
  const { state, players, isHost, send, library } = useRoom()
  const [q, setQ] = useState('')
  const [pool, setPool] = useState<'all' | 'current' | 'legend'>('all')
  const [role, setRole] = useState<Role | 'all'>('all')
  const [origin, setOrigin] = useState<'all' | 'india' | 'overseas'>('all')
  const [cap, setCap] = useState<'all' | 'capped' | 'uncapped'>('all')
  const [auction, setAuction] = useState<'all' | 'inpool' | 'available' | 'sold' | 'unsold' | 'notin'>('all')
  const [sort, setSort] = useState<SortKey>('basePrice')
  const [desc, setDesc] = useState(true)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [profile, setProfile] = useState<Player | null>(null)
  const [editing, setEditing] = useState<Player | 'new' | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [bulkPrice, setBulkPrice] = useState<number | null>(null)
  const [remove, setRemove] = useState<Player | null>(null)
  const [limit, setLimit] = useState(80)

  const custom = useMemo(() => new Set(state?.config.customPoolIds ?? []), [state?.config.customPoolIds])
  const list = useMemo(() => {
    if (!state) return []
    const t = q.trim().toLowerCase()
    const out = players.filter((p) => {
      if (t && !p.name.toLowerCase().includes(t) && !p.shortName.toLowerCase().includes(t) && !p.nationality.toLowerCase().includes(t) && !p.iplTeams.some((x) => x.toLowerCase().includes(t))) return false
      if (pool !== 'all' && !p.pools.includes(pool)) return false
      if (role !== 'all' && p.role !== role) return false
      if (origin === 'india' && p.overseas) return false
      if (origin === 'overseas' && !p.overseas) return false
      if (cap === 'capped' && !p.capped) return false
      if (cap === 'uncapped' && p.capped) return false
      const lot = state.lots[p.id]
      if (auction === 'inpool' && !(state.phase === 'lobby' ? state.config.poolMode === 'custom' ? custom.has(p.id) : p.pools.some((x) => state.config.pools.includes(x)) : lot)) return false
      if (auction === 'available' && !(lot && ['pending', 'unsold', 'skipped'].includes(lot.status))) return false
      if (auction === 'sold' && !teamOfPlayer(state, p.id)) return false
      if (auction === 'unsold' && !(lot && (lot.status === 'unsold' || lot.status === 'skipped'))) return false
      if (auction === 'notin' && (lot || teamOfPlayer(state, p.id))) return false
      return true
    })
    const val = (p: Player): number | string => {
      if (sort === 'name') return p.name
      if (sort === 'basePrice') return p.basePrice
      if (sort === 'lastSeason') return p.lastSeason ?? 0
      const v = p.stats?.[sort]
      return v === null || v === undefined ? (sort === 'economy' ? 99 : -1) : v
    }
    out.sort((a, b) => {
      const x = val(a)
      const y = val(b)
      const r = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number)
      return (desc ? -r : r) || a.name.localeCompare(b.name)
    })
    return out
  }, [players, q, pool, role, origin, cap, auction, sort, desc, state, custom])
  if (!state) return null
  const lobby = state.phase === 'lobby'
  const selIds = [...sel]
  const allShownSelected = list.length > 0 && list.every((p) => sel.has(p.id))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold">Player database</h1>
          <p className="text-sm text-white/50">
            {players.length} players · {players.filter((p) => p.pools.includes('current')).length} current · {players.filter((p) => p.pools.includes('legend')).length} legends. Career stats are computed from IPL ball-by-ball data; unverified fields are flagged.
          </p>
        </div>
        {isHost && !state.archived && (
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => setImportOpen(true)}>
              Import CSV
            </button>
            <button className="btn-gold" onClick={() => setEditing('new')}>
              + Add player
            </button>
          </div>
        )}
      </div>

      <div className="card p-3 space-y-3">
        <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
          <input className="input" placeholder="Search name, country or team…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {SORTS.map(([k, l]) => (
              <option key={k} value={k}>
                Sort: {l}
              </option>
            ))}
          </select>
          <button className="btn-ghost" onClick={() => setDesc(!desc)}>
            {desc ? '↓ Desc' : '↑ Asc'}
          </button>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Seg value={pool} set={setPool} opts={[['all', 'All pools'], ['current', 'Current'], ['legend', 'Legends']]} />
          <Seg value={role} set={setRole} opts={[['all', 'All roles'], ...ROLES.map((r) => [r, ROLE_LABEL[r]] as [Role, string])]} />
          <Seg value={origin} set={setOrigin} opts={[['all', 'All'], ['india', 'Indian'], ['overseas', 'Overseas']]} />
          <Seg value={cap} set={setCap} opts={[['all', 'All'], ['capped', 'Capped'], ['uncapped', 'Uncapped']]} />
          <Seg
            value={auction}
            set={setAuction}
            opts={lobby ? [['all', 'Any'], ['inpool', 'In auction pool']] : [['all', 'Any'], ['inpool', 'In auction'], ['available', 'Still available'], ['sold', 'Owned'], ['unsold', 'Unsold'], ['notin', 'Not in auction']]}
          />
        </div>
      </div>

      {isHost && sel.size > 0 && !state.archived && (
        <div className="card p-3 flex flex-wrap items-center gap-2 border-gold-400/30 sticky top-28 z-20">
          <span className="text-sm font-semibold mr-1">{sel.size} selected</span>
          {lobby && (
            <>
              <button className="btn-gold btn-sm" onClick={() => send('setCustomPool', { ids: selIds, mode: 'add' }, { success: 'Added to custom pool' })}>
                Add to custom pool
              </button>
              <button className="btn-ghost btn-sm" onClick={() => send('setCustomPool', { ids: selIds, mode: 'remove' }, { success: 'Removed from custom pool' })}>
                Remove from pool
              </button>
              <button className="btn-ghost btn-sm" onClick={() => send('setCustomPool', { ids: selIds, mode: 'set' }, { success: 'Custom pool replaced' })}>
                Use only these
              </button>
            </>
          )}
          {!lobby && (
            <button className="btn-gold btn-sm" onClick={() => send('addToPool', { playerIds: selIds }, { success: 'Added to the auction queue' })}>
              Add to auction queue
            </button>
          )}
          <MoneyInput className="w-40" value={bulkPrice} onChange={setBulkPrice} placeholder="Base price" />
          <button className="btn-ghost btn-sm" disabled={!bulkPrice} onClick={() => send('bulkUpdatePlayers', { ids: selIds, patch: { basePrice: bulkPrice } }, { success: 'Base prices updated' })}>
            Set base price
          </button>
          <button className="btn-ghost btn-sm" onClick={() => send('bulkUpdatePlayers', { ids: selIds, patch: { marquee: true } })}>
            Mark marquee
          </button>
          <button className="btn-ghost btn-sm" onClick={() => send('bulkUpdatePlayers', { ids: selIds, patch: { marquee: false } })}>
            Unmark marquee
          </button>
          <button className="btn-ghost btn-sm ml-auto" onClick={() => setSel(new Set())}>
            Clear
          </button>
        </div>
      )}
      {lobby && state.config.poolMode === 'custom' && <div className="text-xs text-gold-300/80">Custom pool: {state.config.customPoolIds.length} players selected for this auction.</div>}

      <div className="card overflow-x-auto scroll-thin">
        <table className="w-full text-sm min-w-[860px]">
          <thead>
            <tr className="text-left label">
              {isHost && (
                <th className="pl-4 py-3 w-8">
                  <input type="checkbox" checked={allShownSelected} onChange={() => setSel(allShownSelected ? new Set() : new Set(list.map((p) => p.id)))} />
                </th>
              )}
              <th className="px-3 py-3">Player</th>
              <th className="px-2">Role</th>
              <th className="px-2">Country</th>
              <th className="px-2 text-right">M</th>
              <th className="px-2 text-right">Runs</th>
              <th className="px-2 text-right">SR</th>
              <th className="px-2 text-right">Wkts</th>
              <th className="px-2 text-right">Econ</th>
              <th className="px-2 text-right">Base</th>
              <th className="px-3">Auction</th>
              {isHost && <th className="px-2" />}
            </tr>
          </thead>
          <tbody>
            {list.slice(0, limit).map((p) => {
              const lot = state.lots[p.id]
              const owner = teamOfPlayer(state, p.id)
              return (
                <tr key={p.id} className="table-row">
                  {isHost && (
                    <td className="pl-4">
                      <input type="checkbox" checked={sel.has(p.id)} onChange={() => setSel((s) => (s.has(p.id) ? (s.delete(p.id), new Set(s)) : new Set(s.add(p.id))))} />
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <button className="flex items-center gap-2.5 text-left" onClick={() => setProfile(p)}>
                      <Avatar player={p} size={36} />
                      <div className="min-w-0">
                        <div className="font-medium hover:text-gold-300">{p.name}</div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <PlayerTags p={p} />
                          {p.dataNotes.length > 0 && <span className="text-amber-300/70 text-[10px]" title={p.dataNotes.join('\n')}>⚠ unverified</span>}
                        </div>
                      </div>
                    </button>
                  </td>
                  <td className="px-2">
                    <RoleChip p={p} />
                  </td>
                  <td className="px-2 text-white/70">{p.nationality}</td>
                  <td className="px-2 text-right num">{p.stats?.matches ?? '—'}</td>
                  <td className="px-2 text-right num">{p.stats?.runs ?? '—'}</td>
                  <td className="px-2 text-right num text-white/70">{p.stats?.strikeRate ?? '—'}</td>
                  <td className="px-2 text-right num">{p.stats?.wickets ?? '—'}</td>
                  <td className="px-2 text-right num text-white/70">{p.stats && p.stats.ballsBowled >= 60 ? p.stats.economy : '—'}</td>
                  <td className="px-2 text-right">
                    <Money v={p.basePrice} />
                  </td>
                  <td className="px-3">
                    {owner ? (
                      <span className="flex items-center gap-1.5">
                        <TeamBadge code={owner} size="xs" />
                        <Money v={state.teams[owner].squad.find((e) => e.playerId === p.id)?.price} className="text-xs text-white/60" />
                      </span>
                    ) : lot ? (
                      <span className={cls('text-xs capitalize', lot.status === 'live' ? 'text-red-300' : 'text-white/55')}>{lot.status === 'pending' ? 'queued' : lot.status}</span>
                    ) : lobby && state.config.poolMode === 'custom' && custom.has(p.id) ? (
                      <span className="text-xs text-gold-300">in pool</span>
                    ) : (
                      <span className="text-xs text-white/25">—</span>
                    )}
                  </td>
                  {isHost && (
                    <td className="px-2 whitespace-nowrap">
                      <button className="btn-ghost btn-sm" onClick={() => setEditing(p)} disabled={state.archived}>
                        Edit
                      </button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
        {list.length === 0 && <div className="text-center text-sm text-white/40 py-10">No players match these filters.</div>}
        {list.length > limit && (
          <div className="p-3 text-center">
            <button className="btn-ghost btn-sm" onClick={() => setLimit(limit + 200)}>
              Show more ({list.length - limit} remaining)
            </button>
          </div>
        )}
      </div>

      <PlayerProfile
        p={profile}
        onClose={() => setProfile(null)}
        extra={
          profile && isHost && !state.archived ? (
            <div className="flex gap-2">
              <button className="btn-ghost btn-sm" onClick={() => (setEditing(profile), setProfile(null))}>
                Edit player
              </button>
              <button className="btn-danger btn-sm" onClick={() => (setRemove(profile), setProfile(null))}>
                Remove
              </button>
            </div>
          ) : null
        }
      />
      {editing && <EditPlayer player={editing === 'new' ? null : library[editing.id]} onClose={() => setEditing(null)} onRemove={(p) => (setEditing(null), setRemove(p))} />}
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      <Confirm open={!!remove} onClose={() => setRemove(null)} danger title="Remove player?" confirmLabel="Remove" body={`Remove ${remove?.name} from this room’s player database? Players with auction history or in a squad cannot be removed.`} onConfirm={() => remove && send('removePlayer', { playerId: remove.id }, { success: 'Player removed' })} />
    </div>
  )
}

function Seg<T extends string>({ value, set, opts }: { value: T; set: (v: T) => void; opts: [T, string][] }) {
  return (
    <div className="flex rounded-lg bg-white/[0.04] p-0.5 flex-wrap">
      {opts.map(([k, l]) => (
        <button key={k} onClick={() => set(k)} className={cls('px-2.5 py-1 rounded-md', value === k ? 'bg-white/[0.12] text-white' : 'text-white/50 hover:text-white')}>
          {l}
        </button>
      ))}
    </div>
  )
}

function EditPlayer({ player, onClose, onRemove }: { player: Player | null; onClose: () => void; onRemove: (p: Player) => void }) {
  const { send } = useRoom()
  const [f, setF] = useState(() => ({
    name: player?.name ?? '',
    nationality: player?.nationality ?? 'India',
    overseas: player?.overseas ?? false,
    role: player?.role ?? ('BAT' as Role),
    secondaryRole: player?.secondaryRole ?? ('' as Role | ''),
    battingStyle: player?.battingStyle ?? '',
    bowlingStyle: player?.bowlingStyle ?? '',
    basePrice: player?.basePrice ?? 30,
    capped: player?.capped ?? false,
    marquee: player?.marquee ?? false,
    current: player ? player.pools.includes('current') : true,
    legend: player ? player.pools.includes('legend') : false,
    status: player?.status ?? 'active',
    lastTeam: player?.lastTeam ?? '',
    photoUrl: player?.photoUrl ?? '',
    iplTeams: player?.iplTeams.join(', ') ?? '',
  }))
  const up = (k: keyof typeof f, v: unknown) => setF({ ...f, [k]: v })
  async function save() {
    const patch = {
      name: f.name,
      nationality: f.nationality,
      overseas: f.overseas,
      role: f.role,
      secondaryRole: f.secondaryRole || null,
      battingStyle: f.battingStyle,
      bowlingStyle: f.bowlingStyle,
      basePrice: f.basePrice,
      capped: f.capped,
      marquee: f.marquee,
      pools: [...(f.current ? ['current'] : []), ...(f.legend ? ['legend'] : [])],
      status: f.status,
      lastTeam: f.lastTeam || null,
      photoUrl: f.photoUrl,
      iplTeams: f.iplTeams.split(',').map((x) => x.trim()).filter(Boolean),
    }
    const r = player ? await send('updatePlayer', { playerId: player.id, patch }, { success: 'Player updated' }) : await send('addPlayer', { player: patch }, { success: 'Player added' })
    if (r.ok) onClose()
  }
  const txt = (k: keyof typeof f, label: string, ph = '') => (
    <label className="block">
      <span className="label">{label}</span>
      <input className="input mt-1" value={f[k] as string} placeholder={ph} onChange={(e) => up(k, e.target.value)} />
    </label>
  )
  return (
    <Modal open onClose={onClose} title={player ? `Edit ${player.name}` : 'Add player'} wide>
      <div className="grid sm:grid-cols-2 gap-3">
        {txt('name', 'Name')}
        <label className="block">
          <span className="label">Nationality</span>
          <input className="input mt-1" value={f.nationality} onChange={(e) => setF({ ...f, nationality: e.target.value, overseas: e.target.value.trim().toLowerCase() !== 'india' })} />
        </label>
        <label className="block">
          <span className="label">Primary role</span>
          <select className="input mt-1" value={f.role} onChange={(e) => up('role', e.target.value)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Secondary role</span>
          <select className="input mt-1" value={f.secondaryRole} onChange={(e) => up('secondaryRole', e.target.value)}>
            <option value="">None</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        {txt('battingStyle', 'Batting style', 'Right-hand bat')}
        {txt('bowlingStyle', 'Bowling style', 'Right-arm off-break')}
        <label className="block">
          <span className="label">Base price</span>
          <MoneyInput className="mt-1" value={f.basePrice} onChange={(v) => v !== null && up('basePrice', v)} />
        </label>
        <label className="block">
          <span className="label">Previous franchise (RTM eligibility)</span>
          <select className="input mt-1" value={f.lastTeam} onChange={(e) => up('lastTeam', e.target.value)}>
            <option value="">None</option>
            {TEAM_CODES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        {txt('iplTeams', 'IPL teams represented (comma separated)')}
        {txt('photoUrl', 'Photo URL (https://…)')}
        <label className="block">
          <span className="label">Real-world IPL status</span>
          <select className="input mt-1" value={f.status} onChange={(e) => up('status', e.target.value)}>
            <option value="active">Active</option>
            <option value="inactive">Retired / not active</option>
          </select>
        </label>
        <div className="grid grid-cols-2">
          <Toggle checked={f.overseas} onChange={(v) => up('overseas', v)} label="Overseas" />
          <Toggle checked={f.capped} onChange={(v) => up('capped', v)} label="Capped" />
          <Toggle checked={f.current} onChange={(v) => up('current', v)} label="Current pool" />
          <Toggle checked={f.legend} onChange={(v) => up('legend', v)} label="Legends pool" />
          <Toggle checked={f.marquee} onChange={(v) => up('marquee', v)} label="Marquee" />
        </div>
      </div>
      {player?.stats && <p className="text-xs text-white/40 mt-3">Career statistics come from match data and are not edited here. Custom statistics can be supplied through CSV import.</p>}
      <div className="flex gap-2 justify-end mt-4">
        {player && (
          <button className="btn-danger mr-auto" onClick={() => onRemove(player)}>
            Remove
          </button>
        )}
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-gold" onClick={save} disabled={!f.name.trim() || (!f.current && !f.legend)}>
          {player ? 'Save changes' : 'Add player'}
        </button>
      </div>
    </Modal>
  )
}

function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { send, state } = useRoom()
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [name, setName] = useState('')
  const [addToPool, setAddToPool] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  async function pick(file: File) {
    setName(file.name)
    setResult(null)
    setRows(parseCsv(await file.text()))
  }
  async function go() {
    const r = await send('importPlayers', { rows, addToPool })
    if (r.ok) {
      const d = r.data as { added: number; updated: number }
      setResult(`Imported: ${d.added} added, ${d.updated} updated.`)
      setRows([])
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Import players from CSV">
      <div className="space-y-3 text-sm">
        <p className="text-white/60">
          Required column: <code>name</code>. Optional: nationality, role (BAT/WK/AR/FAST/SPIN), secondary_role, batting_style, bowling_style, base_price (lakh, or “2cr”), capped, overseas, pool (current|legend), status, marquee, ipl_teams (a|b), last_team, photo_url, and
          stats (matches, runs, batting_avg, strike_rate, wickets, economy). Existing players with the same name are updated. The import is all-or-nothing.
        </p>
        <a className="text-gold-400 underline" href="/api/templates/players.csv">
          Download template
        </a>
        <label className="btn-ghost w-full cursor-pointer">
          {name || 'Choose CSV file'}
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
        </label>
        {rows.length > 0 && (
          <div className="rounded-lg bg-white/[0.03] p-3">
            <div>{rows.length} rows found. Columns: {Object.keys(rows[0]).join(', ')}</div>
            <div className="text-white/50 text-xs mt-1">First: {rows[0].name ?? rows[0].Name ?? '(no name column)'}</div>
          </div>
        )}
        {state?.phase === 'lobby' && <Toggle checked={addToPool} onChange={setAddToPool} label="Use imported players as the custom auction pool" />}
        {result && <div className="text-emerald-300">{result}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Close
          </button>
          <button className="btn-gold" disabled={!rows.length} onClick={go}>
            Import {rows.length || ''} players
          </button>
        </div>
        <p className="text-[11px] text-white/35">Base price shown as {formatMoney(30)} means 30 lakh.</p>
      </div>
    </Modal>
  )
}
