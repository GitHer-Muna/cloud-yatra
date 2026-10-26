#!/usr/bin/env node
/**
 * build-dashboard.mjs — generate the ONE canonical Cloud Yatra dashboard.
 *
 * There is a single source of truth: `cloud-yatra-observatory.json` (rich, every signal,
 * every signal). This script derives the PUBLIC, embeddable dashboard from it so we never
 * hand-maintain two files. It writes:
 *   - cloud-yatra-observatory.json         (canonical: datasource template vars kept for a
 *                                           normal authenticated import / "map datasources")
 *   - cloud-yatra-observatory-public.json  (public-share ready: no template vars, datasource
 *                                           refs wired to this stack's names, hardcoded URLs)
 *
 * Public dashboards (Grafana "Share externally") CANNOT use template variables, so for the
 * public copy we:
 *   - drop the game Video panel + the per-session "YOUR RUN" row (per-player belongs in the
 *     game page, which knows the session; public dashboards can't filter per viewer),
 *   - inline `${api_base_url}` and `$faro_app_id` to literals,
 *   - replace `${DS_*}` datasource refs with this stack's real datasource names,
 *   - reflow the grid so the remaining rows are contiguous (no gaps from removed rows).
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

/** The branded header (Nepal dawn gradient), operator-voiced, non-AI. */
function headerPanel(id) {
  const content =
    '<div style="padding:14px 18px;' +
    'background:linear-gradient(90deg,#0b1020 0%,#20357a 38%,#8e2b2b 68%,#f6b73c 100%);' +
    'border-radius:12px;color:#fff;font-family:system-ui,sans-serif">' +
    '<div style="display:flex;align-items:center;gap:14px">' +
    '<div style="font-size:34px;line-height:1">🏔️</div>' +
    '<div><div style="font-size:21px;font-weight:800;letter-spacing:.3px">Cloud Yatra · Live Observatory</div>' +
    '<div style="opacity:.92;font-size:12.5px;margin-top:3px">Every panel below is real traffic from a little ' +
    'platformer about a Nepali traveller climbing from the jungle to the Himalaya. ' +
    'Play the game above — then watch these numbers move.</div></div></div>' +
    '<div style="margin-top:10px;font-size:11.5px;opacity:.85;line-height:1.5">' +
    'How to read it: <b>At a glance</b> is the headline. <b>The climb</b> shows how far players get ' +
    '(a classic funnel). <b>Yatri\'s journey</b> breaks down what happens on the trail. ' +
    '<b>Scores</b> is the shared leaderboard, <b>Around the world</b> maps where people play, and ' +
    '<b>Chaos Mode</b> is where I break my own backend on purpose to watch it recover.</div></div>';
  return {
    id,
    type: 'text',
    title: '',
    gridPos: { h: 5, w: GRID_W, x: 0, y: 0 },
    options: { mode: 'html', content },
    transparent: true,
  };
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
  //   - "PLAY CLOUD YATRA" (the Video panel game embed) — the game is already on the page.
  //   - "YOUR RUN" (per-session) — needs the `session` variable, impossible on public.
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

  // Remove the old header text panel(s) at y=0; we prepend our own branded header.
  panels = panels.filter((p) => !(p.type === 'text' && p.gridPos && p.gridPos.y === 0));

  // Keep ONLY panels that actually render on a Grafana Cloud public dashboard. Public
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

  // Prune rows that no longer have any child panels after the datasource filter.
  panels = pruneEmptyRows(panels);

  // Re-title rows so each section matches the D1-only content it actually holds now (the
  // metric/RUM panels were filtered out, so the source titles like "service pulse" or
  // "frame rate" would be misleading on the public copy). Keyed by the source row title.
  const PUBLIC_ROW_TITLES = {
    'LIVE NOW': 'AT A GLANCE · the climb so far',
    'LIVE GAME PERFORMANCE': 'THE CLIMB · how far pilgrims get',
    "YATRI'S JOURNEY": "YATRI'S JOURNEY · what happens on the trail",
    'SCORES & ENGAGEMENT': 'SCORES · the shared leaderboard',
    'WORLD & CONTEXT': 'AROUND THE WORLD · where pilgrims play',
    'CHAOS MODE': 'CHAOS MODE · fault injection and recovery',
  };
  for (const p of panels) {
    if (p.type !== 'row') continue;
    const key = (p.title || '').split('·')[0].trim();
    if (PUBLIC_ROW_TITLES[key]) p.title = PUBLIC_ROW_TITLES[key];
  }

  // Substitute literals (api_base_url, faro_app_id) and wire datasources by name.
  panels = panels.map((p) => wireDatasources(substituteLiterals(p)));

  // Reflow the grid top-to-bottom so removed rows/panels leave no gaps. We preserve each
  // panel's width/height and its left-to-right order within a row, just re-stacking rows.
  reflow(panels);

  // Prepend the branded header and shift everything down by its height (3).
  const header = headerPanel(1_000_000);
  for (const p of panels) if (p.gridPos) p.gridPos.y += header.gridPos.h;
  const finalPanels = [header, ...panels];

  d.panels = finalPanels;
  d.uid = 'cloud-yatra';
  d.title = 'Cloud Yatra · Live Observatory';
  // Public dashboards can't use template variables — strip them all.
  d.templating = { list: [] };
  // Keep annotations minimal (the built-in only).
  delete d.__inputs;
  delete d.__requires;
  d.tags = ['cloud-yatra', 'observability', 'nepal'];
  d.refresh = '30s';
  d.time = { from: 'now-1h', to: 'now' };
  return d;
}

