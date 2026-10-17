/**
 * oracle.ts — POST /oracle (Guru Megh). Phase 6: wired to Amazon Bedrock.
 *
 * Flow:
 *  1. If DISABLE_ORACLE=true → return the canned fallback, NO Bedrock call (zero cost).
 *  2. Parse a BOUNDED, privacy-safe context (no PII). Require a sessionId for guards.
 *  3. Cost guards: per-session cooldown + global daily cap (oracleGuard).
 *  4. Call Bedrock Converse (Nova Lite) with tight token caps.
 *  5. On ANY failure (guard, Bedrock, parse) → safe in-character fallback, never a 500.
 *
 * This is the ONLY Lambda with bedrock:InvokeModel permission (least privilege).
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { getCorrelationId } from '../lib/correlation';
import { ok, fail } from '../lib/response';
import { log } from '../lib/logger';
import { askGuruMegh, ORACLE_MODEL_ID, type OracleContext } from '../lib/bedrock';
import { checkAndRecordOracle } from '../lib/oracleGuard';
import { applyChaos } from '../lib/chaos';

const ROUTE = '/oracle';

const USE_CASES = ['welcome', 'death', 'completed', 'hint', 'celebrate'] as const;
const LEVEL_IDS = ['terai', 'hills', 'himal', 'himal_rajya'] as const;
const RECENT_EVENTS = [
  'game_started',
  'level_started',
  'player_died',
  'level_completed',
  'checkpoint_reached',
  'journey_progress',
  'found_prayer_bell',
  'combo_streak',
  'garland_completed',
  'eagle_defeated',
] as const;
const DEATH_REASONS = [
  'fall',
  'eagle',
  'rockfall',
  'monkey',
  'mist',
  'thorn',
  'bamboo',
  'nettle',
  'khar',
  'lahara',
] as const;

// In-character fallbacks (used when disabled, rate-limited, or on any error).
const FALLBACKS: Record<string, string> = {
  welcome: 'Welcome, Yatri. Follow the pennants through this region and keep moving toward the END flag.',
  death: 'Even the river falls before it flows onward. Your pennant gives you a way back—rise and continue toward END.',
  completed: 'One region is crossed with grace. Follow the next trail and keep the journey moving toward the summit.',
  hint: 'Watch the drifting mist, use your khukuri when the path is tangled, and keep going toward the next pennant.',
  celebrate: 'Wonderful, Yatri! Every small triumph lights the trail ahead—Guru Megh cheers you on. Keep going!',
  default: 'Guru Megh watches from the clouds. Keep moving, traveler—the next pennant and END flag await.',
};

function fallbackFor(useCase?: string): string {
  return FALLBACKS[useCase ?? 'default'] ?? FALLBACKS.default;
}

/** Parse + bound the incoming context. Only known, non-PII fields are kept. */
export function parseContext(body: unknown): { ctx: OracleContext; sessionId: string } {
  const b = (typeof body === 'object' && body ? body : {}) as Record<string, unknown>;
  const bounded = (v: unknown, max = 40): string | undefined =>
    typeof v === 'string' ? v.slice(0, max).replace(/[^\w:.-]/g, '') : undefined;
  const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined => {
    const value = bounded(v);
    return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
  };
  const ctx: OracleContext = {
    useCase: oneOf(b.useCase, USE_CASES) ?? 'hint',
    levelId: oneOf(b.levelId, LEVEL_IDS) ?? null,
    recentEvent: oneOf(b.recentEvent, RECENT_EVENTS),
    deathReason: oneOf(b.deathReason, DEATH_REASONS) ?? null,
    attempts:
      typeof b.attempts === 'number' && Number.isFinite(b.attempts) && b.attempts >= 0
        ? Math.min(Math.floor(b.attempts), 20)
        : null,
  };
  const sessionId = bounded(b.sessionId, 64) ?? '';
  return { ctx, sessionId };
}

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const correlationId = getCorrelationId(event.headers ?? {});

  // Chaos Mode (Phase 7): self-inflict latency / a 503 on a fraction of oracle requests
  // while a window is active, so the dashboard shows the oracle path degrading too. A
  // chaos error returns 503 here BEFORE any Bedrock call, so it never costs model spend.
  const chaos = await applyChaos();
  if (chaos.fail) {
    log.warn('chaos_injected_error', {
      route: ROUTE,
      correlationId,
      status: 503,
      metric: 'chaos_injected_total',
      kind: 'error',
    });
    return fail(503, 'chaos_injected', correlationId, 'temporary chaos-mode fault');
  }
  if (chaos.delayedMs > 0) {
    log.info('chaos_injected_latency', {
      route: ROUTE,
      correlationId,
      metric: 'chaos_injected_total',
      kind: 'latency',
      delayedMs: chaos.delayedMs,
    });
  }

  let body: unknown;
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    body = {};
  }
  const { ctx, sessionId } = parseContext(body);

  // 1) Dev/cost kill-switch: canned response, no Bedrock spend.
  if (process.env.DISABLE_ORACLE === 'true') {
    log.info('oracle_disabled', { route: ROUTE, correlationId, status: 200, disabled: true });
    return ok({ text: fallbackFor(ctx.useCase), source: 'fallback' }, correlationId);
  }

  // Need a session to apply per-session guards; if absent, still serve a fallback.
  if (!sessionId || sessionId.length < 8) {
    return ok({ text: fallbackFor(ctx.useCase), source: 'fallback' }, correlationId);
  }

  // 2) Cost guards (cooldown + daily cap).
  try {
    const guard = await checkAndRecordOracle(sessionId);
    if (!guard.allowed) {
      log.info('oracle_rate_limited', {
        route: ROUTE,
        correlationId,
        status: 200,
        reason: guard.reason,
      });
      return ok({ text: fallbackFor(ctx.useCase), source: 'fallback', reason: guard.reason }, correlationId);
    }
  } catch (err) {
    // Guard infra error → serve fallback (do not call Bedrock without a working guard).
    log.error('oracle_guard_failed', {
      route: ROUTE,
      correlationId,
      status: 200,
      err: err instanceof Error ? err.message : 'unknown',
    });
    return ok({ text: fallbackFor(ctx.useCase), source: 'fallback' }, correlationId);
  }

  // 3) Call Bedrock.
  const bedrockStartedAt = Date.now();
  try {
    const result = await askGuruMegh(ctx);
    const text = result.text || fallbackFor(ctx.useCase);
    log.info('oracle_answered', {
      route: ROUTE,
      correlationId,
      status: 200,
      model: ORACLE_MODEL_ID,
      useCase: ctx.useCase,
      level: ctx.levelId,
      latencyMs: Date.now() - bedrockStartedAt,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    });
    return ok({ text, source: 'bedrock' }, correlationId);
  } catch (err) {
    log.error('oracle_bedrock_failed', {
      route: ROUTE,
      correlationId,
      status: 200,
      useCase: ctx.useCase,
      level: ctx.levelId,
      latencyMs: Date.now() - bedrockStartedAt,
      err: err instanceof Error ? err.message : 'unknown',
    });
    return ok({ text: fallbackFor(ctx.useCase), source: 'fallback' }, correlationId);
  }
};
