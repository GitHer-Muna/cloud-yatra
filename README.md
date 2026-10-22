# Cloud Yatra

An original 2D browser platformer built to generate **real, live telemetry** for a
Grafana observability story. You play **Yatri**, a Nepali traveller crossing the fictional
cloud-kingdom **Himal Rajya** — climbing from the Terai lowland jungle, through the middle
hills, to the Himalayan summit.

The game is the vehicle; the point is the full-stack observability pipeline it feeds
(game → telemetry → backend → dashboard). Everything (art, audio) is original and
drawn/synthesised in code — no external asset files.

> **Live demo:** [cloud-yatra.pages.dev](https://cloud-yatra.pages.dev) — a free static
> site on Cloudflare Pages. Play with a keyboard on desktop, or with on-screen touch
> controls on a phone/tablet (rotate to **landscape** for the best experience).

## Gameplay

- **Move / jump / slash** — run, jump, and swing a *khukuri* to cut through trail obstacles
  (thorns, bamboo, nettle, thatch-grass, creeper vines).
- **Collect** region-true flowers (Terai marigold, hill rhododendron / *lali gurans*, Himal
  blue poppy). Every 12 blooms completes a *garland* worth **+1 life**.
- **Prayer bells** are rare blessings — each grants **+1 life**.
- **Plant the pennant** at checkpoints (Nepal-flag-shaped) to set your respawn and score.
- **Hazards** are predictable and learnable: drifting mist, swooping eagles, falling rocks,
  a jungle monkey. The difficulty tightens region by region toward the summit.
- **Guru Megh**, a cloud-sage guide, encourages and guides you throughout the journey
  (uses original built-in guidance lines in the browser).
- **Chaos Mode** (optional, admin-only): a hidden operator control that makes the project's
  *own* backend inject ~60s of latency/errors, so you can watch the Grafana dashboard react
  and recover live. It never touches any external service and is off unless an admin arms it.

## Tech

- **Frontend:** [Phaser 3](https://phaser.io/) + TypeScript, built with [Vite](https://vitejs.dev/).
- **Hosting:** [Cloudflare Pages](https://pages.cloudflare.com/) — a 100% static build,
  free with unlimited bandwidth, auto-deployed from `main` via GitHub Actions.
- **Backend (optional):** a separate [Cloudflare Worker](https://workers.cloudflare.com/)
  (`backend/`) backed by [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite)
  for telemetry ingest + a shared cross-player leaderboard. Free-tier only. The game plays
  fully without it (local leaderboard + offline fallbacks) when `VITE_API_BASE_URL` is empty.
- **Telemetry:** a small event schema + swappable sinks (console in dev, Grafana **Faro**
  RUM in the browser, and an HTTP batch sink to the Worker) — see `src/telemetry/`.
- **Observability:** custom gameplay events + browser RUM (web vitals, errors, resource
  timing) + sampled FPS → **Grafana Cloud** via Faro, **plus** backend request metrics
  (Prometheus), structured logs (Loki), and traces (Tempo) from the Worker, and D1-derived
  gameplay analytics — all in one live dashboard.

## Responsive & mobile

- **Desktop:** keyboard — arrows/WASD to move, up/space to jump, `F`/`J` for the khukuri.
- **Phone / tablet:** on-screen touch controls (D-pad + jump + khukuri) appear automatically
  on touch devices; the game fills the screen. In portrait it shows a *rotate to landscape*
  prompt, since this is a landscape platformer.

## Project layout

```
cloud-yatra/
├── game/                     # Frontend — Phaser 3 + TypeScript + Vite (static, 100% client)
│   ├── index.html            #   Page shell (responsive container, canvas, optional embed)
│   └── src/
│       ├── main.ts           #   Phaser bootstrap (scenes, scale, physics) + Faro + chaos panel
│       ├── config/           #   constants, level data, player tuning, scoring
│       ├── scenes/           #   Boot, Menu, HimalRajya (gameplay), Leaderboard
│       ├── entities/         #   Yatri, hazards (Eagle, Monkey, MistWisp, Rockfall),
│       │                     #     collectibles (RhododendronBloom, PrayerBell), Checkpoint, …
│       ├── ui/               #   Hud, GuruMegh dialogue, TouchControls
│       ├── audio/            #   NepaliAudio — original procedural music + SFX
│       └── telemetry/        #   event schema, service, sinks (console/Faro/HTTP), Faro init,
│                             #     backend + chaos client, local leaderboard, Guru Megh lines
│
├── backend/                  # Optional backend — Cloudflare Worker + D1 (SQLite)
│   ├── migrations/           #   D1 schema (events, sessions, scores, daily_rollup)
│   └── src/                  #   index (router), db, events (validation), metrics (Prometheus),
│                             #     logger (JSON + Loki/OTLP push), cors, chaos, env
│
├── observability/            # Grafana Cloud assets
│   └── dashboards/           #   cloud-yatra-grand-observatory.json (full-stack, import-ready)
│   └── grafana-alerts.json   #   recommended alert rules (set your Faro app_id)
│
└── .github/workflows/        # CI/CD: deploy Pages (game/**) and Worker (backend/**) from main
```

## Run it locally

Requires Node.js 20+.

### Frontend (the game)

```bash
cd game
npm install
npm run dev        # http://localhost:5173
```

Other scripts (run in `game/`):

```bash
npm run build      # type-check + production build to dist/
npm run typecheck  # tsc --noEmit
npm test           # vitest (pure game/telemetry logic)
```

### Backend (optional — Cloudflare Worker + D1)

The game is fully playable without it. To run the backend locally:

```bash
cd backend
npm install
npm test                      # vitest in the real workerd runtime (in-memory D1)
npx wrangler dev --local      # local Worker + local SQLite
```

Routes: `GET /healthz /metrics /stats /leaderboard /chaos/status /chaos/events`,
`POST /event /events /score /chaos/start /chaos/stop`. See `backend/wrangler.toml` for the
D1 binding and the optional Grafana push / Chaos Mode secrets (all set via
`wrangler secret put`, never committed).

## Observability (Grafana Cloud)

Import `observability/dashboards/cloud-yatra-grand-observatory.json` and map its five data
sources — Faro Loki (RUM), backend Loki (logs), Prometheus (Worker `/metrics`), Tempo
(traces), and the Infinity plugin (D1 analytics via the Worker's JSON endpoints).
`grafana-alerts.json` holds recommended alert rules — set your Faro `app_id` first.

### Chaos Mode (the "watch it react" demo)

Chaos Mode is an admin-gated, self-only fault injector in the Worker. Set the
`CHAOS_ADMIN_TOKEN` secret (`cd backend && npx wrangler secret put CHAOS_ADMIN_TOKEN`), then
in the running game press **Shift+C**, enter the token, and start a ~60s window. The Worker
adds latency + synthetic `503`s to the gameplay routes only (never health/metrics/control or
any external service), the dashboard's CHAOS row + a red annotation react, and Guru Megh
narrates the "storm" and its clearing. With no token set, the control plane is disabled.

## Configuration

All configuration is **public** client config via Vite env vars — there are no secrets in
the client. Copy `game/.env.example` to `game/.env` to connect a backend:

| Variable | Purpose |
|----------|---------|
| `VITE_API_BASE_URL` | Deployed Cloudflare Worker (`backend/`): telemetry ingest + shared D1 leaderboard. Empty = offline (local board). |
| `VITE_FARO_URL` / `VITE_FARO_APP_KEY` | Grafana Faro RUM collector (optional). |
| `VITE_GRAFANA_DASHBOARD_URL` | Public Grafana dashboard/share URL embedded below the game (optional). |

With none set, the game still plays fully: telemetry logs to the console (dev only), the
leaderboard uses a local browser-stored board, and Guru Megh uses built-in lines.

## Originality & cultural respect

All art and audio are 100% original, generated in code. Cultural and national symbols
(*daura suruwal / gunyu-cholo*, *dhaka topi*, *khukuri*, prayer flags, the Nepal flag,
*mani* stones) are used respectfully and are never hazards. The background music is an
original composition — **not** Nepal's national anthem.