/**
 * Re-pack rows so there are no vertical gaps. The grand layout is a sequence of row markers
 * each followed by their panels. We keep panel x/w/h, recompute y per row block.
 */
function reflow(panels) {
  // Group into blocks: a row marker + the panels that follow it until the next row.
  let y = 0;
  let i = 0;
  while (i < panels.length) {
    const p = panels[i];
    if (p.type === 'row') {
      p.gridPos = { h: 1, w: GRID_W, x: 0, y };
      y += 1;
      i += 1;
      // Lay out the child panels of this row, preserving their relative y-order and x/w.
      const block = [];
      while (i < panels.length && panels[i].type !== 'row') {
        block.push(panels[i]);
        i += 1;
      }
      // Normalize the block's own y to start at the current y, keeping relative offsets.
      if (block.length) {
        const minY = Math.min(...block.map((b) => b.gridPos?.y ?? 0));
        let maxBottom = y;
        for (const b of block) {
          if (!b.gridPos) b.gridPos = { h: 8, w: 12, x: 0, y: 0 };
          b.gridPos.y = y + (b.gridPos.y - minY);
          maxBottom = Math.max(maxBottom, b.gridPos.y + b.gridPos.h);
        }
        y = maxBottom;
      }
    } else {
      // A stray top-level panel with no preceding row — place it full width.
      if (!p.gridPos) p.gridPos = { h: 8, w: GRID_W, x: 0, y };
      p.gridPos.y = y;
      y += p.gridPos.h;
      i += 1;
    }
  }
}

// --- run ------------------------------------------------------------------------------
// Canonical SOURCE: the rich, authenticated master (game embed + per-session YOUR RUN +
// every signal, with datasource template inputs for a normal "map datasources" import).
const SOURCE = 'cloud-yatra-observatory.json';
const grand = JSON.parse(readFileSync(path.join(dir, SOURCE), 'utf8'));
const pub = buildPublic(grand);
writeFileSync(path.join(dir, 'cloud-yatra-observatory-public.json'), JSON.stringify(pub, null, 2) + '\n');

let n = 0;
(function w(ps) { for (const p of ps || []) { if (p.type !== 'row') n++; if (p.panels) w(p.panels); } })(pub.panels);
console.log(`Source:   ${SOURCE}`);
console.log(`Built:    cloud-yatra-observatory-public.json → uid=${pub.uid}, ${n} data panels, ${pub.panels.length} total.`);
