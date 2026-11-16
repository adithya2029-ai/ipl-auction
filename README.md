# IPL Auction War Room

A private, real-time IPL auction platform for a closed group of friends: mega and mini auctions, current players and legends, live bidding, RTM, unsold rounds, trading during and after the auction, transferable host controls, and a permanent ledger.

## Run it

Requires **Node.js 22.13+** (uses the built-in `node:sqlite`; no external database or native build).

```bash
npm install
npm run build        # builds the web client into dist/
npm start            # serves app + API + WebSockets on http://localhost:3000
```

Development (hot reload, web on :5173 proxied to the server on :3000):

```bash
npm run dev
```

Environment variables (all optional):

| Variable  | Default               | Purpose                         |
|-----------|-----------------------|---------------------------------|
| `PORT`    | `3000`                | HTTP / WebSocket port           |
| `DB_FILE` | `./data/war-room.db`  | SQLite database file (persist it) |

### Deploying for your friends

It is a single long-running Node process with one SQLite file, so any host that keeps a process alive and gives you a **persistent disk** works: a small VPS, Railway, Fly.io or Render with a volume. Mount a volume and point `DB_FILE` at it. Put it behind HTTPS (most hosts do this automatically). Serverless platforms (Vercel functions, etc.) are **not** suitable, because the auction timer and WebSocket connections need a persistent server.

Nothing else needs configuring: no API keys, no third-party accounts.

## Why not Supabase?

The spec suggested Next.js + Supabase. I chose a self-contained Node server instead because the hardest requirements are server-authoritative timers and strictly ordered bids:

- Every command for a room is processed **one at a time** in a single process, validated against a draft copy of the state, and written to SQLite in **one transaction** (snapshot + event log) before anyone sees it. Simultaneous bids, duplicate sales and conflicting trades are therefore impossible by construction rather than by locking.
- The countdown lives on the server (`deadline` timestamps), so closing a browser or losing the host never stalls or corrupts a lot.
- With Supabase you would need Postgres functions for every rule, plus a separate scheduler for timers. That is more moving parts for a 10-person private game.

If you later want Postgres, the storage layer is isolated in `src/server/db.ts`.

## Testing

```bash
npm test             # engine unit tests (bidding, limits, undo, trades, RTM, mini seasons)
npm run test:e2e     # 17 multiplayer scenarios over real WebSockets, incl. a server restart mid-lot
npm run build && npm start &   # then:
BASE=http://localhost:3000 npm run test:ui   # browser test: 4 users, desktop/tablet/phone (needs Playwright)
```

The e2e suite covers every scenario in the specification: 10 franchises joining, simultaneous bids, budget and overseas violations, timer expiry, disconnect/reconnect, host transfer during bidding, two unsold rounds, trades during and after the auction, rejection, counteroffer, maximum squad size, reopening, simultaneous trades of the same player, and refresh during bidding. It ends with a global integrity check: no player owned twice, purse + spent conserved, and the history complete.

## Player data

`src/server/data/players.json` holds **360 players**: 261 current (appeared in IPL 2025 or 2026) and 125 legends, with some overlap such as Kohli, Rohit and Narine.

- **Statistics are computed, not typed in.** `scripts/build-players.ts` calculates career and recent-form statistics from Cricsheet ball-by-ball data (IPL 2008–2026), obtained via the MIT-licensed mirror `github.com/ritesh-ojha/IPL-DATASET`. Because the figures come from deliveries, they can differ slightly from official records (for example, all-run fours count as fours).
- **Teams by season, first/last season, current status and RTM franchise** are also derived from match data.
- **Nationality, batting/bowling style, capped status and wicketkeeper flags** are curated in `scripts/player-knowledge.ts`. Overseas tags were validated against the 4-overseas-per-XI rule for 2025–26 with zero violations. Where something could not be verified (12 lesser-known uncapped players), the app shows an "unverified" flag, and roles are inferred from how the player was actually used.
- **Primary roles** are derived from usage (balls bowled and runs per match).
- **Base prices and marquee flags** are app-generated gameplay defaults, not real auction prices. Edit them freely.
- **Photos** link to ESPNcricinfo images for the 127 players in the 2024 details file; everyone else shows initials. Set any photo URL in the editor. The images are third-party content and fine for private use.

To rebuild after a new season, download the three CSVs (`Ball_By_Ball_Match_Data.csv`, `Match_Info.csv`, `2024_players_details.csv`) into a folder and run:

```bash
npm run data:build -- <folder>
```

Each room gets its own editable copy of the database. Hosts can add, edit and remove players, or import them from CSV (template in the app).

## How it fits together

```
src/shared/      types + rules shared by server and client (money in lakh, increments, limits)
src/server/
  engine/        pure, deterministic command handlers (auction, trades, room, undo)
  rooms.ts       per-room runtime: serialises commands, commits, broadcasts, owns timers & presence
  db.ts          SQLite: rooms (snapshot), member_tokens (hashed), events (append-only ledger)
  index.ts       Express REST (create/join/export) + Socket.IO
src/web/         React + Tailwind client (lobby, config, live, teams, players, trades, history, host)
```

Security model: each participant gets a random session token stored in their browser. The server keeps only its SHA-256 hash. Room passwords are hashed with scrypt. Clients only send *intents*: purse, ownership, eligibility and host checks all run on the server, and the client can't forge them.

## Notable rules & behaviours

- **Host transfer** needs the target to accept. It changes only `hostId`: the lot, high bid, timer, purses and history are untouched. If the host is offline longer than a configurable time (default 60s), any approved participant can claim host, and the claim is logged.
- **Purse reserve** (optional): max bid keeps enough purse to fill the minimum squad at a configurable price.
- **Trades** lock their players while pending, re-validate everything on acceptance, never touch money committed to a live bid, and can never include the player under the hammer.
- **Undo** reverses the most recent sale, manual assignment, correction, trade or purse adjustment, and refuses if later events make that unsafe (e.g. the player has since been traded).
- **New season**: after completing an auction, start a mini auction (squads carry over as retentions and the host releases players) or a mega auction (everyone released, RTM to the previous franchise).
- **Server restart** during a live lot reloads from SQLite and gives the lot at least 10 seconds.
