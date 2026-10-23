/**
 * Rockfall.ts — a boulder that periodically falls from above a fixed x-position and
 * resets to the top, creating a timed vertical threat the player must run/jump past.
 * Predictable cycle (learnable). Touch = lose a life. Original art in code.
 */
import Phaser from 'phaser';

const TEXTURE_KEY = 'rockfall';

export class Rockfall extends Phaser.Physics.Arcade.Sprite {
  private topY: number;
  private fallSpeed: number;
  private groundY: number;
  private resetDelayMs: number;
  private waitingUntil = 0;

  constructor(scene: Phaser.Scene, x: number, topY: number, fallSpeed: number, groundY: number) {
    Rockfall.ensureTexture(scene);
    super(scene, x, topY, TEXTURE_KEY);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setImmovable(true);
    this.setDepth(1);
    this.topY = topY;
    this.fallSpeed = fallSpeed;
    this.groundY = groundY;
    // Stagger start so multiple rockfalls don't sync.
    this.waitingUntil = scene.time.now + Phaser.Math.Between(0, 1500);
    this.resetDelayMs = Phaser.Math.Between(1400, 2200);
    this.setVisible(false);
  }

  /** Advance the fall cycle. Call each frame with delta ms. */
  fall(deltaMs: number): void {
    const now = this.scene.time.now;
    if (now < this.waitingUntil) {
      this.setVisible(false);
      return;
    }
    this.setVisible(true);
    this.y += (this.fallSpeed * deltaMs) / 1000;
    // Spin at a fixed angular speed (deg/sec) so the rock tumbles the same in every
    // browser rather than faster on high-refresh displays.
    this.setAngle(this.angle + (240 * deltaMs) / 1000);
    if (this.y >= this.groundY) {
      // Little dust puff could go here; reset to top after a delay.
      this.y = this.topY;
      this.setVisible(false);
      this.waitingUntil = now + this.resetDelayMs;
    }
    (this.body as Phaser.Physics.Arcade.Body).updateFromGameObject?.();
  }

  isActive(): boolean {
    return this.visible;
  }

  private static ensureTexture(scene: Phaser.Scene): void {
    if (scene.textures.exists(TEXTURE_KEY)) return;
    const g = scene.add.graphics();
    const s = 24;
    const c = s / 2;
    g.fillStyle(0x6b6156, 1);
    g.fillCircle(c, c, c - 2);
    g.fillStyle(0x565049, 1);
    g.fillCircle(c + 3, c + 2, c - 5);
    g.fillStyle(0x827868, 1);
    g.fillCircle(c - 3, c - 3, 3);
    g.lineStyle(1, 0x3d3730, 1);
    g.strokeCircle(c, c, c - 2);
    g.generateTexture(TEXTURE_KEY, s, s);
    g.destroy();
  }
}
