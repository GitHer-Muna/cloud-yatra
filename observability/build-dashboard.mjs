#!/usr/bin/env node
/**
 * build-dashboard.mjs: generate the ONE canonical Cloud Yatra dashboard.
 *
 * There is a single source of truth: `cloud-yatra-observatory.json` (rich, every signal,
 * every signal). This script derives the public, embeddable dashboard from it so we never
 * hand-maintain two files. It writes:
 *   - cloud-yatra-observatory.json         (canonical: datasource template vars kept for a
 *                                           normal authenticated import / "map datasources")
 *   - cloud-yatra-observatory-public.json  (public-share ready: no template vars, datasource
 *                                           refs wired to this stack's names, hardcoded URLs)
 *
 * Public dashboards (Grafana "Share externally") CANNOT use template variables, so for the
 * public copy we:
 *   - drop the game Video panel + the per-session "your RUN" row (per-player belongs in the
 *     game page, which knows the session; public dashboards can't filter per viewer),
 *   - inline `${api_base_url}` and `$faro_app_id` to literals,
 *   - replace `${DS_*}` datasource refs with this stack's real datasource names,
 *   - lay the panels out explicitly per section (PUBLIC_LAYOUT).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, '..', 'observability', 'dashboards');

// --- config (this stack) --------------------------------------------------------------
const API_BASE = 'https://cloud-yatra-api.im-shree03.workers.dev';
const FARO_APP_ID = '2383';
// This stack's real datasource NAMES (Grafana resolves a uid that equals a name on import).
const DS_NAME = {
  '${DS_PROM}': 'grafanacloud-curioushalibut2108-prom',
  '${DS_FARO}': 'grafanacloud-curioushalibut2108-logs',
  '${DS_BACKEND_LOGS}': 'grafanacloud-curioushalibut2108-logs',
  '${DS_TEMPO}': 'grafanacloud-curioushalibut2108-traces',
  '${DS_INFINITY}': 'grafanacloud-infinity',
};

const GRID_W = 24;

/** Deep-clone via JSON (dashboards are plain JSON). */
const clone = (o) => JSON.parse(JSON.stringify(o));

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
      .replaceAll('${faro_app_id}', FARO_APP_ID);
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

/** Rewrite datasource.uid placeholders to concrete datasource names. */
function wireDatasources(node) {
  if (Array.isArray(node)) return node.map(wireDatasources);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === 'datasource' && v && typeof v === 'object' && typeof v.uid === 'string' && DS_NAME[v.uid]) {
        out.datasource = { type: v.type, uid: DS_NAME[v.uid] };
      } else {
        out[k] = wireDatasources(v);
      }
    }
    return out;
  }
  if (typeof node === 'string' && DS_NAME[node]) return DS_NAME[node];
  return node;
}

/** The branded header: a Nepal dusk gradient with a prayer-flag strip along the top. */
function headerPanel(id) {
  const content =
    '<div style="border-radius:12px;overflow:hidden;font-family:system-ui,sans-serif;color:#fff;' +
    'background:linear-gradient(100deg,#111a2e 0%,#17284a 60%,#3a1a2a 100%);border:1px solid rgba(255,255,255,.06)">' +
    '<div style="height:3px;background:linear-gradient(90deg,#4a7fd6 0 20%,#d9dde3 20% 40%,' +
    '#c4415a 40% 60%,#3a9e8f 60% 80%,#d6a03a 80% 100%)"></div>' +
    '<div style="padding:12px 18px 14px;display:flex;flex-wrap:wrap;align-items:center;gap:6px 16px">' +
    '<div style="flex:1 1 380px;min-width:0">' +
    '<div style="font-size:21px;font-weight:800;letter-spacing:.2px">' +
    'Cloud Yatra · Live Observatory ' +
    '<span style="font-weight:600;opacity:.8;font-size:16px">क्लाउड यात्रा</span></div>' +
    '<div style="opacity:.92;font-size:12.5px;margin-top:4px;line-height:1.5">Namaste! Live ' +
    "traffic from Yatri's climb, Terai to Himalaya. Play above, watch it move.</div></div>" +
    '</div></div>';
  return {
    id,
    type: 'text',
    title: '',
    gridPos: { h: 3, w: GRID_W, x: 0, y: 0 },
    options: { mode: 'html', content },
    transparent: true,
  };
}

/**
 * The public layout: [row id, row title, [[panel id, w, h], ...]].
 * Panels in a section are placed left to right and wrap onto a new line at 24 columns.
 */
const PUBLIC_LAYOUT = [
  [1, 'LIVE NOW · the pulse of the trail',
    [[200, 4, 5], [201, 4, 5], [202, 4, 5], [203, 4, 5], [7, 4, 5], [36, 4, 5]]],
  [21, 'THE CLIMB · from the Terai to the summit', [[24, 12, 7], [30, 8, 7], [33, 4, 7]]],
  [25, "YATRI'S JOURNEY · life on the trail",
    [[53, 8, 8], [29, 16, 8], [26, 8, 10], [39, 6, 10], [27, 5, 10], [28, 5, 10]]],
  [31, 'SCORES · the shared leaderboard', [[32, 12, 8], [68, 12, 8]]],
  [37, 'AROUND THE WORLD · where pilgrims join from', [[54, 16, 7], [38, 8, 7]]],
  [41, 'CHAOS MODE · break it on purpose, watch it heal', [[920, 6, 8], [45, 18, 8]]],
  [900, "HOW IT'S BUILT", [[40, 24, 2]]],
];

