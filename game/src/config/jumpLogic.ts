/**
 * jumpLogic.ts — the pure decision for "can Yatri jump right now, and how hard?".
 *
 * Extracted from Yatri.updateFromInput so the ground-jump / double-jump / coyote-time rules
 * are unit-testable without a Phaser body. No Phaser import; plain data in, plain data out.
 */
import { PLAYER } from './playerConfig';

export interface JumpInput {
  now: number;
  lastGroundedAt: number;
  jumpBufferedAt: number;
  jumpsUsed: number;
  onGround: boolean;
  velocityY: number;
}

export interface JumpDecision {
  /** Whether a jump fires this frame. */
  jump: boolean;
  /** Upward impulse to apply (0 when jump is false). Positive magnitude. */
  impulse: number;
  /** 'ground' = first jump (incl. coyote), 'double' = mid-air jump, null = none. */
  kind: 'ground' | 'double' | null;
}

/**
 * Decide the jump for this frame from the current motion state. Mirrors the gates used in
 * Yatri: a first jump needs coyote grace and an unused jump; a double jump needs to be
 * airborne, past coyote, with a jump to spare. A buffered jump press within jumpBufferMs
 * triggers it. Keeping this pure guarantees, for example, that after a stomp bounce
 * (jumpsUsed = 1) the player still has a usable air jump.
 */
export function resolveJump(input: JumpInput): JumpDecision {
  const { now, lastGroundedAt, jumpBufferedAt, jumpsUsed, onGround, velocityY } = input;

  const canCoyote = now - lastGroundedAt <= PLAYER.coyoteMs;
  const hasBufferedJump = now - jumpBufferedAt <= PLAYER.jumpBufferMs;
  const canGroundJump = canCoyote && (onGround || velocityY >= 0) && jumpsUsed < 1;
  const canDoubleJump = !onGround && !canCoyote && jumpsUsed >= 1 && jumpsUsed < PLAYER.maxJumps;

  if (hasBufferedJump && (canGroundJump || canDoubleJump)) {
    const impulse = canGroundJump
      ? PLAYER.jumpVelocity
      : PLAYER.jumpVelocity * PLAYER.doubleJumpFactor;
    return { jump: true, impulse, kind: canGroundJump ? 'ground' : 'double' };
  }
  return { jump: false, impulse: 0, kind: null };
}
