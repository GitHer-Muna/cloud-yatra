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
  private buttons: Phaser.GameObjects.Container[] = [];

  constructor(private scene: Phaser.Scene) {
    const W = scene.scale.width;
    const H = scene.scale.height;
    const r = 34; // button radius
    const pad = 20;
    const baseY = H - r - pad;

    // Bottom-left: LEFT / RIGHT.
    this.makeButton(pad + r, baseY, r, '◀', ['left']);
    this.makeButton(pad + r * 3 + 8, baseY, r, '▶', ['right']);

    // Bottom-right: KHUKURI (left of) + JUMP (far right, larger).
    this.makeButton(W - pad - r * 3 - 8, baseY, r, '🗡', ['attack']);
    this.makeButton(W - pad - r, baseY - 6, r + 6, '⤒', ['up']);
  }

  /** Draw a round, semi-transparent button that sets the given state keys while pressed. */
  private makeButton(
    x: number,
    y: number,
    r: number,
    glyph: string,
    keys: Array<keyof TouchState>,
  ): void {
    const g = this.scene.add.graphics();
    g.fillStyle(0x10233b, 0.42);
    g.fillCircle(0, 0, r);
    g.lineStyle(2, 0xf3c623, 0.5);
    g.strokeCircle(0, 0, r);

    const label = this.scene.add
      .text(0, 0, glyph, { fontFamily: 'system-ui, sans-serif', fontSize: `${r}px`, color: '#eaf4ff' })
      .setOrigin(0.5);

    const container = this.scene.add.container(x, y, [g, label]);
    container.setScrollFactor(0).setDepth(2400).setAlpha(0.9);
    // A circular hit area so presses outside the circle don't trigger.
    container.setSize(r * 2, r * 2);
    container.setInteractive(
      new Phaser.Geom.Circle(0, 0, r),
      Phaser.Geom.Circle.Contains,
    );

    const press = (): void => {
      for (const k of keys) this.state[k] = true;
      container.setAlpha(1);
      g.clear();
      g.fillStyle(0xf3c623, 0.5);
      g.fillCircle(0, 0, r);
      g.lineStyle(2, 0xffffff, 0.8);
      g.strokeCircle(0, 0, r);
    };
    const release = (): void => {
      for (const k of keys) this.state[k] = false;
      container.setAlpha(0.9);
      g.clear();
      g.fillStyle(0x10233b, 0.42);
      g.fillCircle(0, 0, r);
      g.lineStyle(2, 0xf3c623, 0.5);
      g.strokeCircle(0, 0, r);
    };

    container.on('pointerdown', press);
    container.on('pointerup', release);
    container.on('pointerout', release);
    container.on('pointerupoutside', release);

    this.buttons.push(container);
  }

  /** Release every button (used on pause / scene teardown). */
  reset(): void {
    this.state.left = this.state.right = this.state.up = this.state.attack = false;
  }
}
