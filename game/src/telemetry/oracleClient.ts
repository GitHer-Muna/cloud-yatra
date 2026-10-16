/**
 * oracleClient.ts — asks the backend Guru Megh (Bedrock) for a short in-character line.
 *
 * Privacy-safe: sends only a bounded context (useCase, levelId, recentEvent, deathReason,
 * attempts) + the anonymous sessionId. Never blocks gameplay: returns a local fallback
 * on any error/timeout so the dialogue always shows something.
 */

export interface OracleAsk {
  useCase: 'welcome' | 'death' | 'completed' | 'hint';
  sessionId: string;
  levelId?: string | null;
  recentEvent?: string;
  deathReason?: string | null;
  attempts?: number | null;
}

const LOCAL_FALLBACKS: Record<string, string> = {
  welcome: 'Namaste, Yatri. Follow the pennants through this region and keep moving toward the END flag.',
  death: 'Even the river falls before it flows onward. Your pennant gives you a way back—rise and continue toward END.',
  completed: 'One region is crossed with grace. Follow the next trail and keep the journey moving toward the summit.',
  hint: 'Watch the drifting mist, use your khukuri when the path is tangled, and keep going toward the next pennant.',
};

export type OracleSource = 'bedrock' | 'fallback';

export interface OracleResponse {
  text: string;
  source: OracleSource;
  latencyMs: number;
}

function fallbackResponse(text: string, startedAt: number, source: OracleSource = 'fallback'): OracleResponse {
  return { text, source, latencyMs: Math.max(0, Date.now() - startedAt) };
}

export async function askOracle(
  base: string,
  ask: OracleAsk,
  timeoutMs = 6000,
): Promise<OracleResponse> {
  const startedAt = Date.now();
  const fallback = LOCAL_FALLBACKS[ask.useCase] ?? LOCAL_FALLBACKS.hint;
  if (!base) return fallbackResponse(fallback, startedAt);


  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // /oracle is a normal API path (not blocked); still keep it resilient.
    const res = await fetch(`${base.replace(/\/$/, '')}/oracle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ask),
      signal: controller.signal,
    });
    if (!res.ok) return fallbackResponse(fallback, startedAt);
    const data = (await res.json()) as { text?: string; source?: OracleSource };
    const text = data.text?.trim();
    if (!text) return fallbackResponse(fallback, startedAt);
    const source: OracleSource = data.source === 'bedrock' ? 'bedrock' : 'fallback';
    return {
      text,
      source,
      latencyMs: Math.max(0, Date.now() - startedAt),
    };
  } catch {
    return fallbackResponse(fallback, startedAt);
  } finally {
    clearTimeout(timer);
  }
}
