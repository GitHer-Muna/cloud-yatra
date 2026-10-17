/**
 * logger.ts — structured JSON logging for Lambda (→ CloudWatch → Loki later).
 *
 * One JSON object per line. Fields are bounded/low-cardinality where they'll become
 * metric labels (route, status_class). `sessionId`/`correlationId` are LOG fields only,
 * never metric labels. Production logs at info level (no debug spam) to keep volume —
 * and therefore Grafana Cloud cost — low.
 */
type Level = 'info' | 'warn' | 'error';

const isProd = process.env.NODE_ENV === 'production' || process.env.LOG_LEVEL === 'info';

export interface LogContext {
  correlationId?: string;
  route?: string;
  sessionId?: string;
  [k: string]: unknown;
}

function write(level: Level, msg: string, ctx: LogContext): void {
  const line = JSON.stringify({ level, msg, ts: new Date().toISOString(), ...ctx });
  // eslint-disable-next-line no-console
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  info: (msg: string, ctx: LogContext = {}) => write('info', msg, ctx),
  warn: (msg: string, ctx: LogContext = {}) => write('warn', msg, ctx),
  error: (msg: string, ctx: LogContext = {}) => write('error', msg, ctx),
  // debug is suppressed in production to control log volume/cost.
  debug: (msg: string, ctx: LogContext = {}) => {
    if (!isProd) write('info', `[debug] ${msg}`, ctx);
  },
};
