/**
 * event.ts — POST /event. Ingests a batch of gameplay telemetry events.
 *
 * Flow:
 *  1. Parse + re-validate the batch server-side (never trust the client).
 *  2. Emit structured logs (one summary line; low volume) with a correlation id.
 *  3. Update small DynamoDB aggregates: a per-session summary (jumps/deaths/completed)
 *     and, on level_completed, a leaderboard entry. On-demand billing; TTL on sessions.
 *  4. Emit EMF-style metric log lines so CloudWatch/Grafana can count events by type
 *     WITHOUT high-cardinality labels (no sessionId/coords as labels).
 *
 * Bedrock is NOT called here. This Lambda has no Bedrock permission (least privilege).
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from '../lib/db';
import { validateBatch } from '../lib/validate';
import { getCorrelationId } from '../lib/correlation';
import { accepted, fail } from '../lib/response';
import { log } from '../lib/logger';
import { applyChaos } from '../lib/chaos';

const SESSION_TTL_DAYS = 2;

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const correlationId = getCorrelationId(event.headers ?? {});
  const route = '/event';

  // Chaos Mode (Phase 7): while an admin-started window is active, this self-inflicts
  // latency or a 503 on a fraction of ingest requests so the dashboard visibly reacts.
  // Inactive windows cost a single cheap DynamoDB GET. Never throws.
  const chaos = await applyChaos();
  if (chaos.fail) {
    log.warn('chaos_injected_error', {
      route,
      correlationId,
      status: 503,
      metric: 'chaos_injected_total',
      kind: 'error',
    });
    return fail(503, 'chaos_injected', correlationId, 'temporary chaos-mode fault');
  }
  if (chaos.delayedMs > 0) {
    log.info('chaos_injected_latency', {
      route,
      correlationId,
      metric: 'chaos_injected_total',
      kind: 'latency',
      delayedMs: chaos.delayedMs,
    });
  }

  let body: unknown;
  try {
    body = event.body ? JSON.parse(event.body) : undefined;
  } catch {
    log.warn('bad_json', { route, correlationId, status: 400 });
    return fail(400, 'bad_json', correlationId);
  }

  const result = validateBatch(body);
  if (!result.ok) {
    log.warn('bad_batch', { route, correlationId, status: 400, reason: result.reason });
    return fail(400, result.reason ?? 'bad_batch', correlationId);
  }

  // Aggregate per session (cheap counters) + capture any completion for leaderboard.
  const counts: Record<string, number> = {};
  let sessionId = '';
  let levelId: string | null = null;
  let completion: { score: number; timeMs: number; name: string } | null = null;

  for (const ev of result.accepted) {
    const type = String(ev.type);
    counts[type] = (counts[type] ?? 0) + 1;
    sessionId = String(ev.sessionId);
    levelId = (ev.levelId as string | null) ?? levelId;
    if (type === 'level_completed') {
      const a = ev.attrs as { score?: number; timeMs?: number; name?: string };
      // Sanitize the player name server-side: printable, short, no control chars.
      const rawName = typeof a.name === 'string' ? a.name : '';
      const name = rawName.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16);
      completion = { score: Number(a.score ?? 0), timeMs: Number(a.timeMs ?? 0), name };
    }
  }

  try {
    if (sessionId) {
      const ttl = Math.floor(Date.now() / 1000) + SESSION_TTL_DAYS * 86400;
      await ddb.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { PK: `SESSION#${sessionId}`, SK: 'SUMMARY' },
          UpdateExpression:
            'ADD jumps :j, deaths :d, collected :c SET levelId = :lvl, expiresAt = :ttl',
          ExpressionAttributeValues: {
            ':j': counts['player_jump'] ?? 0,
            ':d': counts['player_died'] ?? 0,
            ':c': counts['collectible_collected'] ?? 0,
            ':lvl': levelId ?? 'unknown',
            ':ttl': ttl,
          },
        }),
      );
    }

    if (completion && sessionId && levelId) {
      // Zero-padded descending score key so a Query returns top scores first.
      const scoreKey = String(1_000_000 - Math.min(completion.score, 999_999)).padStart(7, '0');
      await ddb.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            PK: `LEVEL#${levelId}`,
            SK: `SCORE#${scoreKey}#${sessionId}`,
            score: completion.score,
            timeMs: completion.timeMs,
            name: completion.name || 'Anonymous Yatri',
            ts: Date.now(),
          },
        }),
      );
    }
  } catch (err) {
    // Persistence failure must not crash ingest; log and still 202 the client.
    log.error('persist_failed', {
      route,
      correlationId,
      status: 202,
      err: err instanceof Error ? err.message : 'unknown',
    });
  }

  // EMF-ish metric line: one per event type, bounded labels only.
  for (const [type, n] of Object.entries(counts)) {
    log.info('event_metric', { route, correlationId, metric: 'game_events_total', type, level: levelId ?? 'unknown', count: n });
  }

  log.info('event_ingested', {
    route,
    correlationId,
    status: 202,
    accepted: result.accepted.length,
    dropped: result.dropped,
  });
  return accepted({ accepted: result.accepted.length, dropped: result.dropped }, correlationId);
};
