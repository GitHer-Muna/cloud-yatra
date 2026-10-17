/**
 * correlation.ts — request correlation IDs.
 *
 * A correlation ID ties one client action to one backend request (and its logs). We
 * accept the client's `x-correlation-id` header if present (so the browser event and
 * the backend log share an ID), otherwise we mint a fresh one. Anonymous + short-lived.
 */
import { randomUUID } from 'node:crypto';

export function getCorrelationId(headers: Record<string, string | undefined> = {}): string {
  // API Gateway lowercases header keys for HTTP APIs.
  const incoming = headers['x-correlation-id'];
  if (incoming && /^[A-Za-z0-9._-]{6,64}$/.test(incoming)) return incoming;
  return randomUUID().replace(/-/g, '').slice(0, 16);
}
