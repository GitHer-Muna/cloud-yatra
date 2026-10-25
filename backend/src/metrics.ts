/**
 * metrics.ts — a tiny Prometheus-text metrics registry exposed at GET /metrics.
 *
 * Workers are stateless and short-lived, so these counters reflect the CURRENT isolate's
 * lifetime (good enough for a live demo and for a Grafana scrape/agent to rate()). The
 * durable, authoritative counts live in D1 and are surfaced via GET /stats.
 *
 * Low cardinality by design: labels are bounded (route, status_class, type, cause). No
 * raw session ids, coordinates, or unbounded values are ever used as labels.
 */
type Labels = Record<string, string>;

interface Counter {
  help: string;
  type: 'counter' | 'gauge';
  values: Map<string, { labels: Labels; value: number }>;
}

interface Histogram {
  help: string;
  buckets: number[];
  counts: Map<
    string,
    {
      labels: Labels;
      counts: number[];
      sum: number;
      total: number;
      // Most-recent exemplar per bucket (the sampled trace that "exemplifies" a value in
      // that bucket), so the Prometheus `_bucket` line can carry a `# {trace_id=...}`
      // suffix and a latency panel can jump straight to that trace in Tempo.
      exemplars: Array<{ traceId: string; value: number; tsMs: number } | null>;
    }
  >;
}

const counters = new Map<string, Counter>();
const histograms = new Map<string, Histogram>();

function keyOf(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join(',');
}

function counter(name: string, help: string, type: 'counter' | 'gauge' = 'counter'): Counter {
  let c = counters.get(name);
  if (!c) {
    c = { help, type, values: new Map() };
    counters.set(name, c);
  }
  return c;
}

export function inc(name: string, labels: Labels = {}, help = '', by = 1): void {
  const c = counter(name, help);
  const k = keyOf(labels);
  const cur = c.values.get(k);
  if (cur) cur.value += by;
  else c.values.set(k, { labels, value: by });
}

export function setGauge(name: string, value: number, labels: Labels = {}, help = ''): void {
  const c = counter(name, help, 'gauge');
  c.values.set(keyOf(labels), { labels, value });
}

const DEFAULT_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500];

export function observe(
  name: string,
  value: number,
  labels: Labels = {},
  help = '',
  exemplarTraceId?: string,
): void {
  let h = histograms.get(name);
  if (!h) {
    h = { help, buckets: DEFAULT_BUCKETS, counts: new Map() };
    histograms.set(name, h);
  }
  const k = keyOf(labels);
  let row = h.counts.get(k);
  if (!row) {
    row = {
      labels,
      counts: new Array(h.buckets.length).fill(0),
      sum: 0,
      total: 0,
      exemplars: new Array(h.buckets.length).fill(null),
    };
    h.counts.set(k, row);
  }
  row.total += 1;
  row.sum += value;
  // Record counts and, if a trace id is supplied, attach the exemplar to the first
  // (smallest-le) bucket that contains this value — the bucket a viewer would click.
  let exemplarPlaced = false;
  for (let i = 0; i < h.buckets.length; i++) {
    if (value <= h.buckets[i]) {
      row.counts[i] += 1;
      if (exemplarTraceId && !exemplarPlaced) {
        row.exemplars[i] = { traceId: exemplarTraceId, value, tsMs: Date.now() };
        exemplarPlaced = true;
      }
    }
  }
}

function fmtLabels(labels: Labels): string {
  const keys = Object.keys(labels);
  if (keys.length === 0) return '';
  return (
    '{' +
    keys
      .map((k) => `${k}="${String(labels[k]).replace(/"/g, '\\"')}"`)
      .join(',') +
    '}'
  );
}

/** Render the full registry as Prometheus text exposition format. */
export function renderMetrics(): string {
  const lines: string[] = [];
  for (const [name, c] of counters) {
    if (c.help) lines.push(`# HELP ${name} ${c.help}`);
    lines.push(`# TYPE ${name} ${c.type}`);
    for (const { labels, value } of c.values.values()) {
      lines.push(`${name}${fmtLabels(labels)} ${value}`);
    }
  }
  for (const [name, h] of histograms) {
    if (h.help) lines.push(`# HELP ${name} ${h.help}`);
    lines.push(`# TYPE ${name} histogram`);
    for (const row of h.counts.values()) {
      let cumulative = 0;
      for (let i = 0; i < h.buckets.length; i++) {
        cumulative = row.counts[i];
        const ex = row.exemplars[i];
        // OpenMetrics exemplar suffix: `# {trace_id="..."} <value> <unix_seconds>`.
        // Grafana/Prometheus parse this to render a clickable point that links to the
        // trace (when the Prometheus datasource has an Exemplars → Tempo internal link).
        const exemplar = ex
          ? ` # {trace_id="${ex.traceId}"} ${ex.value} ${(ex.tsMs / 1000).toFixed(3)}`
          : '';
        lines.push(
          `${name}_bucket${fmtLabels({ ...row.labels, le: String(h.buckets[i]) })} ${cumulative}${exemplar}`,
        );
      }
      lines.push(`${name}_bucket${fmtLabels({ ...row.labels, le: '+Inf' })} ${row.total}`);
      lines.push(`${name}_sum${fmtLabels(row.labels)} ${row.sum}`);
      lines.push(`${name}_count${fmtLabels(row.labels)} ${row.total}`);
    }
  }
  return lines.join('\n') + '\n';
}