function layoutPublic(panels) {
  const byId = new Map(panels.map((p) => [p.id, p]));
  const out = [headerPanel(1_000_000)];
  let y = out[0].gridPos.h;
  for (const [rowId, title, items] of PUBLIC_LAYOUT) {
    const row = byId.get(rowId) ?? { id: rowId, type: 'row', collapsed: false, panels: [] };
    row.title = title;
    row.gridPos = { h: 1, w: GRID_W, x: 0, y };
    out.push(row);
    y += 1;
    let x = 0;
    let lineH = 0;
    for (const [id, w, h] of items) {
      const p = byId.get(id);
      if (!p) throw new Error(`public layout: panel ${id} not found in source`);
      if (x + w > GRID_W) {
        y += lineH;
        x = 0;
        lineH = 0;
      }
      p.gridPos = { h, w, x, y };
      out.push(p);
      x += w;
      lineH = Math.max(lineH, h);
    }
    y += lineH;
  }
  return out;
}

function panelIsRow(p) {
  return p.type === 'row';
}

/**
 * Remove row markers that have no child panels (the panels between this row and the next
 * were all filtered out). Keeps the dashboard free of empty section headers.
 */
function pruneEmptyRows(panels) {
  const out = [];
  for (let i = 0; i < panels.length; i++) {
    const p = panels[i];
    if (p.type === 'row') {
      // Peek ahead: is there at least one non-row panel before the next row / end?
      let hasChild = false;
      for (let j = i + 1; j < panels.length && panels[j].type !== 'row'; j++) {
        hasChild = true;
        break;
      }
      if (hasChild) out.push(p);
    } else {
      out.push(p);
    }
  }
  return out;
}

/**
 * Build the public dashboard from the grand one.
 */
function buildPublic(grand) {
  const d = clone(grand);

  // Flatten: the grand dashboard keeps panels at the top level with row markers (collapsed:
  // false), so we work on the flat d.panels array.
  let panels = d.panels || [];

  // Drop the two rows (and their child panels) that can't/shouldn't be public:
  //   - "PLAY CLOUD YATRA" (the Video panel game embed): the game is already on the page.
  //   - "your RUN" (per-session): needs the `session` variable, impossible on public.
  // Rows are flat markers; a row "owns" every panel until the next row marker.
  const dropRowTitles = [/PLAY CLOUD YATRA/i, /YOUR RUN/i];
  const kept = [];
  let dropping = false;
  for (const p of panels) {
    if (panelIsRow(p)) {
      dropping = dropRowTitles.some((re) => re.test(p.title || ''));
      if (!dropping) kept.push(p);
      continue;
    }
    if (!dropping) kept.push(p);
  }
  panels = kept;

  // Replace the source's header text panel(s) at y=0 with the public branded header.
  panels = panels.filter((p) => !(p.type === 'text' && p.gridPos && p.gridPos.y === 0));

  // Keep only panels that actually render on a Grafana Cloud public dashboard. Public
  // dashboards expose a limited datasource set: the Infinity datasource (our D1 analytics)
  // works, but Prometheus/Loki/Tempo queries are withheld on public shares, so those panels
  // would render empty/error. We drop them here so the public embed is complete and clean;
  // the full multi-signal view lives in the authenticated source dashboard. Row markers and
  // text panels are always kept (emptied rows are pruned below).
  const PUBLIC_OK = new Set(['yesoreyeram-infinity-datasource']);
  const publicRenderable = (p) => {
    if (p.type === 'row' || p.type === 'text') return true;
    const t = p.datasource && (p.datasource.type || '');
    // panels with no datasource (e.g. pure text) or an Infinity datasource are fine
    if (!t) return true;
    return PUBLIC_OK.has(t);
  };
  panels = panels.filter(publicRenderable);

  // Prune rows that have no child panels after the datasource filter.
  panels = pruneEmptyRows(panels);

  // Substitute literals (api_base_url, faro_app_id) and wire datasources by name, and strip
  // any links that would bounce a public viewer to a Grafana login wall.
  panels = panels.map((p) => stripPrivateLinks(wireDatasources(substituteLiterals(p))));

  // Lay the public copy out explicitly, section by section, each with a one-line caption.
  const finalPanels = layoutPublic(panels);

  d.panels = finalPanels;
  d.uid = 'cloud-yatra';
  d.title = 'Cloud Yatra · Live Observatory';
  // Public dashboards can't use template variables, so strip them all.
  d.templating = { list: [] };
  // Keep annotations minimal (the built-in only).
  delete d.__inputs;
  delete d.__requires;
  d.tags = ['cloud-yatra', 'observability', 'nepal'];
  d.refresh = '30s';
  d.time = { from: 'now-1h', to: 'now' };
  return d;
}

// --- run ------------------------------------------------------------------------------
// Canonical SOURCE: the rich, authenticated master (game embed + per-session your RUN +
// every signal, with datasource template inputs for a normal "map datasources" import).
const SOURCE = 'cloud-yatra-observatory.json';
const grand = JSON.parse(readFileSync(path.join(dir, SOURCE), 'utf8'));
const pub = buildPublic(grand);
writeFileSync(path.join(dir, 'cloud-yatra-observatory-public.json'), JSON.stringify(pub, null, 2) + '\n');

let n = 0;
(function w(ps) { for (const p of ps || []) { if (p.type !== 'row') n++; if (p.panels) w(p.panels); } })(pub.panels);
console.log(`Source:   ${SOURCE}`);
console.log(`Built:    cloud-yatra-observatory-public.json → uid=${pub.uid}, ${n} data panels, ${pub.panels.length} total.`);
