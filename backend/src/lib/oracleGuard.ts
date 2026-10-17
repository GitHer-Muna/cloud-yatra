/**
 * oracleGuard.ts — cost guards for Guru Megh (Bedrock) calls.
 *
 *  - PER-SESSION COOLDOWN: a session may trigger the oracle at most once per
 *    ORACLE_COOLDOWN_MS. Prevents a single player from spamming spend.
 *  - GLOBAL DAILY CAP: total oracle calls per UTC day are capped at ORACLE_DAILY_CALL_CAP.
 *    A hard ceiling on daily Bedrock cost regardless of traffic.
 *
 * Both use the existing single DynamoDB table with TTL, so there is no idle cost and old
 * counters auto-expire. Atomic UpdateCommand avoids race conditions.
 */
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from './db';

const COOLDOWN_MS = Number(process.env.ORACLE_COOLDOWN_MS ?? 8000);
const DAILY_CAP = Number(process.env.ORACLE_DAILY_CALL_CAP ?? 100);

export type GuardResult = { allowed: true } | { allowed: false; reason: 'cooldown' | 'daily_cap' };

/** Short, non-identifying session key (never store the raw session as anything but a key). */
function sessionKey(sessionId: string): string {
  return `ORACLE#SESSION#${sessionId.slice(0, 64)}`;
}
function dayKey(): string {
  return `ORACLE#DAY#${new Date().toISOString().slice(0, 10)}`; // YYYY-MM-DD (UTC)
}

/**
 * Check + record an oracle attempt atomically. Returns allowed:false with a reason if
 * the session is on cooldown or the daily cap is reached. Fails OPEN on infra error
 * (better a rare extra call than a broken feature), but that path is logged by caller.
 */
export async function checkAndRecordOracle(sessionId: string): Promise<GuardResult> {
  const now = Date.now();

  // 1) Per-session cooldown: only write if last call was long enough ago.
  const cooldownTtl = Math.floor(now / 1000) + 3600; // session cooldown item lives 1h
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: sessionKey(sessionId), SK: 'COOLDOWN' },
        UpdateExpression: 'SET lastCallMs = :now, expiresAt = :ttl',
        ConditionExpression: 'attribute_not_exists(lastCallMs) OR lastCallMs < :threshold',
        ExpressionAttributeValues: {
          ':now': now,
          ':threshold': now - COOLDOWN_MS,
          ':ttl': cooldownTtl,
        },
      }),
    );
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      return { allowed: false, reason: 'cooldown' };
    }
    throw err;
  }

  // 2) Global daily cap: atomic increment, then compare.
  const dayTtl = Math.floor(now / 1000) + 2 * 86400; // day counter lives 2 days
  const res = await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: dayKey(), SK: 'COUNT' },
      UpdateExpression: 'ADD calls :one SET expiresAt = :ttl',
      ExpressionAttributeValues: { ':one': 1, ':ttl': dayTtl },
      ReturnValues: 'UPDATED_NEW',
    }),
  );
  const calls = Number((res.Attributes as { calls?: number })?.calls ?? 0);
  if (calls > DAILY_CAP) return { allowed: false, reason: 'daily_cap' };

  return { allowed: true };
}
