# Cloud Yatra

A 2D browser platformer that doubles as a live full-stack observability demo. You play
Yatri, a Nepali traveller crossing the fictional cloud-kingdom of Himal Rajya, climbing from
the Terai lowland jungle through the middle hills to the Himalayan summit.

Playing the game produces real telemetry. That telemetry flows through a backend and into a
Grafana Cloud dashboard that updates in near-real-time, so you can watch the system respond
to actual traffic. All art and audio are original and generated in code; there are no
external asset files.

**Live demo:** [cloud-yatra.pages.dev](https://cloud-yatra.pages.dev). Play with a keyboard
on desktop or with on-screen touch controls on a phone or tablet (use landscape).

## Contents

- [Gameplay](#gameplay)
- [Controls](#controls)
- [Architecture](#architecture)
- [Project layout](#project-layout)
- [Running locally](#running-locally)
- [Observability](#observability)
- [Configuration](#configuration)
- [Originality and cultural respect](#originality-and-cultural-respect)

## Gameplay

- Run, jump, and swing a *khukuri* to cut through trail obstacles (thorns, bamboo, nettle,
  thatch-grass, creeper vines). Yatri can double-jump to reach higher platforms.
- Collect region-specific flowers (Terai marigold, hill rhododendron / *lali gurans*, Himal
  blue poppy). Every 12 blooms completes a garland worth one extra life.
- Prayer bells are rare and each grants one extra life.
- Plant the pennant at checkpoints to set your respawn point and bank your score.
- Hazards are predictable and learnable: drifting mist, swooping eagles, falling rocks, and a
  jungle monkey. Difficulty increases region by region toward the summit.
- Guru Megh, a cloud-sage guide, offers short in-character hints at key moments using
  built-in lines in the browser (no external AI service).

## Controls

| Action | Desktop | Touch |
| --- | --- | --- |
| Move | Arrow keys or `A` / `D` | On-screen D-pad |
| Jump / double-jump | `↑`, `W`, or Space (press again mid-air) | Jump button (tap again mid-air) |
| Khukuri | `F` or `J` | Khukuri button |

On-screen controls appear automatically on touch devices, and the game fills the screen. In
portrait orientation the game shows a prompt to rotate to landscape.

## Architecture

Cloud Yatra is split into three independent pieces: a static frontend, an optional backend,
and the Grafana Cloud dashboards. The game runs fully on its own; the backend and dashboards
add the shared leaderboard and the live observability view.

```
Browser (Phaser game, Cloudflare Pages)            Cloudflare Worker (cloud-yatra-api)
───────────────────────────────────────            ───────────────────────────────────
 Grafana Faro Web SDK                                Per request:
  • Core Web Vitals, JS errors, sessions              • Prometheus metrics  (/metrics)
  • custom gameplay events  ───────► Faro             • structured JSON log  ───────► Loki
                                      │               • OTLP trace span      ───────► Tempo
                                      ▼               • Cloudflare D1 (SQLite)
                                Grafana Cloud  ◄── Infinity ◄── /stats, /leaderboard, /session
                                      │
                       Dashboards (versioned JSON) + SLOs + alert rules
```

The project covers the four telemetry signals plus reliability tooling:

| Signal | Source | Implementation |
| --- | --- | --- |
| Metrics | Worker `/metrics` | Prometheus counters and a request-duration histogram (RED method, p50/p90/p99 via `histogram_quantile`) |
| Logs | Worker → Loki | One structured JSON log per request, each with a `correlationId` |
| Traces | Worker → Tempo | A per-request OTLP span; latency buckets carry trace exemplars |
| RUM | Browser → Faro | Web vitals, JS errors, sessions, custom gameplay events, sampled FPS |
| Analytics | D1 → Infinity | Leaderboard, progression funnel, per-player stats, country geomap |
| Reliability | Prometheus + dashboard | Availability and latency SLOs, error-budget burn, and alert rules |

Labels are deliberately low-cardinality (`route`, `status_class`, `type`, `cause`, region).
There is no PII: sessions are anonymous, `session_id` is only ever a log/trace field (never a
metric label), and only a coarse edge country is recorded.

## Project layout

```
cloud-yatra/
├── game/                  Frontend — Phaser 3 + TypeScript + Vite (static client)
│   ├── index.html         Page shell (responsive container, canvas, dashboard link)
│   └── src/
│       ├── main.ts        Phaser bootstrap: scenes, scale, physics, Faro, chaos panel
│       ├── config/        Constants, level data, player tuning, scoring
│       ├── scenes/        Boot, Menu, HimalRajya (gameplay), Leaderboard
│       ├── entities/      Yatri, hazards, collectibles, checkpoints
│       ├── ui/            HUD, Guru Megh dialogue, touch controls
│       ├── audio/         Original procedural music and sound effects
│       └── telemetry/     Event schema, sinks (console/Faro/HTTP), backend + chaos client
│
├── backend/               Optional backend — Cloudflare Worker + D1
│   ├── migrations/        D1 schema (events, sessions, scores, daily_rollup)
│   └── src/               Router, DB, event validation, metrics, logger, CORS, chaos
│
├── observability/         Grafana Cloud assets
│   ├── dashboards/        Observatory source (full) + generated public copy JSON
│   └── grafana-alerts.yaml  Importable Grafana-managed alert rules
│
└── .github/workflows/     CI/CD — deploy Pages and the Worker from main
```

## Running locally

Requires Node.js 20 or newer.

### Frontend

```bash
cd game
npm install
npm run dev        # http://localhost:5173
```

Other scripts, run in `game/`:

```bash
npm run build      # type-check and build to dist/
npm run typecheck  # tsc --noEmit
npm test           # vitest
```

### Backend (optional)

The game is fully playable without the backend. To run it locally:

```bash
cd backend
npm install
npm test                    # vitest in the workerd runtime with in-memory D1
npx wrangler dev --local    # local Worker + local SQLite
```

Routes:

- `GET` — `/healthz`, `/metrics`, `/stats`, `/leaderboard`, `/session`, `/chaos/status`,
  `/chaos/events`
- `POST` — `/event`, `/events`, `/score`, `/chaos/start`, `/chaos/stop`

See `backend/wrangler.toml` for the D1 binding and the optional Grafana push and Chaos Mode
secrets. Secrets are set with `wrangler secret put` and are never committed.

## Observability

There is one canonical dashboard, kept in two forms:

- `observability/dashboards/cloud-yatra-observatory.json` — the **source** dashboard
  (authenticated import). Rich, every signal, with the game embedded in a **Video panel**
  (`innius-video-panel`) at the top and a per-session "your run" row. Import it and map five
  data sources: Faro/Loki (RUM), Prometheus (Worker `/metrics`), Loki (backend logs), Tempo
  (traces), and Infinity (D1 analytics). Install the Video panel from **Administration →
  Plugins and data → Plugins** (search "Video" by innius) so the game-in-dashboard panel
  renders.
- `observability/dashboards/cloud-yatra-observatory-public.json` — the **public** copy,
  generated from the source by `observability/build-dashboard.mjs`. No template variables
  (public dashboards can't use them), datasource refs wired to this stack's names, URLs
  hardcoded. This is the one shared externally (Share → Share externally) and embedded below
  the game. Regenerate with `node observability/build-dashboard.mjs` after editing the
  source. Rows: Live Now, SLOs & error budget, Backend, Logs & Traces, Player Experience,
  Game Performance, Yatri's Journey, Scores, World, Chaos.

The public dashboard is embedded **inline below the game** on the standalone page. Grafana
Cloud sends CSP `frame-ancestors 'none'`, so the dashboard can't be iframed on another
origin directly; the Cloudflare Worker reverse-proxies it under `/dash` + the Grafana SPA
paths (`/api`, `/public`, `/public-dashboards`, `/bootdata`, …) from its own origin, with
the frame-blocking headers stripped, so the iframe renders. Per-player "your run" stats live
in the game itself (the page knows the session); public dashboards can't filter per viewer.

`observability/grafana-alerts.yaml` holds importable Grafana-managed alert rules; set your
Prometheus data source UID before importing.

Backend logs (Loki) and traces (Tempo) ship only when their push secrets are set. Set the
`GRAFANA_LOKI_*` and `GRAFANA_OTLP_*` secrets (see [Configuration](#configuration)) to enable
them.

### Chaos Mode

Chaos Mode is an admin-only, self-contained fault injector built into the Worker. Set the
`CHAOS_ADMIN_TOKEN` secret, then in the running game press `Shift+C`, enter the token, and
start a roughly 60-second window. The Worker adds latency and a fraction of synthetic `503`s
to the gameplay routes only — never to health, metrics, control, or any external service. The
dashboard's chaos row and a red annotation react, the "Chaos Mode active" alert fires and
then resolves, and Guru Megh narrates the storm and its clearing. With no token set, the
control plane is disabled.

## Configuration

All client configuration is public, set through Vite environment variables. There are no
secrets in the client. Copy `game/.env.example` to `game/.env` to connect a backend.

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | Deployed Cloudflare Worker: telemetry ingest and the shared D1 leaderboard. Leave empty to run offline with a local leaderboard. |
| `VITE_FARO_URL`, `VITE_FARO_APP_KEY` | Grafana Faro RUM collector (optional). |
| `VITE_GRAFANA_GRAND_URL` | Grafana grand-dashboard URL the "Open the live Grafana dashboard" button links to below the game — the game-in-dashboard view (optional). |
| `VITE_GRAFANA_DASHBOARD_URL` | Fallback dashboard URL for that button when `VITE_GRAFANA_GRAND_URL` is unset, e.g. a public-dashboard URL (optional). |

With none of these set, the game still plays fully: telemetry logs to the console in
development, the leaderboard uses local browser storage, and Guru Megh uses built-in lines.

## Originality and cultural respect

All art and audio are original and generated in code. Cultural and national symbols — the
*gunyu-cholo*, *dhaka topi*, *khukuri*, prayer flags, the Nepal flag, and *mani* stones — are
used respectfully and are never hazards. The background music is an original composition and
is not Nepal's national anthem.
