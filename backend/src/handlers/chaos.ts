/**
 * chaos.ts (handler) — POST /chaos/start and POST /chaos/stop (Phase 7).
 *
 * An ADMIN-TOKEN-GATED switch that turns Chaos Mode on/off. When on, OUR OWN ingest and
 * oracle Lambdas inject temporary latency/errors for a bounded, auto-expiring window so
 * the Grafana dashboard visibly reacts (latency + 5xx) and then recovers. It is
 * SELF-ONLY — it never perturbs any external service.
 *
 * SAFETY:
 *  - Refuses unless a server-side CHAOS_ADMIN_TOKEN is configured AND matches the body.
 *  - The window length is clamped (≤ MAX_CHAOS_SECONDS) and auto-expires via a stored
 *    end time (plus a DynamoDB TTL), so chaos can never run away.
 *  - Emits a structured `chaos_annotation` log at start/stop for Grafana annotations.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { getCorrelationId } from '../lib/correlation';
import { ok, fail } from '../lib/response';
import { log } from '../lib/logger';
import { startChaos, stopChaos, clampSeconds, getChaosState } from '../lib/chaos';

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const correlationId = getCorrelationId(event.headers ?? {});
  const route = event.rawPath ?? '/chaos';
  const adminToken = process.env.CHAOS_ADMIN_TOKEN;

  let body: { adminToken?: string; seconds?: number } = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return fail(400, 'bad_json', correlationId);
  }

  // Admin gate. If no token is configured server-side, refuse (safe default).
  if (!adminToken || body.adminToken !== adminToken) {
    log.warn('chaos_denied', { route, correlationId, status: 401 });
    return fail(401, 'unauthorized', correlationId);
  }

  const isStop = route.endsWith('/stop');

  try {
    if (isStop) {
      await stopChaos();
      // Annotation-ready log: the dashboard can mark "chaos ended" here.
      log.info('chaos_annotation', {
        route,
        correlationId,
        status: 200,
        chaosEvent: 'stop',
        metric: 'chaos_active',
        active: 0,
      });
      return ok({ status: 'stopped', active: false }, correlationId);
    }

    const seconds = clampSeconds(body.seconds);
    const until = await startChaos(seconds);
    // Annotation-ready log: the dashboard can mark "chaos started" here.
    log.info('chaos_annotation', {
      route,
      correlationId,
      status: 200,
      chaosEvent: 'start',
      metric: 'chaos_active',
      active: 1,
      seconds,
      until,
    });
    return ok({ status: 'started', active: true, seconds, until }, correlationId);
  } catch (err) {
    // Never leak internals; report a generic failure.
    log.error('chaos_failed', {
      route,
      correlationId,
      status: 500,
      err: err instanceof Error ? err.message : 'unknown',
    });
    // Best-effort: report current state so the caller isn't left guessing.
    const state = await getChaosState().catch(() => ({ active: false, until: 0 }));
    return fail(500, 'chaos_failed', correlationId, `active=${state.active}`);
  }
};
