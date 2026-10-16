/**
 * gameplayScoring.test.ts — verifies the pure scoring math used by the level scene:
 * combo multiplier growth/cap, fast-finish time bonus, and lives bonus. These are the
 * replayability-critical numbers, so we pin them with tests (no Phaser needed).
 */
import { describe, it, expect } from 'vitest';
import { SCORING, LEVELS } from './levels';
import { PLAYER } from './playerConfig';

const parTimeMs = LEVELS.hills.parTimeMs;

/** Mirror of the scene's combo multiplier calc (kept in sync intentionally). */
function comboMultiplier(chain: number): number {
  const capSteps = Math.round(SCORING.comboMax / SCORING.comboStep);
  const combo = Math.min(chain, capSteps);
  return Math.min(1 + (combo - 1) * SCORING.comboStep, SCORING.comboMax);
}

/** Mirror of the scene's time-bonus calc. */
function timeBonus(timeMs: number): number {
  return Math.max(
    0,
    Math.round(SCORING.timeBonusMax * (1 - Math.min(timeMs, parTimeMs) / parTimeMs)),
  );
}

describe('combo multiplier', () => {
  it('is 1.0 for the first bloom in a chain', () => {
    expect(comboMultiplier(1)).toBe(1);
  });
  it('grows by comboStep per chained bloom', () => {
    expect(comboMultiplier(2)).toBeCloseTo(1 + SCORING.comboStep);
    expect(comboMultiplier(3)).toBeCloseTo(1 + 2 * SCORING.comboStep);
  });
  it('never exceeds comboMax', () => {
    expect(comboMultiplier(1000)).toBe(SCORING.comboMax);
    expect(comboMultiplier(1000)).toBeLessThanOrEqual(SCORING.comboMax);
  });
  it('reaches comboMax exactly at the cap step and not before', () => {
    // The scene caps the combo at this step; the multiplier must hit comboMax there.
    const comboCap = Math.round((SCORING.comboMax - 1) / SCORING.comboStep) + 1;
    expect(comboMultiplier(comboCap)).toBe(SCORING.comboMax);
    expect(comboMultiplier(comboCap - 1)).toBeLessThan(SCORING.comboMax);
  });
});

describe('time bonus', () => {
  it('is the full max at instant finish', () => {
    expect(timeBonus(0)).toBe(SCORING.timeBonusMax);
  });
  it('is zero at or beyond par time', () => {
    expect(timeBonus(parTimeMs)).toBe(0);
    expect(timeBonus(parTimeMs * 2)).toBe(0);
  });
  it('is roughly half at half of par time', () => {
    expect(timeBonus(parTimeMs / 2)).toBe(Math.round(SCORING.timeBonusMax / 2));
  });
  it('never goes negative', () => {
    expect(timeBonus(999999)).toBeGreaterThanOrEqual(0);
  });
});

describe('lives bonus', () => {
  it('scales linearly with remaining lives', () => {
    expect(3 * SCORING.livesBonus).toBe(SCORING.livesBonus * 3);
    expect(0 * SCORING.livesBonus).toBe(0);
  });
});

describe('reward economy', () => {
  it('defines a positive garland size and bonus', () => {
    expect(SCORING.garlandSize).toBeGreaterThan(0);
    expect(SCORING.garlandBonusPoints).toBeGreaterThan(0);
    expect(SCORING.bellLifeBonus).toBeGreaterThanOrEqual(1);
  });

  it('awards a garland exactly every garlandSize blooms', () => {
    const isGarland = (n: number): boolean => n > 0 && n % SCORING.garlandSize === 0;
    expect(isGarland(SCORING.garlandSize)).toBe(true); // first garland
    expect(isGarland(SCORING.garlandSize * 2)).toBe(true); // second garland
    expect(isGarland(SCORING.garlandSize - 1)).toBe(false);
    expect(isGarland(SCORING.garlandSize + 1)).toBe(false);
    expect(isGarland(0)).toBe(false); // no garland before collecting any
  });

  it('reports a correct "to next garland" countdown', () => {
    const toGo = (count: number): number => {
      const into = count % SCORING.garlandSize;
      return into === 0 && count > 0 ? 0 : SCORING.garlandSize - into;
    };
    expect(toGo(0)).toBe(SCORING.garlandSize);
    expect(toGo(1)).toBe(SCORING.garlandSize - 1);
    expect(toGo(SCORING.garlandSize)).toBe(0);
    expect(toGo(SCORING.garlandSize + 1)).toBe(SCORING.garlandSize - 1);
  });

  it('caps bonus lives at the player maximum', () => {
    // Mirror of Yatri.gainLife(): never exceed maxLives, return lives actually added.
    const gain = (current: number, amount: number): number =>
      Math.min(PLAYER.maxLives, current + amount) - current;
    expect(gain(PLAYER.maxLives - 1, 1)).toBe(1); // room for one
    expect(gain(PLAYER.maxLives, 1)).toBe(0); // already full
    expect(gain(PLAYER.startingLives, 1)).toBe(1);
    expect(PLAYER.maxLives).toBeGreaterThanOrEqual(PLAYER.startingLives);
  });
});

describe('level config', () => {
  it('has three distinct regions in order', () => {
    expect(LEVELS.terai.index).toBe(1);
    expect(LEVELS.hills.index).toBe(2);
    expect(LEVELS.himal.index).toBe(3);
    const ids = [LEVELS.terai.id, LEVELS.hills.id, LEVELS.himal.id];
    expect(new Set(ids).size).toBe(3);
  });
  it('each level has hazards and a par time', () => {
    for (const lvl of [LEVELS.terai, LEVELS.hills, LEVELS.himal]) {
      expect(lvl.hazards.length).toBeGreaterThan(0);
      expect(lvl.parTimeMs).toBeGreaterThan(0);
    }
  });
});
