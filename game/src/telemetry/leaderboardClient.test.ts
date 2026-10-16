import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLeaderboardStatus } from './leaderboardClient';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchLeaderboardStatus', () => {
  it('sorts valid rows and reports an available board', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          entries: [
            { name: 'Low', score: 20 },
            { name: 'High', score: 90 },
            { name: 'Bad', score: 'not-a-score' },
          ],
        }),
      }),
    );
    const result = await fetchLeaderboardStatus('https://api.example.test');
    expect(result.status).toBe('ok');
    expect(result.entries.map((entry) => entry.score)).toEqual([90, 20]);
  });

  it('reports an empty but healthy board separately from failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ entries: [] }) }));
    const result = await fetchLeaderboardStatus('https://api.example.test');
    expect(result).toEqual({ entries: [], status: 'empty' });
  });

  it('reports a missing API as unavailable', async () => {
    const result = await fetchLeaderboardStatus('');
    expect(result).toEqual({ entries: [], status: 'unavailable' });
  });
});
