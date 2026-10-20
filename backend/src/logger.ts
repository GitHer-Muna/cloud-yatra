/**
 * logger.ts — structured JSON logging + optional Grafana Cloud push (logs & traces).
 *
 * Every request gets a correlationId. Logs are emitted as single-line JSON to the console
 * (captured by Cloudflare Workers Logs) AND, when GRAFANA_LOKI_* is configured, pushed to
 * Grafana Cloud Loki. A minimal OTLP trace span is pushed when GRAFANA_OTLP_* is set.
 *
 * All pushes are best-effort and fire via ctx.waitUntil so they never block or fail the
 * user response. Secrets come from env and are never logged.
 */
import type { Env } from './env';

export type Level = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  [key: string]: unknown;
}

export class Logger {
  private readonly base: LogFields;
  private readonly lokiLines: Array<[string, string]> = []; // [ts_ns, line]

  constructor(
    private readonly env: Env,
    private readonly ctx: ExecutionContext,
    base: LogFields,
  ) {
    this.base = base;
  }

  log(level: Level, msg: string, fields: LogFields = {}): void {
    const entry = {
      level,
      msg,
      service: this.env.SERVICE_NAME ?? 'cloud-yatra-api',
      env: this.env.ENVIRONMENT ?? 'production',
      time: new Date().toISOString(),
      ...this.base,
      ...fields,
    };
    const line = JSON.stringify(entry);
    // Console → Cloudflare Workers Logs.
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
    // Buffer for the Loki push (flushed once per request).
    this.lokiLines.push([`${Date.now()}000000`, line]);
  }

  info(msg: string, fields?: LogFields): void {
    this.log('info', msg, fields);
  }
  warn(msg: string, fields?: LogFields): void {
    this.log('warn', msg, fields);
  }
  error(msg: string, fields?: LogFields): void {
    this.log('error', msg, fields);
  }

  /** Flush buffered logs to Grafana Cloud Loki (best-effort, non-blocking). */
  flushLoki(extraLabels: Record<string, string> = {}): void {
    const { GRAFANA_LOKI_URL, GRAFANA_LOKI_USER, GRAFANA_LOKI_TOKEN } = this.env;
    if (!GRAFANA_LOKI_URL || !GRAFANA_LOKI_TOKEN || this.lokiLines.length === 0) return;

    const labels: Record<string, string> = {
      service_name: this.env.SERVICE_NAME ?? 'cloud-yatra-api',
      env: this.env.ENVIRONMENT ?? 'production',
      source: 'worker',
      ...extraLabels,
    };
    const body = JSON.stringify({
      streams: [{ stream: labels, values: this.lokiLines.map(([ts, line]) => [ts, line]) }],
    });
    const auth = GRAFANA_LOKI_USER
      ? 'Basic ' + btoa(`${GRAFANA_LOKI_USER}:${GRAFANA_LOKI_TOKEN}`)
      : `Bearer ${GRAFANA_LOKI_TOKEN}`;
    this.ctx.waitUntil(
      fetch(GRAFANA_LOKI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body,
      }).catch(() => undefined),
    );
  }
}

/** Generate a random hex id (used for trace/span ids and correlation ids). */
export function hexId(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Push a single OTLP trace span to Grafana Cloud Tempo (best-effort, non-blocking).
 * Represents the request as one span with route/status/duration attributes.
 */
export function pushTrace(
  env: Env,
  ctx: ExecutionContext,
  span: {
    traceId: string;
    spanId: string;
    name: string;
    startMs: number;
    endMs: number;
    attributes: Record<string, string | number>;
    status: 'ok' | 'error';
  },
): void {
  const { GRAFANA_OTLP_URL, GRAFANA_OTLP_USER, GRAFANA_OTLP_TOKEN } = env;
  if (!GRAFANA_OTLP_URL || !GRAFANA_OTLP_TOKEN) return;

  const attrs = Object.entries(span.attributes).map(([key, value]) => ({
    key,
    value: typeof value === 'number' ? { intValue: Math.round(value) } : { stringValue: String(value) },
  }));

  const body = JSON.stringify({
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: env.SERVICE_NAME ?? 'cloud-yatra-api' } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: 'cloud-yatra-api' },
            spans: [
              {
                traceId: span.traceId,
                spanId: span.spanId,
                name: span.name,
                kind: 2, // SERVER
                startTimeUnixNano: `${Math.round(span.startMs)}000000`,
                endTimeUnixNano: `${Math.round(span.endMs)}000000`,
                attributes: attrs,
                status: { code: span.status === 'error' ? 2 : 1 },
              },
            ],
          },
        ],
      },
    ],
  });
  const auth = GRAFANA_OTLP_USER
    ? 'Basic ' + btoa(`${GRAFANA_OTLP_USER}:${GRAFANA_OTLP_TOKEN}`)
    : `Bearer ${GRAFANA_OTLP_TOKEN}`;
  const url = GRAFANA_OTLP_URL.replace(/\/$/, '') + '/v1/traces';
  ctx.waitUntil(
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body,
    }).catch(() => undefined),
  );
}
