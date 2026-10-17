/**
 * response.ts — helpers to build API Gateway HTTP API responses.
 *
 * - CORS is locked to the game origin via ALLOWED_ORIGIN env (default '*' for local
 *   dev only; Phase 8 sets the real public origin).
 * - Every response carries the correlationId so a client can tie its action to the
 *   backend request in logs. Errors are SAFE: a short message + reason code, never a
 *   stack trace or internal detail.
 */
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? '*';

function baseHeaders(correlationId: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'access-control-allow-origin': ALLOWED_ORIGIN,
    'access-control-allow-headers': 'content-type,x-correlation-id',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'x-correlation-id': correlationId,
  };
}

export function ok(body: unknown, correlationId: string, statusCode = 200) {
  return { statusCode, headers: baseHeaders(correlationId), body: JSON.stringify(body) };
}

export function accepted(body: unknown, correlationId: string) {
  return ok(body, correlationId, 202);
}

/** Safe error: only a short message + machine reason. No internals leaked. */
export function fail(statusCode: number, reason: string, correlationId: string, message?: string) {
  return {
    statusCode,
    headers: baseHeaders(correlationId),
    body: JSON.stringify({ error: reason, message: message ?? reason, correlationId }),
  };
}

export function noContent(correlationId: string) {
  return { statusCode: 204, headers: baseHeaders(correlationId), body: '' };
}
