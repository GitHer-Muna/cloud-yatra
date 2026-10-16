import { afterEach, describe, expect, it, vi } from 'vitest';
import { askOracle } from './oracleClient';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('askOracle', () => {
  it('returns an instant local fallback when no API is configured', async () => {
    const result = await askOracle('', {
      useCase: 'hint',
      sessionId: 'abcdefgh-1234',
    });
    expect(result.source).toBe('fallback');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.text).toContain('mist');
  });

  it('preserves Bedrock source and measures request latency', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ text: 'Journey well, Yatri.', source: 'bedrock' }),
      }),
    );

    const result = await askOracle('https://api.example.test', {
      useCase: 'welcome',
      sessionId: 'abcdefgh-1234',
      levelId: 'terai',
    });
    expect(result).toMatchObject({ text: 'Journey well, Yatri.', source: 'bedrock' });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('uses fallback metadata when the API is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const result = await askOracle('https://api.example.test', {
      useCase: 'death',
      sessionId: 'abcdefgh-1234',
    });
    expect(result.source).toBe('fallback');
    expect(result.text).toContain('river');
  });
});
