#!/usr/bin/env node
/**
 * build-dashboard.mjs: lay out the Cloud Yatra dashboard and derive its public copy.
 *
 * `cloud-yatra-observatory.json` is the single source of truth. This script:
 *   - lays the source out section by section (SOURCE_LAYOUT) and rewrites it in place,
 *   - derives `cloud-yatra-observatory-public.json` for Grafana's "Share externally".
 *
 * Externally shared dashboards cannot use template variables, Tempo, or exemplars, so the
 * public copy drops the game embed, the per-session "Your run" row and the Tempo panels,
 * inlines the API URL and Faro app id, replaces `$__range` / `$__interval` with fixed
 * windows, and wires `${DS_*}` references to this stack's data source names. Prometheus,
 * Loki (backend logs and Faro) and Infinity panels are kept.
 *
 * Usage: node observability/build-dashboard.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, '..', 'observability', 'dashboards');

// --- config (this stack) --------------------------------------------------------------
const API_BASE = 'https://cloud-yatra-api.im-shree03.workers.dev';
const FARO_APP_ID = '2383';
// This stack's data source UIDs. Externally shared dashboards resolve data sources by UID only.
const DS_UID = {
  '${DS_PROM}': 'grafanacloud-prom',
  '${DS_FARO}': 'grafanacloud-logs',
  '${DS_BACKEND_LOGS}': 'grafanacloud-logs',
  '${DS_TEMPO}': 'grafanacloud-traces',
  '${DS_INFINITY}': 'grafanacloud-infinity',
};

const GRID_W = 24;

/** Deep-clone via JSON (dashboards are plain JSON). */
const clone = (o) => JSON.parse(JSON.stringify(o));

/** Write this stack's API URL and Faro app id into a panel (both dashboards). */
function inlineStackValues(node) {
  if (Array.isArray(node)) return node.map(inlineStackValues);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = inlineStackValues(v);
    return out;
  }
  if (typeof node === 'string') {
    return node
      .replaceAll('${api_base_url}', API_BASE)
      .replaceAll('$api_base_url', API_BASE)
      .replaceAll('${faro_app_id}', FARO_APP_ID)
      .replaceAll('$faro_app_id', FARO_APP_ID);
  }
  return node;
}

/** Recursively substitute literal strings throughout a panel/target subtree. */
function substituteLiterals(node) {
  if (Array.isArray(node)) return node.map(substituteLiterals);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = substituteLiterals(v);
    return out;
  }
  if (typeof node === 'string') {
    return node
      .replaceAll('${api_base_url}', API_BASE)
      .replaceAll('$api_base_url', API_BASE)
      .replaceAll('$faro_app_id', FARO_APP_ID)
      .replaceAll('${faro_app_id}', FARO_APP_ID)
      .replaceAll('[$__range]', '[24h]')
      .replaceAll('[$__interval]', '[2m]');
  }
  return node;
}

/**
 * A public (anonymous) viewer must never be handed a link that redirects to a Grafana
 * login wall. Strip any panel/field `links[]` entry that points at an authenticated
 * Grafana surface: app plugins (`/a/...`, e.g. the Frontend Observability drill-down
 * `grafana-kowalski-app`), Explore, or an authenticated dashboard (`/d/`). Genuinely
 * public links (the game, public-dashboards) are kept. Runs recursively so it covers
 * both panel-level and fieldConfig.defaults links.
 */
function isPrivateGrafanaLink(url) {
  if (typeof url !== 'string') return false;
  if (!/grafana\.net/i.test(url)) return false; // external links (the game) are fine
  // public-dashboards are the one authenticated-origin path that IS public.
  if (/\/public-dashboards\//i.test(url)) return false;
  return /\/a\/|grafana-kowalski-app|\/explore|\/d\//i.test(url);
}

function stripPrivateLinks(node) {
  if (Array.isArray(node)) return node.map(stripPrivateLinks);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === 'links' && Array.isArray(v)) {
        out.links = v
          .filter((l) => !isPrivateGrafanaLink(l && l.url))
          .map(stripPrivateLinks);
      } else {
        out[k] = stripPrivateLinks(v);
      }
    }
    return out;
  }
  return node;
}

/** Rewrite `${DS_*}` data source placeholders to this stack's UIDs. */
function wireDatasources(node) {
  if (Array.isArray(node)) return node.map(wireDatasources);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === 'datasource' && v && typeof v === 'object' && typeof v.uid === 'string' && DS_UID[v.uid]) {
        out.datasource = { type: v.type, uid: DS_UID[v.uid] };
      } else {
        out[k] = wireDatasources(v);
      }
    }
    return out;
  }
  if (typeof node === 'string' && DS_UID[node]) return DS_UID[node];
  return node;
}

