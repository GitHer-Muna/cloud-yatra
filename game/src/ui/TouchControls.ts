/**
 * TouchControls.ts — on-screen controls for touch devices so Cloud Yatra is playable on
 * phones/tablets (the game is otherwise keyboard-only). Renders a left/right D-pad on the
 * bottom-left, and JUMP + KHUKURI buttons on the bottom-right. Each button maintains a
 * boolean held-state that the scene merges into the Yatri's input flags — the SAME flags
 * the keyboard produces, so gameplay logic is identical.
 *
 * Only shown when the device reports touch support (pointer: coarse / touch points), so
 * desktop players never see it. Screen-fixed (scrollFactor 0), above gameplay, below the
 * end-of-level status cards. 100% original art, drawn in code.
 */
import Phaser from 'phaser';

export interface TouchState {
  left: boolean;
  right: boolean;
  up: boolean; // jump
  attack: boolean;
}

/** True when the current device is touch-capable (phones/tablets). */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
  const points = (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints ?? 0;
  return coarse || points > 0 || 'ontouchstart' in window;
}

export class TouchControls {
  readonly state: TouchState = { left: false, right: false, up: false, attack: false };
  private buttons: Phaser.GameObjects.Arc[] = [];

  constructor(private scene: Phaser.Scene) {
    const W = scene.scale.width;
    const H = scene.scale.height;
    const r = 44; // button radius — larger = easier to hit with a thumb
    const pad = 26;
    const gap = 18; // space between the two D-pad buttons
    const baseY = H - r - pad;

    // Bottom-left: LEFT / RIGHT (well separated so a thumb doesn't hit both).
    this.makeButton(pad + r, baseY, r, '◀', ['left']);
    this.makeButton(pad + r * 3 + gap, baseY, r, '▶', ['right']);

    // Bottom-right: KHUKURI (left of) + JUMP (far right, larger).
    this.makeButton(W - pad - r * 3 - gap, baseY, r, '🗡', ['attack']);
    this.makeButton(W - pad - r, baseY - 8, r + 8, '⤒', ['up']);
  }

  /** Draw a round, semi-transparent button that sets the given state keys while pressed. */
  private makeButton(
    x: number,
    y: number,
    r: number,
    glyph: string,
    keys: Array<keyof TouchState>,
  ): void {
    // Use an Arc (circle) GameObject as the interactive target. Unlike a Container with a
    // manual geometry hit-area (which is error-prone and was NOT registering touches on
    // mobile), an Arc has a correct built-in circular hit region, so presses always land.
    const circle = this.scene.add
      .circle(x, y, r, 0x10233b, 0.42)
      .setStrokeStyle(2, 0xf3c623, 0.5)
      .setScrollFactor(0)
      .setDepth(2400)
      .setInteractive({ useHandCursor: true });

    // Glyph label centered on the button (purely visual; not interactive).
    this.scene.add
      .text(x, y, glyph, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: `${r}px`,
        color: '#eaf4ff',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(2401);

    const press = (): void => {
      for (const k of keys) this.state[k] = true;
      circle.setFillStyle(0xf3c623, 0.5).setStrokeStyle(2, 0xffffff, 0.8);
    };
    const release = (): void => {
      for (const k of keys) this.state[k] = false;
      circle.setFillStyle(0x10233b, 0.42).setStrokeStyle(2, 0xf3c623, 0.5);
    };

    // pointerdown/up/out/upoutside cover: press, lift, slide-off, and lift-outside — so a
    // held direction never "sticks" if the finger slides away.
    circle.on('pointerdown', press);
    circle.on('pointerup', release);
    circle.on('pointerout', release);
    circle.on('pointerupoutside', release);

    this.buttons.push(circle);
  }

  /** Release every button (used on pause / scene teardown). */
  reset(): void {
    this.state.left = this.state.right = this.state.up = this.state.attack = false;
  }
}
