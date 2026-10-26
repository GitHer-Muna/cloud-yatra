import { describe, expect, it } from 'vitest';
import { resolveJump, type JumpInput } from './jumpLogic';
import { PLAYER } from './playerConfig';

// A baseline "nothing special" input; each test overrides only what it exercises.
const base: JumpInput = {
  now: 1000,
  lastGroundedAt: 1000, // grounded right now → coyote active
  jumpBufferedAt: 1000, // jump pressed this frame → buffered
  jumpsUsed: 0,
  onGround: true,
  velocityY: 0,
};

describe('resolveJump', () => {
  it('fires a full-strength ground jump when grounded with a buffered press', () => {
    const d = resolveJump(base);
    expect(d.jump).toBe(true);
    expect(d.kind).toBe('ground');
    expect(d.impulse).toBe(PLAYER.jumpVelocity);
  });

  it('does not jump without a buffered press', () => {
    const d = resolveJump({ ...base, jumpBufferedAt: base.now - PLAYER.jumpBufferMs - 1 });
    expect(d.jump).toBe(false);
    expect(d.kind).toBe(null);
  });

  it('allows a coyote-time ground jump just after leaving a ledge', () => {
    const d = resolveJump({
      ...base,
      onGround: false,
      lastGroundedAt: base.now - (PLAYER.coyoteMs - 10), // still within coyote grace
      velocityY: 5,
    });
    expect(d.jump).toBe(true);
    expect(d.kind).toBe('ground');
  });

  it('allows a softer double jump when airborne past coyote with one jump spent', () => {
    const d = resolveJump({
      ...base,
      onGround: false,
      lastGroundedAt: base.now - (PLAYER.coyoteMs + 100), // coyote expired
      jumpsUsed: 1,
      velocityY: -50,
    });
    expect(d.jump).toBe(true);
    expect(d.kind).toBe('double');
    expect(d.impulse).toBeCloseTo(PLAYER.jumpVelocity * PLAYER.doubleJumpFactor);
  });

  it('refuses a third jump once both are spent', () => {
    const d = resolveJump({
      ...base,
      onGround: false,
      lastGroundedAt: base.now - (PLAYER.coyoteMs + 100),
      jumpsUsed: PLAYER.maxJumps,
      velocityY: 100,
    });
    expect(d.jump).toBe(false);
  });

  it('REGRESSION: after a stomp bounce (jumpsUsed=1, airborne, no coyote) the air jump is usable', () => {
    // A stomp sets jumpsUsed=1 and launches Yatri upward off the ground. The player must
    // still be able to use the remaining air jump — the earlier bug set jumpsUsed=0, which
    // made BOTH gates fail (no coyote → no ground jump; jumpsUsed<1 → no double jump).
    const d = resolveJump({
      ...base,
      onGround: false,
      lastGroundedAt: base.now - (PLAYER.coyoteMs + 100), // bounce doesn't refresh grounding
      jumpsUsed: 1,
      velocityY: -200, // rising from the bounce
    });
    expect(d.jump).toBe(true);
    expect(d.kind).toBe('double');
  });
});