// --- visual system --------------------------------------------------------------------
// One palette for the whole dashboard. Legacy colours in the source are mapped onto it so
// every panel, threshold and banner uses the same hues.
const C = {
  blue: '#4C8DFF',
  sky: '#6CC4FF',
  teal: '#2EB8A6',
  green: '#3FBF7F',
  amber: '#F5A524',
  gold: '#E8B04A',
  rose: '#E5546C',
  red: '#E5484D',
  violet: '#9B7BFF',
  grey: '#8A94A6',
};
const COLOR_MAP = {
  '#73d13d': C.green,
  '#ffb454': C.amber,
  '#e0294a': C.red,
  '#3a9e8f': C.teal,
  '#63d8b4': C.teal,
  '#4a7fd6': C.blue,
  '#3fb6ff': C.sky,
  '#8ecbff': C.sky,
  '#c4415a': C.rose,
  '#d6a03a': C.gold,
  '#f6b73c': C.gold,
  '#7f7fd5': C.violet,
  '#b388ff': C.violet,
  '#8b98ad': C.grey,
  '#2d6e5f': '#1F8A6E',
  '#9b3044': '#C93A4E',
  green: C.green,
  red: C.red,
  orange: C.amber,
  yellow: C.amber,
  blue: C.blue,
  'dark-green': C.green,
  'dark-red': C.red,
  'dark-orange': C.amber,
  'dark-yellow': C.amber,
  'semi-dark-green': C.green,
  'semi-dark-red': C.red,
  'semi-dark-orange': C.amber,
  'semi-dark-yellow': C.amber,
};

/** Column names shown to the public say "Players", not "Pilgrims" (exact-match strings only). */
const TERMS = { Pilgrims: 'Players', Pilgrim: 'Player', '/^Pilgrims$/': '/^Players$/' };
function renameTerms(node) {
  if (Array.isArray(node)) return node.map(renameTerms);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[TERMS[k] ?? k] = renameTerms(v);
    return out;
  }
  return typeof node === 'string' && TERMS[node] ? TERMS[node] : node;
}

