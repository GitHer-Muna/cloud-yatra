#!/usr/bin/env node
/**
 * make-preset-dashboards.mjs — generate "preset" copies of the dashboards whose datasources
 * are already wired by Grafana Cloud's STANDARD datasource NAMES, so importing them shows no
 * "map your datasources" screen. This removes the only per-import decision step.
 *
 * How it works:
 *   - Grafana resolves a panel `datasource.uid` that equals a datasource NAME to that
 *     datasource at import time (name is accepted as a uid alias). So instead of the
 *     `${DS_*}` template-input placeholders (which trigger the mapping prompt), each panel
 *     points directly at the conventional Grafana Cloud datasource name.
 *   - The `__inputs` block and the datasource-type template variables are removed (they are
 *     what Grafana shows the mapping UI for). Textbox variables (faro_app_id, api_base_url,
 *     session) are preserved.
 *
 * Default name map = Grafana Cloud free-tier single-stack conventions. If a name differs in
 * your stack, pass overrides, e.g.:
 *   node make-preset-dashboards.mjs --prom=grafanacloud-myx-prom --infinity="My Infinity"
 *
 * Output: *-preset.json next to each source dashboard. Sources are left untouched.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const dashDir = path.resolve(here, '..', 'observability', 'dashboards');

// --- parse simple --key=value overrides ------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a, true];
  }),
);

// Grafana stack datasource NAMES. Defaults are THIS project's stack (curioushalibut2108),
// as recorded in the project state. Override via flags for a different stack, e.g.:
//   node make-preset-dashboards.mjs --prom=grafanacloud-myx-prom --infinity="My Infinity"
const NAMES = {
  prom: args.prom || 'grafanacloud-curioushalibut2108-prom',
  faro: args.faro || 'grafanacloud-curioushalibut2108-logs', // Faro logs land in the stack's Loki
  backendLogs: args['backend-logs'] || 'grafanacloud-curioushalibut2108-logs',
  tempo: args.tempo || 'grafanacloud-curioushalibut2108-traces',
  infinity: args.infinity || 'grafanacloud-infinity',
};

// Map each ${DS_*} placeholder uid to its concrete datasource name.
const DS_TO_NAME = {
  '${DS_PROM}': NAMES.prom,
  '${DS_FARO}': NAMES.faro,
  '${DS_BACKEND_LOGS}': NAMES.backendLogs,
  '${DS_TEMPO}': NAMES.tempo,
  '${DS_INFINITY}': NAMES.infinity,
};

/** Recursively rewrite datasource.uid placeholders to concrete names. */
function rewrite(node) {
  if (Array.isArray(node)) return node.map(rewrite);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === 'datasource' && v && typeof v === 'object' && typeof v.uid === 'string' && DS_TO_NAME[v.uid]) {
        out.datasource = { type: v.type, uid: DS_TO_NAME[v.uid] };
      } else {
        out[k] = rewrite(v);
      }
    }
    return out;
  }
  // Also catch any bare string occurrences of the placeholder (e.g. inside expressions).
  if (typeof node === 'string' && DS_TO_NAME[node]) return DS_TO_NAME[node];
  return node;
}

function makePreset(srcFile, outFile) {
  const src = JSON.parse(readFileSync(srcFile, 'utf8'));

  // Drop the import-mapping inputs; keep everything else.
  delete src.__inputs;

  // Remove datasource-type template variables (their only job was the mapping UI); keep
  // textbox variables (faro_app_id, api_base_url, session).
  if (src.templating?.list) {
    src.templating.list = src.templating.list.filter((v) => v.type !== 'datasource');
  }

  const out = rewrite(src);

  // A preset must not re-declare the template inputs, and gets a distinct uid/title so it
  // imports alongside the originals without clobbering them.
  if (out.uid) out.uid = `${out.uid}-preset`;
  if (out.title) out.title = `${out.title} (preset)`;

  writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
  return { panels: countPanels(out), uid: out.uid };
}

function countPanels(d) {
  let n = 0;
  const walk = (ps) => {
    for (const p of ps || []) {
      n += 1;
      if (p.panels) walk(p.panels);
    }
  };
  walk(d.panels);
  return n;
}

const jobs = [
  ['cloud-yatra-grand-observatory.json', 'cloud-yatra-grand-observatory-preset.json'],
  ['cloud-yatra-live-observatory-public.json', 'cloud-yatra-live-observatory-public-preset.json'],
];

console.log('Datasource name map:', NAMES);
for (const [inp, outp] of jobs) {
  const r = makePreset(path.join(dashDir, inp), path.join(dashDir, outp));
  console.log(`  ${outp}  → uid=${r.uid}, panels=${r.panels}`);
}
