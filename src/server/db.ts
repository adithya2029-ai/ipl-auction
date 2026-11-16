import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import type { Player, RoomEvent, RoomState } from '../shared/types'

export interface StoredRoom {
  state: RoomState
  passwordHash: string | null
  inviteKey: string
  lastSeq: number
}

/**
 * Durable storage. Every accepted command is written in ONE SQLite transaction:
 * the new room snapshot + the events it produced. A crash can never leave a
 * half-applied bid, sale or trade on disk.
 */
export class Store {
  db: DatabaseSync

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS rooms (
        code TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        password_hash TEXT,
        invite_key TEXT NOT NULL,
        state_json TEXT NOT NULL,
        library_json TEXT NOT NULL,
        version INTEGER NOT NULL,
        phase TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS member_tokens (
        token_hash TEXT PRIMARY KEY,
        room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
        member_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS member_tokens_room ON member_tokens(room_code);
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        ts INTEGER NOT NULL,
        type TEXT NOT NULL,
        actor TEXT,
        data_json TEXT NOT NULL,
        UNIQUE(room_code, seq)
      );
    `)
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const r = fn()
      this.db.exec('COMMIT')
      return r
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  private split(state: RoomState) {
    const { library, ...rest } = state
    return { stateJson: JSON.stringify(rest), libraryJson: JSON.stringify(library) }
  }

  createRoom(state: RoomState, passwordHash: string | null, inviteKey: string, token: { hash: string; memberId: string }) {
    const { stateJson, libraryJson } = this.split(state)
    this.tx(() => {
      this.db
        .prepare(
          `INSERT INTO rooms (code,name,password_hash,invite_key,state_json,library_json,version,phase,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(state.code, state.name, passwordHash, inviteKey, stateJson, libraryJson, state.version, state.phase, state.createdAt, state.createdAt)
      this.db
        .prepare('INSERT INTO member_tokens (token_hash, room_code, member_id, created_at) VALUES (?,?,?,?)')
        .run(token.hash, state.code, token.memberId, state.createdAt)
    })
  }

  roomExists(code: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM rooms WHERE code = ?').get(code)
  }

  loadRoom(code: string): StoredRoom | null {
    const r = this.db.prepare('SELECT * FROM rooms WHERE code = ?').get(code) as Record<string, string | number | null> | undefined
    if (!r) return null
    const state = JSON.parse(r.state_json as string) as RoomState
    state.library = JSON.parse(r.library_json as string) as Record<string, Player>
    const last = this.db.prepare('SELECT MAX(seq) AS s FROM events WHERE room_code = ?').get(code) as { s: number | null }
    return { state, passwordHash: (r.password_hash as string) ?? null, inviteKey: r.invite_key as string, lastSeq: last.s ?? 0 }
  }

  liveRoomCodes(): string[] {
    return (this.db.prepare("SELECT code FROM rooms WHERE phase = 'live'").all() as { code: string }[]).map((r) => r.code)
  }

  /** Atomically persists a new snapshot and the events that produced it. */
  commit(state: RoomState, libraryChanged: boolean, events: RoomEvent[]) {
    const { stateJson, libraryJson } = this.split(state)
    this.tx(() => {
      if (libraryChanged)
        this.db
          .prepare('UPDATE rooms SET state_json=?, library_json=?, version=?, phase=?, name=?, updated_at=? WHERE code=?')
          .run(stateJson, libraryJson, state.version, state.phase, state.name, Date.now(), state.code)
      else
        this.db
          .prepare('UPDATE rooms SET state_json=?, version=?, phase=?, name=?, updated_at=? WHERE code=?')
          .run(stateJson, state.version, state.phase, state.name, Date.now(), state.code)
      const ins = this.db.prepare('INSERT INTO events (room_code, seq, ts, type, actor, data_json) VALUES (?,?,?,?,?,?)')
      for (const e of events) ins.run(state.code, e.seq, e.ts, e.type, e.actor, JSON.stringify(e.data))
    })
  }

  addMember(state: RoomState, token: { hash: string; memberId: string }, event: RoomEvent) {
    this.tx(() => {
      this.db.prepare('UPDATE rooms SET state_json=?, version=?, updated_at=? WHERE code=?').run(this.split(state).stateJson, state.version, Date.now(), state.code)
      this.db.prepare('INSERT INTO member_tokens (token_hash, room_code, member_id, created_at) VALUES (?,?,?,?)').run(token.hash, state.code, token.memberId, Date.now())
      this.db
        .prepare('INSERT INTO events (room_code, seq, ts, type, actor, data_json) VALUES (?,?,?,?,?,?)')
        .run(state.code, event.seq, event.ts, event.type, event.actor, JSON.stringify(event.data))
    })
  }

  findToken(hash: string): { roomCode: string; memberId: string } | null {
    const r = this.db.prepare('SELECT room_code, member_id FROM member_tokens WHERE token_hash = ?').get(hash) as
      | { room_code: string; member_id: string }
      | undefined
    return r ? { roomCode: r.room_code, memberId: r.member_id } : null
  }

  setPassword(code: string, hash: string | null) {
    this.db.prepare('UPDATE rooms SET password_hash=? WHERE code=?').run(hash, code)
  }

  setInviteKey(code: string, key: string) {
    this.db.prepare('UPDATE rooms SET invite_key=? WHERE code=?').run(key, code)
  }

  events(code: string, opts: { before?: number; after?: number; limit?: number; types?: string[] } = {}): RoomEvent[] {
    const limit = Math.min(Math.max(opts.limit ?? 200, 1), 5000)
    const where = ['room_code = ?']
    const args: (string | number)[] = [code]
    if (opts.before) {
      where.push('seq < ?')
      args.push(opts.before)
    }
    if (opts.after) {
      where.push('seq > ?')
      args.push(opts.after)
    }
    if (opts.types?.length) {
      where.push(`type IN (${opts.types.map(() => '?').join(',')})`)
      args.push(...opts.types)
    }
    const rows = this.db
      .prepare(`SELECT seq, ts, type, actor, data_json FROM events WHERE ${where.join(' AND ')} ORDER BY seq ${opts.after ? 'ASC' : 'DESC'} LIMIT ${limit}`)
      .all(...args) as { seq: number; ts: number; type: string; actor: string | null; data_json: string }[]
    return rows.map((r) => ({ seq: r.seq, ts: r.ts, type: r.type, actor: r.actor, data: JSON.parse(r.data_json) }))
  }

  allEvents(code: string): RoomEvent[] {
    const rows = this.db.prepare('SELECT seq, ts, type, actor, data_json FROM events WHERE room_code = ? ORDER BY seq ASC').all(code) as {
      seq: number
      ts: number
      type: string
      actor: string | null
      data_json: string
    }[]
    return rows.map((r) => ({ seq: r.seq, ts: r.ts, type: r.type, actor: r.actor, data: JSON.parse(r.data_json) }))
  }

  deleteRoom(code: string) {
    this.tx(() => {
      this.db.prepare('DELETE FROM events WHERE room_code = ?').run(code)
      this.db.prepare('DELETE FROM member_tokens WHERE room_code = ?').run(code)
      this.db.prepare('DELETE FROM rooms WHERE code = ?').run(code)
    })
  }
}
