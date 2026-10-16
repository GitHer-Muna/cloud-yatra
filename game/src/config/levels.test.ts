import { describe, expect, it } from 'vitest';
import { GRAVITY_Y } from './constants';
import { LEVELS, LEVEL_ORDER } from './levels';
import { PLAYER } from './playerConfig';

const maxJumpHeight = (PLAYER.jumpVelocity * PLAYER.jumpVelocity) / (2 * GRAVITY_Y);
const maxHorizontalFlight = PLAYER.moveSpeed * ((2 * PLAYER.jumpVelocity) / GRAVITY_Y);

function platformTopRise(previousDy: number, nextDy: number): number {
  return Math.max(0, previousDy - nextDy);
}

describe('three-region route accessibility', () => {
  it('keeps every lower trail continuous from START to END', () => {
    for (const id of LEVEL_ORDER) {
      const level = LEVELS[id];
      expect(level.worldWidth).toBeGreaterThan(500);
      expect(level.checkpoints.every((x) => x > 0 && x < level.worldWidth)).toBe(true);
      expect(level.cuttables.every((obstacle) => obstacle.x > 0 && obstacle.x < level.worldWidth)).toBe(true);
    }
  });

  it('keeps the challenge budget consistent across regions', () => {
    const levels = LEVEL_ORDER.map((id) => LEVELS[id]);
    expect(new Set(levels.map((level) => level.parTimeMs)).size).toBe(1);
    expect(new Set(levels.map((level) => level.hazards.length)).size).toBe(1);
    expect(levels.every((level) => level.hazards.length === 7)).toBe(true);
    expect(
      levels.every((level) => {
        const moving = level.hazards.filter((hazard) => hazard.kind !== 'rockfall');
        const rockfalls = level.hazards.filter((hazard) => hazard.kind === 'rockfall');
        return (
          Math.max(...moving.map((hazard) => hazard.speed)) <= 120 &&
          Math.max(...rockfalls.map((hazard) => hazard.speed)) <= 200
        );
      }),
    ).toBe(true);
    expect(levels.every((level) => level.checkpoints.length === 4)).toBe(true);
  });

  it('keeps every upper platform jump within the player physics envelope', () => {
    for (const id of LEVEL_ORDER) {
      const platforms = LEVELS[id].platforms;
      expect(platforms.length).toBeGreaterThan(2);
      expect(-platforms[0].dy).toBeLessThanOrEqual(maxJumpHeight);
      for (let i = 1; i < platforms.length; i++) {
        const previous = platforms[i - 1];
        const next = platforms[i];
        const horizontalGap = next.x - next.w / 2 - (previous.x + previous.w / 2);
        expect(horizontalGap).toBeLessThanOrEqual(maxHorizontalFlight);
        expect(platformTopRise(previous.dy, next.dy)).toBeLessThanOrEqual(maxJumpHeight);
      }
    }
  });
});
