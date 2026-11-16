import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { io, type Socket } from 'socket.io-client'
import type { CmdResult, Member, Notice, Player, PublicState, RoomEvent, TeamCode } from '@shared/types'

// ------------------------------------------------------------ sessions (per browser)

export interface SavedSession {
  token: string
  memberId: string
  name: string
  roomName?: string
  savedAt: number
}
const KEY = 'iplwr.sessions'
export function sessions(): Record<string, SavedSession> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
}
export function saveSession(code: string, s: SavedSession) {
  localStorage.setItem(KEY, JSON.stringify({ ...sessions(), [code.toUpperCase()]: s }))
}
export function forgetSession(code: string) {
  const all = sessions()
  delete all[code.toUpperCase()]
  localStorage.setItem(KEY, JSON.stringify(all))
}

export async function api<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `Request failed (${r.status})`)
  return j as T
}

// ------------------------------------------------------------ toasts

export interface Toast extends Notice {
  id: number
  at: number
}

// ------------------------------------------------------------ room context

export interface Gate {
  status: string
  roomName: string
  code: string
  name?: string
}

interface RoomCtx {
  code: string
  token: string
  state: PublicState | null
  library: Record<string, Player>
  players: Player[]
  me: Member | null
  isHost: boolean
  myTeams: TeamCode[]
  connected: boolean
  connError: string | null
  gate: Gate | null
  serverOffset: number
  toasts: Toast[]
  dismiss: (id: number) => void
  toast: (kind: Notice['kind'], text: string) => void
  send: (type: string, payload?: Record<string, unknown>, opts?: { quiet?: boolean; success?: string }) => Promise<CmdResult>
  history: (q?: { before?: number; after?: number; limit?: number; types?: string[] }) => Promise<RoomEvent[]>
}

const Ctx = createContext<RoomCtx | null>(null)

export function useRoom() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useRoom outside RoomProvider')
  return c
}

let toastId = 0

export function RoomProvider({ code, token, children }: { code: string; token: string; children: ReactNode }) {
  const [state, setState] = useState<PublicState | null>(null)
  const [library, setLibrary] = useState<Record<string, Player>>({})
  const [connected, setConnected] = useState(false)
  const [connError, setConnError] = useState<string | null>(null)
  const [gate, setGate] = useState<Gate | null>(null)
  const [serverOffset, setOffset] = useState(0)
  const [toasts, setToasts] = useState<Toast[]>([])
  const sock = useRef<Socket | null>(null)
  const libVersion = useRef(0)

  const toast = useCallback((kind: Notice['kind'], text: string) => {
    const t: Toast = { id: ++toastId, kind, text, at: Date.now() }
    setToasts((x) => [...x.slice(-4), t])
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== t.id)), kind === 'warning' ? 7000 : 4500)
  }, [])

  useEffect(() => {
    const s = io({ auth: { code, token }, transports: ['websocket', 'polling'], reconnectionDelay: 500, reconnectionDelayMax: 4000 })
    sock.current = s
    s.on('connect', () => {
      setConnected(true)
      setConnError(null)
    })
    s.on('disconnect', () => setConnected(false))
    s.on('connect_error', (e) => {
      setConnected(false)
      setConnError(e.message)
    })
    s.on('state', (st: PublicState) => {
      setOffset(st.serverNow - Date.now())
      setGate(null)
      setState(st)
      if (st.libraryVersion !== libVersion.current) s.emit('getLibrary')
    })
    s.on('library', (l: { version: number; players: Player[] }) => {
      libVersion.current = l.version
      setLibrary(Object.fromEntries(l.players.map((p) => [p.id, p])))
    })
    s.on('gate', (g: Gate) => {
      setGate(g)
      setState(null)
    })
    s.on('notice', (n: Notice) => toast(n.kind, n.text))
    return () => {
      s.close()
      sock.current = null
    }
  }, [code, token, toast])

  const send = useCallback<RoomCtx['send']>(
    (type, payload = {}, opts = {}) =>
      new Promise((resolve) => {
        const s = sock.current
        if (!s || !s.connected) {
          if (!opts.quiet) toast('warning', 'Not connected — reconnecting…')
          return resolve({ ok: false, error: 'Not connected' })
        }
        const timer = setTimeout(() => resolve({ ok: false, error: 'No response from server' }), 8000)
        s.emit('cmd', { type, ...payload }, (r: CmdResult) => {
          clearTimeout(timer)
          if (!r.ok && !opts.quiet) toast('warning', r.error)
          if (r.ok && opts.success) toast('success', opts.success)
          resolve(r)
        })
      }),
    [toast],
  )

  const history = useCallback<RoomCtx['history']>(
    (q = {}) =>
      new Promise((resolve, reject) => {
        const s = sock.current
        if (!s) return reject(new Error('Not connected'))
        s.emit('history', q, (r: { ok: boolean; data: RoomEvent[]; error?: string }) => (r.ok ? resolve(r.data) : reject(new Error(r.error))))
      }),
    [],
  )

  const value = useMemo<RoomCtx>(() => {
    const me = state?.you ? state.members[state.you.memberId] ?? null : null
    return {
      code,
      token,
      state,
      library,
      players: Object.values(library),
      me,
      isHost: !!state?.you?.isHost,
      myTeams: me && me.role === 'owner' ? me.teamIds : [],
      connected,
      connError,
      gate,
      serverOffset,
      toasts,
      dismiss: (id) => setToasts((x) => x.filter((t) => t.id !== id)),
      toast,
      send,
      history,
    }
  }, [code, token, state, library, connected, connError, gate, serverOffset, toasts, toast, send, history])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Ticking server-synchronised clock. */
export function useServerNow(intervalMs = 200) {
  const { serverOffset } = useRoom()
  const [now, setNow] = useState(() => Date.now() + serverOffset)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + serverOffset), intervalMs)
    setNow(Date.now() + serverOffset)
    return () => clearInterval(t)
  }, [serverOffset, intervalMs])
  return now
}
