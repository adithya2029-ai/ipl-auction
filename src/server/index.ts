import express from 'express'
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Server } from 'socket.io'
import { Store } from './db'
import { RoomManager, checkPassword, hashToken, loadSeed } from './rooms'
import { exportFile } from './export'

const here = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 3000)
const DB_FILE = process.env.DB_FILE ?? path.resolve(here, '../../data/war-room.db')

export function createServer(opts: { dbFile?: string } = {}) {
  const store = new Store(opts.dbFile ?? DB_FILE)
  const mgr = new RoomManager(store)
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '2mb' }))
  const server = http.createServer(app)
  const io = new Server(server, { maxHttpBufferSize: 4e6, pingInterval: 10000, pingTimeout: 8000 })
  mgr.io = io

  // naive per-IP throttle for room creation / join attempts (password guessing)
  const attempts = new Map<string, { n: number; at: number }>()
  const throttle = (ip: string, max = 20) => {
    const now = Date.now()
    const a = attempts.get(ip)
    if (!a || now - a.at > 60_000) {
      attempts.set(ip, { n: 1, at: now })
      return true
    }
    a.n++
    return a.n <= max
  }
  const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '')

  app.get('/api/health', (_req, res) => res.json({ ok: true }))

  app.get('/api/meta', (_req, res) => {
    const { meta } = loadSeed()
    res.json(meta)
  })

  app.post('/api/rooms', (req, res) => {
    if (!throttle(req.ip ?? '?', 10)) return res.status(429).json({ error: 'Too many attempts; wait a minute' })
    const roomName = clean(req.body?.roomName, 60) || 'IPL Auction War Room'
    const hostName = clean(req.body?.hostName, 30)
    const password = typeof req.body?.password === 'string' ? req.body.password : ''
    if (!hostName) return res.status(400).json({ error: 'Enter your name' })
    if (password && password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' })
    res.json(mgr.create({ roomName, hostName, password }))
  })

  app.get('/api/rooms/:code', (req, res) => {
    const r = mgr.get(req.params.code)
    if (!r) return res.status(404).json({ error: 'Room not found' })
    res.json({ code: r.code, name: r.state.name, requiresPassword: !!r.passwordHash, archived: r.state.archived, spectatorsAllowed: r.state.config.spectatorsAllowed })
  })

  app.post('/api/rooms/:code/join', (req, res) => {
    if (!throttle(req.ip ?? '?')) return res.status(429).json({ error: 'Too many attempts; wait a minute' })
    const r = mgr.get(req.params.code)
    if (!r) return res.status(404).json({ error: 'Room not found' })
    if (r.state.archived) return res.status(403).json({ error: 'This room is archived' })
    const name = clean(req.body?.name, 30)
    if (!name) return res.status(400).json({ error: 'Enter your name' })
    const role = req.body?.role === 'spectator' ? 'spectator' : 'owner'
    if (role === 'spectator' && !r.state.config.spectatorsAllowed) return res.status(403).json({ error: 'Spectators are not allowed in this room' })
    const invite = typeof req.body?.invite === 'string' ? req.body.invite : ''
    const viaInvite = invite && invite === r.inviteKey
    if (r.passwordHash && !viaInvite) {
      const pw = typeof req.body?.password === 'string' ? req.body.password : ''
      if (!pw || !checkPassword(pw, r.passwordHash)) return res.status(403).json({ error: 'Incorrect room password' })
    }
    res.json(r.joinRequest(name, role))
  })

  app.get('/api/rooms/:code/export/:file', (req, res) => {
    const r = mgr.get(req.params.code)
    if (!r) return res.status(404).send('Room not found')
    const tok = store.findToken(hashToken(String(req.query.token ?? '')))
    if (!tok || tok.roomCode !== r.code) return res.status(403).send('Not authorised')
    if (r.state.hostId !== tok.memberId) return res.status(403).send('Only the host can export results')
    const out = exportFile(r.state, store.allEvents(r.code), req.params.file)
    if (!out) return res.status(404).send('Unknown export')
    res.setHeader('Content-Type', out.type)
    res.setHeader('Content-Disposition', `attachment; filename="${r.code}-${req.params.file}"`)
    res.send(out.body)
  })

  app.get('/api/templates/:file', (req, res) => {
    const t: Record<string, string> = {
      'players.csv':
        'name,nationality,role,secondary_role,batting_style,bowling_style,base_price,capped,overseas,pool,status,marquee,ipl_teams,last_team,photo_url,matches,runs,batting_avg,strike_rate,wickets,economy\n' +
        'Example Player,India,AR,FAST,Right-hand bat,Right-arm medium-fast,75,no,no,current,active,no,Mumbai Indians|Delhi Capitals,MI,,,,,,,\n',
      'retentions.csv': 'team,player,price\nMI,Jasprit Bumrah,1800\nCSK,Ruturaj Gaikwad,1800\n',
    }
    const body = t[req.params.file]
    if (!body) return res.status(404).send('Unknown template')
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.file}"`)
    res.send(body)
  })

  io.use((socket, next) => {
    const { code, token } = (socket.handshake.auth ?? {}) as { code?: string; token?: string }
    if (typeof code !== 'string' || typeof token !== 'string') return next(new Error('auth: missing credentials'))
    const r = mgr.get(code)
    if (!r) return next(new Error('auth: room not found'))
    const tok = store.findToken(hashToken(token))
    if (!tok || tok.roomCode !== r.code) return next(new Error('auth: invalid session'))
    const m = r.state.members[tok.memberId]
    if (!m) return next(new Error('auth: invalid session'))
    socket.data.code = r.code
    socket.data.memberId = m.id
    next()
  })
  io.on('connection', (socket) => {
    const r = mgr.get(socket.data.code)
    if (!r) return socket.disconnect(true)
    const m = r.state.members[socket.data.memberId]
    if (m.status === 'banned' || m.status === 'removed' || m.status === 'rejected') {
      socket.emit('gate', { status: m.status, roomName: r.state.name, code: r.code, name: m.name })
      return void setTimeout(() => socket.disconnect(true), 100)
    }
    r.attach(socket, m.id)
  })

  // Static web app
  const dist = path.resolve(here, '../../dist')
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }))
    app.get(/^\/(?!api|socket\.io).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))
  }

  mgr.bootLiveRooms()
  return { app, server, io, mgr, store }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const { server, mgr } = createServer()
  server.listen(PORT, () => console.log(`IPL Auction War Room listening on http://localhost:${PORT}`))
  const stop = () => {
    for (const r of mgr.rooms.values()) r.shutdown()
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 2000).unref()
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}
