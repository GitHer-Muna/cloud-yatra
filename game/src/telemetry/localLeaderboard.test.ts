import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordLocalScore, getLocalLeaderboard } from './localLeaderboard';

// A tiny in-memory localStorage stub so the module can read/write under Node/vitest.
function installStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
}

beforeEach(() => installStorage());
afterEach(() => vi.unstubAllGlobals());

describe('local leaderboard', () => {
  it('starts empty', () => {
    expect(getLocalLeaderboard()).toEqual([]);
  });

  it('records runs and ranks them score-descending', () => {
    recordLocalScore(100, 'Asha');
    recordLocalScore(300, 'Bimal');
    recordLocalScore(200, 'Chandra');
    const board = getLocalLeaderboard();
    expect(board.map((e) => e.score)).toEqual([300, 200, 100]);
    expect(board[0].name).toBe('Bimal');
  });

  it('persists carried time and omits blank names', () => {
    recordLocalScore(150, '   ', 42000);
    const [entry] = getLocalLeaderboard();
    expect(entry.score).toBe(150);
    expect(entry.timeMs).toBe(42000);
    expect(entry.name).toBeUndefined();
  });

  it('keeps ties stable by insertion order (first in ranks higher)', () => {
    const first = recordLocalScore(250, 'First');
    const second = recordLocalScore(250, 'Second');
    expect(second).toBeGreaterThanOrEqual(first);
    const board = getLocalLeaderboard();
    expect(board.map((e) => e.name)).toEqual(['First', 'Second']);
  });
});
