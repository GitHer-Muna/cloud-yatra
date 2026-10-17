# Cloud Yatra

An original 2D browser platformer built to generate **real, live telemetry** for a
Grafana observability story. You play **Yatri**, a Nepali traveller crossing the fictional
cloud-kingdom **Himal Rajya** — climbing from the Terai lowland jungle, through the middle
hills, to the Himalayan summit.

The game is the vehicle; the point is the full-stack observability pipeline it feeds
(game → telemetry → dashboard → AI). Everything (art, audio) is original and drawn/synthesised
in code — no external asset files.

> **Live demo:** hosted as a static site on Amazon S3. Play with a keyboard on desktop, or
> with the on-screen touch controls on a phone/tablet.

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
  (powered by Amazon Bedrock when a backend is configured; otherwise built-in lines).

## Tech

- **Frontend:** [Phaser 3](https://phaser.io/) + TypeScript, built with [Vite](https://vitejs.dev/).
- **Telemetry:** a small event schema + swappable sinks (console in dev, HTTP batch to the
  backend, and Grafana Faro RUM) — see `src/telemetry/`.
- **Backend (optional):** API Gateway → Lambda (Node 20) → DynamoDB, for the leaderboard,
  telemetry ingest, and the Bedrock-backed Guru Megh. The game runs fully without it.
- **Observability:** custom game events + AWS metrics + Faro RUM → Grafana Cloud.

## Project layout

```
game/
├── index.html            # Page shell (responsive container, canvas)
├── src/
│   ├── main.ts           # Phaser bootstrap (scenes, scale, physics)
│   ├── config/           # constants, level data, player tuning, scoring
│   ├── scenes/           # Boot, Menu, HimalRajya (gameplay), Leaderboard
│   ├── entities/         # Yatri, hazards (Eagle, Monkey, MistWisp, Rockfall),
│   │                     #   collectibles (RhododendronBloom, PrayerBell), Checkpoint, …
│   ├── ui/               # Hud, GuruMegh dialogue, TouchControls
│   ├── audio/            # NepaliAudio — original procedural music + SFX
│   └── telemetry/        # event schema, service, sinks, leaderboard & oracle clients
```

## Run it locally

Requires Node.js 20+.

```bash
cd game
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

```bash
npm run build      # type-check + production build to dist/
npm run typecheck  # tsc --noEmit
npm test           # vitest (pure game/telemetry logic)
```

## Configuration

All configuration is **public** client config via Vite env vars — there are no secrets in
the client. Copy `game/.env.example` to `game/.env` to connect a backend:

| Variable | Purpose |
|----------|---------|
| `VITE_API_BASE_URL` | Deployed HTTP API: backend telemetry, Guru Megh (`/oracle`), shared leaderboard. |
| `VITE_FARO_URL` / `VITE_FARO_APP_KEY` | Grafana Faro RUM collector (optional). |

With none set, the game still plays fully: telemetry logs to the console (dev only), the
leaderboard uses a local browser-stored board, and Guru Megh uses built-in lines.

## Originality & cultural respect

All art and audio are 100% original, generated in code. Cultural and national symbols
(*daura suruwal / gunyu-cholo*, *dhaka topi*, *khukuri*, prayer flags, the Nepal flag,
*mani* stones) are used respectfully and are never hazards. The background music is an
original composition — **not** Nepal's national anthem.
