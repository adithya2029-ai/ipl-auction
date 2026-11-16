import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Server, Socket } from 'socket.io'
import type { CmdResult, Member, Player, RoomEvent, RoomState } from '../shared/types'
import { applyCommand, CmdError, type Command, createRoomState, publicState } from './engine'
import type { Store } from './db'

const here = path.dirname(fileURLToPath(import.meta.url))
let seedLibrary: Record<string, Player> | null = null
export function loadSeed(): { players: Player[]; meta: Record<string, unknown> } {
  return JSON.parse(fs.readFileSync(path.join(here, 'data', 'players.json'), 'utf8'))
}
function seed(): Record<string, Player> {
  if (!seedLibrary) seedLibrary = Object.fromEntries(loadSeed().players.map((p) => [p.id, p]))
  return structuredClone(seedLibrary)
}

export const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex')
export const newToken = () => crypto.randomBytes(24).toString('base64url')
const newId = () => crypto.randomBytes(9).toString('base64url')

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16)
  const key = crypto.scryptSync(pw, salt, 32)
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`
}
export function checkPassword(pw: string, stored: string): boolean {
  const [, saltHex, keyHex] = stored.split('$')
  const key = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 32)
  return crypto.timingSafeEqual(key, Buffer.from(keyHex, 'hex'))
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function randomCode(len = 6) {
  const bytes = crypto.randomBytes(len)
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
}

interface Conn {
  socket: Socket
  memberId: string
  bucket: number
  bucketAt: number
}

export class Room {
  state: RoomState
  passwordHash: string | null
  inviteKey: string
  seq: number
  conns = new Map<string, Conn>()
  timer: NodeJS.Timeout | null = null
  hostOfflineSince: number | null
  deleted = false

  constructor(
    public mgr: RoomManager,
    stored: { state: RoomState; passwordHash: string | null; inviteKey: string; lastSeq: number },
  ) {
    this.state = stored.state
    this.passwordHash = stored.passwordHash
    this.inviteKey = stored.inviteKey
    this.seq = stored.lastSeq
    this.hostOfflineSince = Date.now()
  }

  get code() {
    return this.state.code
  }

  online(): Set<string> {
    return new Set([...this.conns.values()].map((c) => c.memberId))
  }

  /** Server-authoritative command processing: validate on a draft, commit atomically, then broadcast. */
  dispatch(actorId: string | null, cmd: Command): CmdResult {
    if (this.deleted) return { ok: false, error: 'Room deleted' }
    const now = Date.now()
    const { library, ...rest } = this.state
    const draft = structuredClone(rest) as RoomState
    draft.library = library // copy-on-write: the engine never mutates library objects in place
    let res
    try {
      res = applyCommand(draft, cmd, {
        now,
        actorId,
        online: this.online(),
        hostOfflineSince: this.online().has(this.state.hostId) ? null : this.hostOfflineSince,
        random: Math.random,
        id: newId,
      })
    } catch (e) {
      if (e instanceof CmdError) return { ok: false, error: e.message }
      console.error('command crashed', cmd.type, e)
      return { ok: false, error: 'Internal error; nothing was changed' }
    }
    const { fx, data } = res
    if (cmd.type === '__tick' && fx.events.length === 0 && JSON.stringify(draft.current) === JSON.stringify(this.state.current))
      return { ok: true }
    draft.version = this.state.version + 1
    const events: RoomEvent[] = fx.events.map((e) => ({ seq: ++this.seq, ts: now, type: e.type, actor: actorId, data: e.data }))
    try {
      this.mgr.store.commit(draft, fx.libraryChanged, events)
    } catch (e) {
      this.seq -= events.length
      console.error('persist failed', e)
      return { ok: false, error: 'Could not save; nothing was changed' }
    }
    const hostChanged = draft.hostId !== this.state.hostId
    this.state = draft
    if (hostChanged) this.hostOfflineSince = this.online().has(draft.hostId) ? null : now
    this.schedule()
    for (const id of fx.kick) this.kick(id)
    this.broadcast()
    if (fx.libraryChanged) for (const c of this.conns.values()) this.sendLibrary(c.socket, c.memberId)
    for (const n of fx.notices) {
      for (const c of this.conns.values()) {
        if (n.to && !n.to.includes(c.memberId)) continue
        if (this.state.members[c.memberId]?.status !== 'approved') continue
        c.socket.emit('notice', n)
      }
    }
    return { ok: true, data }
  }

  schedule() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const s = this.state
    if (s.phase !== 'live' || s.paused || s.archived || this.deleted) return
    const at = s.current?.deadline ?? (s.current ? null : s.autoNextAt)
    if (at === null || at === undefined) return
    const delay = Math.max(0, at - Date.now())
    this.timer = setTimeout(() => {
      this.timer = null
      const r = this.dispatch(null, { type: '__tick' })
      if (!r.ok) console.error('tick failed', r.error)
      // if nothing changed (clock skew), re-arm
      if (!this.timer) this.schedule()
    }, delay + 5)
  }

  view(memberId: string) {
    const m = this.state.members[memberId]
    if (!m || m.status !== 'approved') return null
    return publicState(this.state, memberId, [...this.online()], Date.now(), this.hostOfflineSince ?? Date.now())
  }

  sendTo(c: Conn) {
    const m = this.state.members[c.memberId]
    if (!m) return
    if (m.status !== 'approved') {
      c.socket.emit('gate', { status: m.status, roomName: this.state.name, code: this.code, name: m.name })
      return
    }
    c.socket.emit('state', this.view(c.memberId))
  }

  broadcast() {
    for (const c of this.conns.values()) this.sendTo(c)
  }

  sendLibrary(socket: Socket, memberId: string) {
    if (this.state.members[memberId]?.status !== 'approved') return
    socket.emit('library', { version: this.state.libraryVersion, players: Object.values(this.state.library) })
  }

  kick(memberId: string) {
    for (const [sid, c] of this.conns)
      if (c.memberId === memberId) {
        this.sendTo(c)
        c.socket.disconnect(true)
        this.conns.delete(sid)
      }
  }

  touch(memberId: string) {
    const m = this.state.members[memberId]
    if (!m) return
    m.lastSeenAt = Date.now()
  }

  attach(socket: Socket, memberId: string) {
    const conn: Conn = { socket, memberId, bucket: 30, bucketAt: Date.now() }
    this.conns.set(socket.id, conn)
    this.touch(memberId)
    if (memberId === this.state.hostId) this.hostOfflineSince = null
    this.sendTo(conn)
    this.sendLibrary(socket, memberId)
    this.broadcastPresence()

    socket.on('cmd', (cmd: unknown, ack?: (r: CmdResult) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {}
      if (!this.rateOk(conn)) return reply({ ok: false, error: 'Too many requests; slow down' })
      if (!cmd || typeof cmd !== 'object' || typeof (cmd as Command).type !== 'string' || (cmd as Command).type.startsWith('__'))
        return reply({ ok: false, error: 'Invalid command' })
      const c = cmd as Command
      if (RUNTIME_CMDS[c.type]) return reply(RUNTIME_CMDS[c.type](this, memberId, c))
      reply(this.dispatch(memberId, c))
    })
    socket.on('history', (q: { before?: number; after?: number; limit?: number; types?: string[] } | undefined, ack?: (r: unknown) => void) => {
      if (typeof ack !== 'function') return
      if (this.state.members[memberId]?.status !== 'approved') return ack({ ok: false, error: 'Not approved' })
      ack({ ok: true, data: this.mgr.store.events(this.code, q ?? {}) })
    })
    socket.on('getLibrary', () => this.sendLibrary(socket, memberId))
    socket.on('disconnect', () => {
      this.conns.delete(socket.id)
      this.touch(memberId)
      if (memberId === this.state.hostId && !this.online().has(memberId)) this.hostOfflineSince = Date.now()
      this.broadcastPresence()
    })
  }

  private presenceTimer: NodeJS.Timeout | null = null
  broadcastPresence() {
    // coalesce bursts of connects/disconnects
    if (this.presenceTimer) return
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null
      this.broadcast()
    }, 150)
  }

  private rateOk(c: Conn) {
    const now = Date.now()
    c.bucket = Math.min(30, c.bucket + ((now - c.bucketAt) / 1000) * 15)
    c.bucketAt = now
    if (c.bucket < 1) return false
    c.bucket -= 1
    return true
  }

  joinRequest(name: string, role: 'owner' | 'spectator'): { token: string; memberId: string } {
    const now = Date.now()
    const member: Member = { id: newId(), name, role, status: 'pending', teamIds: [], joinedAt: now, lastSeenAt: now }
    const token = newToken()
    const draft = { ...this.state, members: { ...this.state.members, [member.id]: member }, version: this.state.version + 1 }
    const event: RoomEvent = { seq: this.seq + 1, ts: now, type: 'join_requested', actor: member.id, data: { memberId: member.id, name, role } }
    this.mgr.store.addMember(draft, { hash: hashToken(token), memberId: member.id }, event)
    this.seq++
    this.state = draft
    this.broadcast()
    const hostConns = [...this.conns.values()].filter((c) => c.memberId === this.state.hostId)
    for (const c of hostConns) c.socket.emit('notice', { kind: 'host', text: `${name} wants to join as ${role === 'owner' ? 'a franchise owner' : 'a spectator'}` })
    return { token, memberId: member.id }
  }

  shutdown() {
    if (this.timer) clearTimeout(this.timer)
    for (const c of this.conns.values()) c.socket.disconnect(true)
    this.conns.clear()
  }
}

type RuntimeCmd = (room: Room, memberId: string, c: Command) => CmdResult
const RUNTIME_CMDS: Record<string, RuntimeCmd> = {
  setPassword(room, memberId, c) {
    if (room.state.hostId !== memberId) return { ok: false, error: 'Only the host can do that' }
    const pw = typeof c.password === 'string' ? c.password : ''
    if (pw && pw.length < 4) return { ok: false, error: 'Use at least 4 characters' }
    room.passwordHash = pw ? hashPassword(pw) : null
    room.mgr.store.setPassword(room.code, room.passwordHash)
    return { ok: true }
  },
  getInvite(room, memberId) {
    if (room.state.hostId !== memberId) return { ok: false, error: 'Only the host can do that' }
    return { ok: true, data: { inviteKey: room.inviteKey, hasPassword: !!room.passwordHash } }
  },
  regenerateInvite(room, memberId) {
    if (room.state.hostId !== memberId) return { ok: false, error: 'Only the host can do that' }
    room.inviteKey = newToken().slice(0, 12)
    room.mgr.store.setInviteKey(room.code, room.inviteKey)
    return { ok: true, data: { inviteKey: room.inviteKey } }
  },
  deleteRoom(room, memberId, c) {
    if (room.state.hostId !== memberId) return { ok: false, error: 'Only the host can do that' }
    if (c.confirm !== room.code) return { ok: false, error: 'Type the room code to confirm deletion' }
    room.mgr.delete(room.code)
    return { ok: true }
  },
}

export class RoomManager {
  rooms = new Map<string, Room>()
  io: Server | null = null
  constructor(public store: Store) {}

  get(code: string): Room | null {
    const c = code.toUpperCase()
    let r = this.rooms.get(c)
    if (r) return r
    const stored = this.store.loadRoom(c)
    if (!stored) return null
    r = new Room(this, stored)
    this.rooms.set(c, r)
    this.recover(r)
    return r
  }

  /** After a restart, give a live lot a fair amount of time instead of expiring it instantly. */
  private recover(r: Room) {
    const s = r.state
    if (s.phase === 'live' && s.current && !s.paused && s.current.deadline !== null) {
      const min = Date.now() + 10_000
      if (s.current.deadline < min) {
        s.current.deadline = min
        this.store.commit(s, false, [])
      }
    }
    if (s.phase === 'live' && s.autoNextAt !== null && s.autoNextAt < Date.now()) s.autoNextAt = Date.now() + 5000
    r.schedule()
  }

  bootLiveRooms() {
    for (const code of this.store.liveRoomCodes()) this.get(code)
  }

  create(p: { roomName: string; hostName: string; password?: string }): { code: string; token: string; memberId: string } {
    let code = randomCode()
    while (this.store.roomExists(code)) code = randomCode()
    const now = Date.now()
    const host: Member = { id: newId(), name: p.hostName, role: 'owner', status: 'approved', teamIds: [], joinedAt: now, lastSeenAt: now }
    const state = createRoomState({ code, name: p.roomName, host, library: seed(), now })
    const token = newToken()
    this.store.createRoom(state, p.password ? hashPassword(p.password) : null, newToken().slice(0, 12), { hash: hashToken(token), memberId: host.id })
    this.get(code)
    return { code, token, memberId: host.id }
  }

  delete(code: string) {
    const r = this.rooms.get(code)
    if (r) {
      r.deleted = true
      for (const c of r.conns.values()) c.socket.emit('gate', { status: 'deleted', roomName: r.state.name, code })
      r.shutdown()
    }
    this.rooms.delete(code)
    this.store.deleteRoom(code)
  }
}