/** Recursively map legacy colours (hex anywhere in a string, or a bare named colour) onto C. */
function mapColors(node) {
  if (Array.isArray(node)) return node.map(mapColors);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = mapColors(v);
    return out;
  }
  if (typeof node === 'string') {
    const exact = COLOR_MAP[node.toLowerCase()];
    if (exact) return exact;
    return node.replace(/#[0-9a-fA-F]{6}\b/g, (m) => COLOR_MAP[m.toLowerCase()] ?? m);
  }
  return node;
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** The banner shared by both dashboards: dusk gradient, prayer-flag strip, signal chips. */
function headerPanel(id) {
  const flag = (c, w) => `${c} ${w}`;
  const content =
    `<div style="box-sizing:border-box;border-radius:10px;overflow:hidden;font-family:${FONT};color:#fff;` +
    'background:linear-gradient(105deg,#0f1a30 0%,#16294d 55%,#2f1a33 100%);' +
    'border:1px solid rgba(255,255,255,.08);box-shadow:0 4px 18px rgba(0,0,0,.35)">' +
    '<div style="height:4px;background:linear-gradient(90deg,' +
    [flag(C.blue, '0 20%'), flag('#e9edf3', '20% 40%'), flag(C.rose, '40% 60%'), flag(C.teal, '60% 80%'), flag(C.gold, '80% 100%')].join(',') +
    ')"></div>' +
    '<div style="padding:14px 20px 16px">' +
    '<div style="display:flex;align-items:baseline;flex-wrap:wrap;gap:10px">' +
    '<span style="font-size:22px;font-weight:800;letter-spacing:.2px">Cloud Yatra · Live Observatory</span>' +
    '<span style="font-size:15px;font-weight:600;opacity:.75">क्लाउड यात्रा</span></div>' +
    '<div style="opacity:.92;font-size:13px;margin-top:5px;line-height:1.55">' +
    'Cloud Yatra is a browser game where you guide Yatri, a Nepali traveller, up from the jungle to the Himalayan summit. ' +
    'Every jump, fall and finish is recorded and shown here <b>live</b>. ' +
    'Play at <a href="https://cloud-yatra.pages.dev" target="_blank" rel="noopener" ' +
    `style="color:${C.gold};font-weight:600;text-decoration:none;white-space:nowrap">cloud-yatra.pages.dev</a>.</div>` +
    '</div></div></div>';
  return {
    id,
    type: 'text',
    title: '',
    // 4 rows leaves room for the text to wrap on narrower screens without a scroll bar.
    gridPos: { h: 4, w: GRID_W, x: 0, y: 0 },
    options: { mode: 'html', content },
    transparent: true,
  };
}

/** "How it's built" footer: the stack as four connected layers, shown as tags, not prose. */
function footerContent() {
  const chip = (text, color) =>
    '<span style="display:inline-block;margin:0 5px 5px 0;padding:3px 9px;border-radius:999px;' +
    `font-size:11.5px;font-weight:600;color:#e8eef6;background:${color}1f;border:1px solid ${color}55;` +
    `white-space:nowrap">${text}</span>`;
  const card = (color, label, sub, tags, grow = 1) =>
    `<div style="flex:${grow} 1 0;min-width:0;box-sizing:border-box;padding:11px 13px 7px;border-radius:10px;` +
    `background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-top:3px solid ${color}">` +
    '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:8px">' +
    `<span style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:800;color:${color}">${label}</span>` +
    `<span style="font-size:11px;color:#8aa0b8;white-space:nowrap">${sub}</span></div>` +
    tags.map((t) => chip(t, color)).join('') +
    '</div>';
  const arrow =
    '<div style="flex:0 0 auto;align-self:center;color:#5d6b80;font-size:18px;padding:0 2px">→</div>';
  return (
    `<div style="font-family:${FONT};overflow:hidden">` +
    '<div style="display:flex;align-items:stretch;gap:6px">' +
    card(C.rose, 'Frontend', 'in the browser', ['Phaser 3', 'TypeScript', 'Vite', 'Cloudflare Pages', 'Faro Web SDK']) +
    arrow +
    card(C.blue, 'Backend · API', 'at the edge', ['Cloudflare Worker', 'REST · 14 routes', 'Input validation', 'OTLP tracing', 'Chaos Mode']) +
    arrow +
    card(C.teal, 'Database', 'at the edge', ['Cloudflare D1', 'SQLite', 'Daily rollups', 'Leaderboard']) +
    arrow +
    card(C.gold, 'Grafana Cloud', 'observability', [
      'Prometheus · metrics', 'Loki · logs', 'Tempo · traces', 'Faro · real users',
      'Infinity · D1 analytics', 'Exemplars', 'SLOs · error budget', '5 alert rules', 'Public dashboard',
    ], 1.7) +
    '</div></div>'
  );
}

/** Panels removed from the source because another panel already shows the same value. */
const DUPLICATES = new Set([
  2, // Prometheus "Active pilgrims": same as the D1 tile 200
  34, // "Total events": same as "Events stored" (7)
  35, // second "Blooms and bells" pie: same as 28
  42, // Prometheus "Chaos active": same as "Storm status" (920)
  32, // "Top pilgrims": merged into the single leaderboard table (68)
]);

/**
 * Section layouts: [row id, row title, [[panel id, w, h], ...]].
 * Panels in a section are placed left to right and wrap at 24 columns.
 * The source is viewed full-width in Grafana; the public copy is embedded in a ~960px
 * page, so its stat tiles are wider to keep titles readable.
 */
const ROW = {
  live: [1, 'RIGHT NOW · who is playing and what is happening'],
  health: [55, 'IS THE SERVER HEALTHY? · speed, errors and reliability'],
  climb: [21, 'THE CLIMB · how far players get'],
  journey: [25, 'WHAT PLAYERS DO · actions, falls and flowers'],
  player: [17, 'HOW THE GAME FEELS · speed and errors in players\' browsers'],
  backend: [8, 'SERVER ACTIVITY · requests, errors and response time'],
  logs: [60, 'SERVER LOGS & TRACES · a record of every request'],
  scores: [31, 'LEADERBOARD · the best climbers'],
  world: [37, 'AROUND THE WORLD · where players are from'],
  chaos: [41, 'CHAOS MODE · breaking the server on purpose to watch it recover'],
  built: [900, "HOW IT'S BUILT"],
};

const section = (key, items) => [...ROW[key], items];

const SHARED = {
  // Single-number tiles are stacked in a narrow column beside the charts they summarise,
  // so charts and tables get the width.
  climb: [[24, 9, 8], [30, 11, 8], [71, 4, 4], [33, 4, 4, 'below']],
  journey: [[53, 8, 8], [29, 16, 8], [26, 12, 9], [39, 12, 9], [27, 12, 8], [28, 12, 8]],
  player: [[18, 12, 7], [19, 12, 7], [22, 10, 8], [23, 10, 8], [36, 4, 4], [20, 4, 4, 'below']],
  backend: [[9, 12, 7], [10, 12, 7], [11, 12, 7], [12, 12, 7]],
  scores: [[68, 24, 9]],
  world: [[54, 16, 8], [38, 8, 8]],
  chaos: [[920, 6, 3], [72, 6, 3, 'below'], [43, 9, 6], [45, 9, 6]],
  built: [[40, 24, 6]],
};

const SOURCE_LAYOUT = [
  [66, 'PLAY THE GAME · everything you do here shows up in the charts below', [[67, 24, 15]]],
  [44, 'YOUR RUN · live stats for the game you are playing now',
    [[46, 4, 4], [47, 4, 4], [48, 4, 4], [49, 4, 4], [50, 4, 4], [51, 4, 4]]],
  section('live', [[200, 4, 4], [70, 4, 4], [201, 4, 4], [202, 4, 4], [203, 4, 4], [7, 4, 4]]),
  section('health', [[3, 6, 4], [4, 6, 4], [5, 6, 4], [6, 6, 4], [56, 6, 6], [57, 6, 6], [58, 6, 6], [59, 6, 6]]),
  section('climb', SHARED.climb),
  section('journey', SHARED.journey),
  section('player', SHARED.player),
  section('backend', SHARED.backend),
  section('logs', [[61, 24, 9], [62, 12, 7], [63, 12, 7], [64, 12, 8], [65, 12, 8]]),
  section('scores', SHARED.scores),
  section('world', SHARED.world),
  section('chaos', SHARED.chaos),
  section('built', SHARED.built),
];

const PUBLIC_LAYOUT = [
  section('live', [[200, 4, 4], [70, 4, 4], [201, 4, 4], [202, 4, 4], [203, 4, 4], [7, 4, 4]]),
  section('health', [[3, 6, 4], [4, 6, 4], [5, 6, 4], [6, 6, 4], [56, 6, 6], [57, 6, 6], [58, 6, 6], [59, 6, 6]]),
  section('climb', SHARED.climb),
  section('journey', SHARED.journey),
  section('player', SHARED.player),
  section('backend', SHARED.backend),
  [60, 'SERVER LOGS · a record of every request', [[61, 24, 9], [62, 12, 7], [63, 12, 7]]],
  section('scores', SHARED.scores),
  section('world', SHARED.world),
  section('chaos', SHARED.chaos),
  section('built', SHARED.built),
];

/** Place `panels` according to `layout`, below `header`. Every panel must be placed. */
function layout(panels, sections, header) {
  const byId = new Map(panels.map((p) => [p.id, p]));
  const out = [header];
  let y = header.gridPos.h;
  for (const [rowId, title, items] of sections) {
    const row = byId.get(rowId) ?? { id: rowId, type: 'row', collapsed: false, panels: [] };
    row.title = title;
    row.gridPos = { h: 1, w: GRID_W, x: 0, y };
    out.push(row);
    y += 1;
    let x = 0;
    let lineH = 0;
    let prev = null;
    for (const [id, w, h, place] of items) {
      const p = byId.get(id);
      if (!p) throw new Error(`layout: panel ${id} not found`);
      if (place === 'below') {
        // Stack under the previous panel in the same column (compact KPI tiles).
        p.gridPos = { h, w, x: prev.x, y: prev.y + prev.h };
        out.push(p);
        lineH = Math.max(lineH, p.gridPos.y + h - y);
        prev = p.gridPos;
        continue;
      }
      if (x + w > GRID_W) {
        y += lineH;
        x = 0;
        lineH = 0;
      }
      p.gridPos = { h, w, x, y };
      out.push(p);
      prev = p.gridPos;
      x += w;
      lineH = Math.max(lineH, h);
    }
    y += lineH;
  }
  const placed = new Set(out.map((p) => p.id));
  const missing = panels.filter((p) => p.type !== 'row' && !placed.has(p.id)).map((p) => p.id);
  if (missing.length) throw new Error(`layout: panels not placed: ${missing.join(', ')}`);
  return out;
}

// --- per-panel polish ------------------------------------------------------------------
const setOverride = (panel, name, color) => {
  const ov = (panel.fieldConfig.overrides ??= []);
  const prop = { id: 'color', value: { mode: 'fixed', fixedColor: color } };
  const hit = ov.find((o) => o.matcher?.id === 'byName' && o.matcher.options === name);
  if (hit) {
    hit.properties = hit.properties.filter((x) => x.id !== 'color').concat(prop);
  } else {
    ov.push({ matcher: { id: 'byName', options: name }, properties: [prop] });
  }
};

/** Fixed series colours for panels whose series are known. */
const SERIES_COLORS = {
  10: { p50: C.green, p90: C.amber, p99: C.rose },
  18: { 'LCP p95': C.blue, 'INP p95': C.violet },
  19: { CLS: C.violet, TTFB: C.blue, FCP: C.teal },
  28: {
    'Lali gurans (rhododendron)': C.rose,
    'Sayapatri (marigold)': C.amber,
    'Himalayan blue poppy': C.blue,
    'Prayer bell': C.violet,
  },
  62: { error: C.red, warn: C.amber, info: C.blue },
  63: { error: C.red, warn: C.amber },
  43: { 'Requests hit': C.amber },
};

// --- plain-language copy ---------------------------------------------------------------
// Titles and hover text written for someone who has never seen a dashboard.
const COPY = {
  67: ['Play Cloud Yatra here', 'The live game. Play a run and watch the numbers below change.'],
  46: ['Your best score', 'The highest score you reached in this session.'],
  47: ['Your progress', 'How far up the mountain you have climbed, as a percentage.'],
  48: ['Summits reached', 'How many times you finished the climb in this session.'],
  49: ['Falls', 'How many times Yatri fell or was hurt in this session.'],
  50: ['Jumps', 'How many jumps you made in this session.'],
  51: ['Flowers and bells', 'Flowers and prayer bells you collected in this session.'],
  200: ['Players online now', 'People who played in the last 5 minutes.'],
  201: ['Game events per minute', 'Actions (jumps, falls, pickups) the game reported in the last minute. Higher means more activity.'],
  202: ['Summits reached today', 'How many times anyone finished the climb today (UTC).'],
  203: ['Lives lost today', 'How many times players fell or were hurt today (UTC).'],
  70: ['Players so far', 'Everyone who has ever started a climb.'],
  71: ['Reached the summit', 'Of all players who started, the share who made it to the top.'],
  72: ['Storm strength', 'What a chaos storm does to the server: extra delay on each request and the share of requests made to fail.'],
  7: ['Total game events recorded', 'Every action ever recorded by the game, all time.'],
  36: ['Average FPS (1 h)', 'Frames per second players are getting, averaged over the last hour. 50 or more is smooth, under 30 is choppy.'],
  3: ['Server requests per second', 'How many requests the game server is handling each second.'],
  4: ['Game events saved per minute', 'How many game actions the server stored in the last minute.'],
  5: ['Response time (slowest 5%)', '95 out of 100 requests are answered faster than this. Green is under 150 ms, red is over 400 ms.'],
  6: ['Server error rate', 'The share of requests where the server failed. Green means 0%, red means something is wrong.'],
  56: ['Uptime (availability)', 'The share of requests that succeeded. The goal is 99% or more.'],
  57: ['Error allowance left', 'The goal allows 1% of requests to fail. This shows how much of that allowance is still unused. 100% is perfect.'],
  58: ['Fast responses (under 0.5 s)', 'The share of requests answered in under half a second. The goal is 95% or more.'],
  59: ['Error allowance burn rate (1 h)', 'How fast the failure allowance is being used. 1 means exactly on pace, 0 means no errors, above 14 means an urgent problem.'],
  24: ['How far players climb', 'How many different players reached each stage, from the jungle at the bottom to the summit.'],
  30: ['Share of players reaching each stage', 'Of everyone who started, the percentage who got this far.'],
  33: ['Regions finished', 'Times any player completed a whole region, all time.'],
  53: ['Activity in each region', 'How much gameplay happened in each region of the mountain.'],
  29: ['Each region compared', 'For each region: total activity, lives lost, and times it was finished.'],
  26: ['What players do', 'Every kind of action the game records, counted.'],
  39: ['All actions, counted', 'The full list of recorded action types and how often each happened.'],
  27: ['What causes falls', 'Which hazards cost players a life. Taller bars are more dangerous.'],
  28: ['Flowers and bells collected', "Which flowers and prayer bells players picked up. Lali gurans (rhododendron) is Nepal's national flower."],
  18: ['Page load and response speed (slowest 5%)', 'LCP: how long the game takes to appear. INP: how fast it reacts to a key press or tap. Lower is better. Measured in real players\' browsers.'],
  19: ['Visual stability and first load', 'CLS: how much the page jumps around while loading (near 0 is best). TTFB: time until the server first answers. FCP: time until anything shows on screen.'],
  22: ['Game smoothness over time (FPS)', 'Frames per second in players\' browsers, split by region. 60 is perfectly smooth.'],
  23: ['How smooth is it for everyone? (FPS spread)', 'Each column is a moment in time. Brighter cells mean more players were getting that frame rate.'],
  20: ['Browser errors', 'Crashes or errors that happened in players\' browsers. 0 is what you want.'],
  9: ['Requests by type', 'How many requests the server handles each second, grouped by what they were for (for example scores or events).'],
  10: ['How fast the server answers', 'Typical (p50), slower (p90) and slowest (p99) response times. For example, p90 means 90 of 100 requests were faster than that line. Lower is better.'],
  11: ['Successful vs failed responses', '2xx = success, 3xx = redirect, 4xx = bad request from the sender, 5xx = server failure. Mostly 2xx is healthy.'],
  12: ['Game events accepted vs rejected', 'Events the server stored (accepted) and events it refused because they were invalid (rejected).'],
  61: ['Live server log', 'A running list of what the server did, one line per request, newest first. Shows the page asked for, the result and how long it took.'],
  62: ['Log messages by severity', 'Counts of info (normal), warn (odd) and error (failed) messages. Growing orange or red bars are an early warning.'],
  63: ['Warnings and errors over time', 'How often the server logged a warning or an error. This should stay flat near zero.'],
  64: ['Recent requests, step by step (traces)', 'A trace is the full journey of one request through the server. Click a row to see where time was spent.'],
  65: ['Request traces by outcome', 'How many traced requests succeeded or failed. It confirms the tracing data is flowing.'],
  68: ['Leaderboard', "Every player's best run, ranked by score. Click a column header to sort, for example by Last played to see who is climbing now."],
  54: ['Where players are from', 'Bigger, warmer dots mean more players from that country. Only the country is known. No IP addresses are stored.'],
  38: ['Top countries', 'Countries with the most players.'],
  920: ['Storm status', 'Calm skies means the server is running normally. A red storm means Chaos Mode is deliberately slowing the server and causing errors.'],
  43: ['Requests hit by the storm', 'How many requests per second were deliberately slowed or failed during a chaos storm. Flat at zero when calm.'],
  45: ['Past storms', 'When Chaos Mode started and stopped, and how much delay and failure it added.'],
};

function polishPanel(p) {
  const text = COPY[p.id];
  if (text) [p.title, p.description] = text;
  if (p.type === 'row' || p.type === 'innius-video-panel') return p;
  if (p.id === 40) {
    p.options.content = footerContent();
    return p;
  }
  if (p.type === 'text') return p;

  // Panels become cards (Grafana's own panel surface and border) for clear grouping.
  delete p.transparent;
  p.fieldConfig ??= { defaults: {}, overrides: [] };
  p.fieldConfig.defaults ??= {};
  p.options ??= {};
  const f = p.fieldConfig.defaults;
  const o = p.options;

  switch (p.type) {
    case 'stat': {
      const fixed = f.color?.mode === 'fixed';
      if (fixed && o.colorMode === 'background') o.colorMode = 'value';
      o.justifyMode = 'center';
      o.textMode = 'value';
      o.wideLayout = true;
      o.showPercentChange = false;
      o.graphMode = p.datasource?.type === 'prometheus' ? 'area' : (o.graphMode ?? 'none');
      break;
    }
    case 'gauge':
      Object.assign(o, { showThresholdMarkers: true, showThresholdLabels: false, minVizHeight: 90, minVizWidth: 120 });
      break;
    case 'bargauge':
      Object.assign(o, { displayMode: 'gradient', showUnfilled: true, minVizHeight: 18, namePlacement: 'top' });
      break;
    case 'timeseries': {
      const cu = (f.custom ??= {});
      Object.assign(cu, {
        drawStyle: 'line',
        lineInterpolation: 'smooth',
        lineWidth: 2,
        fillOpacity: 14,
        gradientMode: 'opacity',
        showPoints: 'never',
        spanNulls: true,
        axisBorderShow: false,
        axisGridShow: true,
        axisPlacement: 'auto',
        axisSoftMin: 0,
        thresholdsStyle: { mode: 'off' },
      });
      o.tooltip = { mode: 'multi', sort: 'desc' };
      o.legend = { ...(o.legend ?? {}), showLegend: true, displayMode: 'table', placement: 'bottom', calcs: ['lastNotNull', 'max', 'mean'] };
      break;
    }
    case 'barchart':
      Object.assign(o, { showValue: 'auto', xTickLabelRotation: 0, tooltip: { mode: 'multi', sort: 'desc' } });
      f.custom = { ...(f.custom ?? {}), fillOpacity: 80, lineWidth: 0, gradientMode: 'hue', axisBorderShow: false };
      break;
    case 'piechart':
      o.pieType = 'donut';
      o.tooltip = { mode: 'multi', sort: 'desc' };
      break;
    case 'table':
      o.cellHeight = 'md';
      o.showHeader = true;
      // Columns keep a readable width; a wide table scrolls sideways and a long one scrolls down.
      f.custom = {
        ...(f.custom ?? {}),
        align: f.custom?.align === 'center' ? 'center' : 'left',
        filterable: false,
        minWidth: Math.max(f.custom?.minWidth ?? 0, 120),
      };
      break;
    case 'heatmap':
      o.color = { ...(o.color ?? {}), mode: 'scheme', scheme: 'Viridis', steps: 64 };
      break;
    case 'geomap':
      o.basemap = { type: 'carto', name: 'Basemap', config: { theme: 'dark', showLabels: true } };
      break;
    case 'logs':
      Object.assign(o, { showTime: true, wrapLogMessage: true, prettifyLogMessage: true, enableLogDetails: true, sortOrder: 'Descending' });
      break;
    default:
  }

  for (const [name, color] of Object.entries(SERIES_COLORS[p.id] ?? {})) setOverride(p, name, color);

  // A clear empty state instead of Grafana's bare "No data" when nothing happened in the window.
  if (f.noValue === undefined) {
    if (p.type === 'stat' || p.type === 'gauge') f.noValue = '0';
    else if (p.type === 'table') f.noValue = 'Nothing recorded yet';
    else f.noValue = 'No activity in this time range. Play a run to fill it in.';
  }
  return p;
}

/** Apply the shared visual system to every panel and to the dashboard settings. */
function polish(d) {
  d.panels = d.panels.map((p) => (p.type === 'text' && p.gridPos?.y === 0 ? p : renameTerms(mapColors(polishPanel(p)))));
  d.style = 'dark';
  d.timezone = 'browser';
  d.graphTooltip = 1; // shared crosshair and tooltip across time series
  d.refresh = '10s';
  d.time = { from: 'now-6h', to: 'now' };
  d.timepicker = { ...(d.timepicker ?? {}), refresh_intervals: ['10s', '30s', '1m', '5m'] };
  return d;
}

// --- panels added by this script ------------------------------------------------------
const infinityStat = (id, url, root, selector, unit, color, decimals = 0) => ({
  id,
  type: 'stat',
  title: '',
  datasource: { type: 'yesoreyeram-infinity-datasource', uid: '${DS_INFINITY}' },
  fieldConfig: { defaults: { unit, decimals, color: { mode: 'fixed', fixedColor: color } }, overrides: [] },
  options: {
    colorMode: 'value',
    graphMode: 'none',
    textMode: 'value',
    reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
  },
  targets: [{
    refId: 'A', type: 'json', source: 'url', format: 'table', parser: 'backend',
    url: `\${api_base_url}${url}`, root_selector: root,
    columns: [{ selector, text: selector, type: 'number' }],
    url_options: { method: 'GET', data: '' },
  }],
});

const NEW_PANELS = [
  infinityStat(70, '/stats', 'sessions', 'total', 'short', C.sky),
  // funnelSteps is ordered bottom to top, so the last row is "stood on the summit".
  infinityStat(71, '/stats', 'funnelSteps', 'pctOfStarted', 'percent', C.gold, 0),
  {
    ...infinityStat(72, '/chaos/status', 'profile', 'latencyMs', 'ms', C.amber),
    targets: [{
      refId: 'A', type: 'json', source: 'url', format: 'table', parser: 'backend',
      url: '${api_base_url}/chaos/status', root_selector: 'profile',
      columns: [
        { selector: 'latencyMs', text: 'Added delay', type: 'number' },
        { selector: 'errorRate', text: 'Failed requests', type: 'number' },
      ],
      url_options: { method: 'GET', data: '' },
    }],
    fieldConfig: {
      defaults: { decimals: 0, color: { mode: 'fixed', fixedColor: C.amber } },
      overrides: [
        { matcher: { id: 'byName', options: 'Added delay' }, properties: [{ id: 'unit', value: 'ms' }] },
        { matcher: { id: 'byName', options: 'Failed requests' }, properties: [{ id: 'unit', value: 'percentunit' }] },
      ],
    },
    options: {
      colorMode: 'value', graphMode: 'none', textMode: 'value_and_name', orientation: 'horizontal',
      reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
      text: { titleSize: 12, valueSize: 22 },
    },
  },
];

/** One leaderboard table: rank, best score, run time, furthest region, country, last played. */
function leaderboardPanel(old) {
  const byName = (name, properties) => ({ matcher: { id: 'byName', options: name }, properties });
  const countryMap = old.fieldConfig.overrides
    .find((o) => o.matcher.options === 'Country')
    .properties.find((x) => x.id === 'mappings').value;
  const medals = ['🥇 1', '🥈 2', '🥉 3'];
  const rank = Object.fromEntries(
    Array.from({ length: 50 }, (_, i) => [String(i), { text: medals[i] ?? String(i + 1), index: i }]),
  );
  const col = (selector, text, type) => ({ selector, text, type });
  return {
    id: 68,
    type: 'table',
    title: 'Leaderboard',
    datasource: old.datasource,
    fieldConfig: {
      defaults: {
        custom: { align: 'left', cellOptions: { type: 'auto' }, filterable: false, minWidth: 120 },
        noValue: 'No runs yet. Play a round and your climb appears here.',
      },
      overrides: [
        byName('Rank', [
          { id: 'mappings', value: [{ type: 'value', options: rank }] },
          { id: 'custom.align', value: 'center' },
          { id: 'custom.width', value: 80 },
          { id: 'custom.minWidth', value: 80 },
        ]),
        byName('Player', [{ id: 'custom.minWidth', value: 160 }]),
        byName('Score', [
          { id: 'custom.cellOptions', value: { type: 'gauge', mode: 'basic', valueDisplayMode: 'text' } },
          { id: 'color', value: { mode: 'fixed', fixedColor: C.gold } },
          { id: 'min', value: 0 },
          { id: 'decimals', value: 0 },
          { id: 'custom.minWidth', value: 200 },
        ]),
        byName('Run time', [{ id: 'unit', value: 'ms' }, { id: 'decimals', value: 1 }, { id: 'custom.align', value: 'center' }]),
        byName('Furthest region', [
          {
            id: 'mappings',
            value: [{
              type: 'value',
              options: {
                terai: { text: 'Terai (jungle)', color: C.green, index: 0 },
                hills: { text: 'Pahad (hills)', color: C.teal, index: 1 },
                himal: { text: 'Himal (high peaks)', color: C.sky, index: 2 },
                himal_rajya: { text: '🏔 Summit', color: C.gold, index: 3 },
              },
            }],
          },
          { id: 'custom.cellOptions', value: { type: 'color-text' } },
          { id: 'custom.minWidth', value: 150 },
        ]),
        byName('Country', [{ id: 'mappings', value: countryMap }, { id: 'custom.minWidth', value: 130 }]),
        byName('Last played', [{ id: 'unit', value: 'dateTimeFromNow' }, { id: 'custom.minWidth', value: 130 }]),
      ],
    },
    options: { showHeader: true, cellHeight: 'md', footer: { show: false } },
    targets: [{
      refId: 'A', type: 'json', source: 'url', format: 'table', parser: 'backend',
      url: '${api_base_url}/recent?limit=50', root_selector: 'entries',
      columns: [
        col('name', 'Player', 'string'),
        col('score', 'Score', 'number'),
        col('timeMs', 'Run time', 'number'),
        col('levelId', 'Furthest region', 'string'),
        col('country', 'Country', 'string'),
        col('updatedAt', 'Last played', 'number'),
      ],
      url_options: { method: 'GET', data: '' },
    }],
    transformations: [
      { id: 'sortBy', options: { sort: [{ field: 'Score', desc: true }] } },
      { id: 'calculateField', options: { mode: 'index', alias: 'Rank', index: { asPercentile: false }, replaceFields: false } },
      {
        id: 'organize',
        options: {
          indexByName: { Rank: 0, Player: 1, Score: 2, 'Run time': 3, 'Furthest region': 4, Country: 5, 'Last played': 6 },
          renameByName: {},
          excludeByName: {},
        },
      },
    ],
  };
}

/** Queries that return nothing when all is well now return 0, so the panel shows a flat line. */
function fixQueries(panels) {
  const board = panels.findIndex((p) => p.id === 68);
  if (board >= 0) panels[board] = leaderboardPanel(panels[board]);
  const zeroWhenEmpty = { 20: ['A'], 63: ['A', 'B'] };
  const traces = panels.find((p) => p.id === 64);
  if (traces) {
    traces.targets = [{
      refId: 'A', datasource: traces.targets[0].datasource, queryType: 'traceql',
      query: '{resource.service.name="cloud-yatra-api"}', tableType: 'traces', limit: 20,
    }];
  }
  const chaos = panels.find((p) => p.id === 43);
  if (chaos) {
    chaos.targets = [{ refId: 'A', expr: 'sum(rate(cy_chaos_injected_total[1m])) or vector(0)', legendFormat: 'Requests hit', range: true }];
    delete chaos.fieldConfig.defaults.noValue;
  }
  for (const p of panels) {
    for (const t of p.targets ?? []) {
      if (zeroWhenEmpty[p.id]?.includes(t.refId) && t.expr && !t.expr.includes('vector(0)')) {
        t.expr = `(${t.expr}) or vector(0)`;
      }
    }
  }
  // Browser errors: total over the dashboard's time range, not just the latest interval.
  const errors = panels.find((p) => p.id === 20);
  if (errors) errors.options.reduceOptions.calcs = ['sum'];
}

/** Re-lay out the source dashboard in place and drop duplicate panels. */
function buildSource(grand) {
  const d = clone(grand);
  const header = d.panels.find((p) => p.type === 'text' && p.gridPos?.y === 0);
  const panels = d.panels.filter((p) => p !== header && !DUPLICATES.has(p.id));
  for (const p of NEW_PANELS) if (!panels.some((q) => q.id === p.id)) panels.push(clone(p));
  fixQueries(panels);
  // Shared dashboards do not expand template variables, so the API URL and Faro app id are
  // written into the queries. Only the per-tab `session` variable remains.
  panels.forEach((p, i) => { panels[i] = inlineStackValues(p); });
  d.templating.list = d.templating.list.filter((v) => !['api_base_url', 'faro_app_id'].includes(v.name));
  d.panels = layout(panels, SOURCE_LAYOUT, headerPanel(header?.id ?? 52));
  return polish(d);
}

/** Data sources that render on an externally shared dashboard (Tempo does not). */
const PUBLIC_DATASOURCES = new Set(['yesoreyeram-infinity-datasource', 'prometheus', 'loki']);

/** Fail the build if a public panel would break when shared externally. */
function assertPublicSafe(panel) {
  const type = panel.datasource?.type;
  if (type && !PUBLIC_DATASOURCES.has(type)) {
    throw new Error(`public: panel ${panel.id} uses unsupported data source ${type}`);
  }
  const leftover = JSON.stringify(panel.targets ?? []).match(/\$\{?(?!__)[A-Za-z_]+/);
  if (leftover) throw new Error(`public: panel ${panel.id} still references ${leftover[0]}`);
}

/** Build the public dashboard from the laid-out source. */
function buildPublic(grand) {
  const d = clone(grand);
  const publicIds = new Set(PUBLIC_LAYOUT.flatMap(([rowId, , items]) => [rowId, ...items.map(([id]) => id)]));
  const panels = d.panels
    .filter((p) => publicIds.has(p.id))
    .map((p) => stripPrivateLinks(wireDatasources(substituteLiterals(p))));
  panels.forEach(assertPublicSafe);

  d.panels = layout(panels, PUBLIC_LAYOUT, headerPanel(1_000_000));
  d.uid = 'cloud-yatra';
  d.title = 'Cloud Yatra · Live Observatory';
  d.templating = { list: [] }; // externally shared dashboards cannot use variables
  delete d.__inputs;
  delete d.__requires;
  d.tags = ['cloud-yatra', 'observability', 'nepal'];
  d.refresh = '30s';
  // A day of history so every section has something to show even between players.
  d.time = { from: 'now-24h', to: 'now' };
  return d;
}

// --- run ------------------------------------------------------------------------------
const SOURCE = 'cloud-yatra-observatory.json';
const original = JSON.parse(readFileSync(path.join(dir, SOURCE), 'utf8'));
const grand = buildSource(original);
const pub = buildPublic(grand);
writeFileSync(path.join(dir, SOURCE), JSON.stringify(grand, null, 2) + '\n');
writeFileSync(path.join(dir, 'cloud-yatra-observatory-public.json'), JSON.stringify(pub, null, 2) + '\n');

const count = (d) => d.panels.filter((p) => p.type !== 'row').length;
console.log(`Source: ${SOURCE} (${count(grand)} panels)`);
console.log(`Public: cloud-yatra-observatory-public.json (${count(pub)} panels)`);
