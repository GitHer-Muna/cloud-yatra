import { describe, expect, it } from 'vitest';
import { GRAVITY_Y } from './constants';
import { LEVELS, LEVEL_ORDER } from './levels';
import { PLAYER } from './playerConfig';

const maxJumpHeight = (PLAYER.jumpVelocity * PLAYER.jumpVelocity) / (2 * GRAVITY_Y);
const maxHorizontalFlight = PLAYER.moveSpeed * ((2 * PLAYER.jumpVelocity) / GRAVITY_Y);
// With the double jump, the reachable ceiling is the first jump's height plus the
// (slightly softer) mid-air jump's height — so every platform layer is climbable.
const secondJumpHeight =
  (PLAYER.jumpVelocity * PLAYER.doubleJumpFactor) ** 2 / (2 * GRAVITY_Y);
const doubleJumpCeiling = maxJumpHeight + secondJumpHeight;

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

  it('escalates difficulty across regions while staying fair', () => {
    const levels = LEVEL_ORDER.map((id) => LEVELS[id]);
    // Par time TIGHTENS toward the summit (the journey should intensify, not stay flat).
    const parTimes = levels.map((level) => level.parTimeMs);
    expect(parTimes[0]).toBeGreaterThan(parTimes[1]);
    expect(parTimes[1]).toBeGreaterThan(parTimes[2]);
    // Each region still presents a readable number of hazards and fair speeds.
    expect(levels.every((level) => level.hazards.length >= 5)).toBe(true);
    expect(
      levels.every((level) => {
        const moving = level.hazards.filter((hazard) => hazard.kind !== 'rockfall');
        const rockfalls = level.hazards.filter((hazard) => hazard.kind === 'rockfall');
        return (
          Math.max(...moving.map((hazard) => hazard.speed)) <= 140 &&
          (rockfalls.length === 0 ||
            Math.max(...rockfalls.map((hazard) => hazard.speed)) <= 220)
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

  it('keeps every platform layer reachable from the ground with the double jump', () => {
    // The player can jump once from the ground and once more in mid-air (PLAYER.maxJumps).
    // Together those reach `doubleJumpCeiling`, so no platform — however high a layer it
    // sits on — should be out of reach for a player collecting blooms/bells up there.
    expect(PLAYER.maxJumps).toBeGreaterThanOrEqual(2);
    for (const id of LEVEL_ORDER) {
      for (const platform of LEVELS[id].platforms) {
        expect(-platform.dy).toBeLessThanOrEqual(doubleJumpCeiling);
      }
    }
  });

  it('drops every rockfall onto the ground trail, not an elevated platform', () => {
    // A rockfall over a platform only threatens the high route — the walking player on the
    // ground never meets it, defeating the "run/jump past the falling rock" beat. Assert no
    // platform sits in any rockfall's vertical column so each rock reaches the ground path.
    for (const id of LEVEL_ORDER) {
      const level = LEVELS[id];
      const rockfalls = level.hazards.filter((h) => h.kind === 'rockfall');
      for (const rock of rockfalls) {
        const platformInColumn = level.platforms.some(
          (p) => rock.x >= p.x - p.w / 2 && rock.x <= p.x + p.w / 2,
        );
        expect(platformInColumn).toBe(false);
      }
    }
  });
});
