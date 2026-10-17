/**
 * leaderboard.ts — GET /leaderboard?level=&limit=. Returns the top N scores for a
 * level. Uses a DynamoDB Query on PK=LEVEL#<level>, with SK sorted ascending — and
 * because we store a zero-padded (1_000_000 - score) key, ascending SK = highest score
 * first. No scan, no GSI. Bounded, cheap.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from '../lib/db';
import { getCorrelationId } from '../lib/correlation';
import { ok, fail } from '../lib/response';
import { log } from '../lib/logger';

const MAX_LIMIT = 25;
const LEVEL_RE = /^[a-z0-9_]{1,32}$/;

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const correlationId = getCorrelationId(event.headers ?? {});
  const route = '/leaderboard';
  const q = event.queryStringParameters ?? {};
  const level = q.level ?? 'himal_rajya';
  const limit = Math.min(Math.max(parseInt(q.limit ?? '10', 10) || 10, 1), MAX_LIMIT);

  if (!LEVEL_RE.test(level)) {
    log.warn('bad_level', { route, correlationId, status: 400 });
    return fail(400, 'bad_level', correlationId);
  }

  try {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': `LEVEL#${level}`, ':sk': 'SCORE#' },
        ScanIndexForward: true, // ascending SK = highest score first (padded key)
        Limit: limit,
      }),
    );
    const entries = (res.Items ?? []).map((it) => ({
      name: (it.name as string) ?? 'Anonymous Yatri',
      score: it.score as number,
      timeMs: it.timeMs as number,
      ts: it.ts as number,
    }));
    log.info('leaderboard_read', { route, correlationId, status: 200, level, count: entries.length });
    return ok({ level, entries }, correlationId);
  } catch (err) {
    log.error('leaderboard_failed', {
      route,
      correlationId,
      status: 500,
      err: err instanceof Error ? err.message : 'unknown',
    });
    return fail(500, 'leaderboard_error', correlationId);
  }
};
