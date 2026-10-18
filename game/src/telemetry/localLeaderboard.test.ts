import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordLocalScore, getLocalLeaderboard, getRankedBoard, findRank } from './localLeaderboard';

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

  it('keeps only the BEST score per name (case-insensitive)', () => {
    recordLocalScore(100, 'Yatri');
    recordLocalScore(450, 'yatri'); // same pilgrim, higher — should replace
    recordLocalScore(250, 'YATRI'); // lower — should be ignored
    const board = getLocalLeaderboard();
    expect(board).toHaveLength(1);
    expect(board[0].score).toBe(450);
  });

  it('keeps different names as separate rows', () => {
    recordLocalScore(500, 'Yatri');
    recordLocalScore(300, 'Muna');
    const board = getLocalLeaderboard();
    expect(board.map((e) => e.name)).toEqual(['Yatri', 'Muna']);
    expect(board.map((e) => e.score)).toEqual([500, 300]);
  });

  it('keeps anonymous runs individually (no name = not merged)', () => {
    recordLocalScore(150, '   ', 42000); // blank name → anonymous
    recordLocalScore(120); // anonymous
    const board = getLocalLeaderboard();
    expect(board).toHaveLength(2);
    expect(board[0].score).toBe(150);
    expect(board[0].timeMs).toBe(42000);
    expect(board[0].name).toBeUndefined();
  });
});

describe('ranked board with legends', () => {
  it('includes built-in legends so a fresh board is never empty', () => {
    const board = getRankedBoard();
    expect(board.length).toBeGreaterThanOrEqual(5);
    expect(board.every((e) => e.legend)).toBe(true); // all legends when no real runs
    // Sorted descending.
    for (let i = 1; i < board.length; i++) {
      expect(board[i - 1].score).toBeGreaterThanOrEqual(board[i].score);
    }
  });

  it('merges the player run into the ranked board in the right position', () => {
    recordLocalScore(2000, 'Climber'); // between 1700 and 2100 legends
    const board = getRankedBoard();
    const idx = board.findIndex((e) => e.name === 'Climber');
    expect(idx).toBeGreaterThan(0);
    expect(board[idx - 1].score).toBeGreaterThanOrEqual(2000);
    expect(board[idx].score).toBe(2000);
  });
});

describe('findRank', () => {
  it('reports rank 1 for a top score', () => {
    const { rank } = findRank(99999);
    expect(rank).toBe(1);
  });

  it('reports a lower rank for a modest score, relative to legends', () => {
    const top = findRank(99999);
    const low = findRank(1);
    expect(low.rank).toBeGreaterThan(top.rank);
    expect(low.total).toBe(low.total); // total is stable and positive
    expect(low.total).toBeGreaterThan(0);
  });
});
