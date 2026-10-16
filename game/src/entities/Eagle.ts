/**
 * Eagle.ts — a Himalayan eagle hazard that patrols the HIGH path in a swooping arc, so
 * the elevated platform route is risky rather than a safe shortcut. Predictable (no
 * chasing) — watch the arc and time your move. Touch = lose a life. Original art in code.
 */
import Phaser from 'phaser';

const TEXTURE_KEY = 'eagle';

export class Eagle extends Phaser.Physics.Arcade.Sprite {
  private minX: number;
  private maxX: number;
  private baseY: number;
  private speed: number;
  private wingPhase = 0;
  private dead = false;

  constructor(scene: Phaser.Scene, x: number, y: number, range: number, speed: number) {
    Eagle.ensureTexture(scene);
    super(scene, x, y, TEXTURE_KEY);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setImmovable(true);
    this.setDepth(1);

    this.minX = x - range / 2;
    this.maxX = x + range / 2;
    this.baseY = y;
    this.speed = speed;
    this.setVelocityX(speed);
  }

  /** True once the eagle has been stomped (so the scene stops patrolling/hurting it). */
  isDead(): boolean {
    return this.dead;
  }

  /**
   * Stomped! The eagle is knocked out: it stops patrolling, spins, and tumbles away with
   * a puff of feathers, then is removed. Returns false if it was already dead.
   */
  kill(): boolean {
    if (this.dead) return false;
    this.dead = true;
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.enable = false;

    // A few feathers puff out.
    for (let i = 0; i < 5; i++) {
      const f = this.scene.add
        .rectangle(this.x, this.y, 3, 6, 0x7a6248)
        .setDepth(2)
        .setAngle(Phaser.Math.Between(0, 360));
      this.scene.tweens.add({
        targets: f,
        x: f.x + Phaser.Math.Between(-30, 30),
        y: f.y - Phaser.Math.Between(6, 24),
        alpha: 0,
        duration: Phaser.Math.Between(300, 520),
        onComplete: () => f.destroy(),
      });
    }
    // Tumble down and fade out.
    this.scene.tweens.add({
      targets: this,
      y: this.y + 160,
      angle: 220,
      alpha: 0,
      duration: 620,
      ease: 'Quad.in',
      onComplete: () => this.destroy(),
    });
    return true;
  }

  /** Swoop: patrol left↔right and bob in a sine arc. Call each frame. */
  patrol(): void {
    if (this.dead) return;
    if (this.x <= this.minX) {
      this.setVelocityX(this.speed);
      this.setFlipX(false);
    } else if (this.x >= this.maxX) {
      this.setVelocityX(-this.speed);
      this.setFlipX(true);
    }
    this.wingPhase += 0.15;
    // Vertical swoop arc based on horizontal progress.
    const t = (this.x - this.minX) / Math.max(1, this.maxX - this.minX);
    this.y = this.baseY + Math.sin(t * Math.PI) * 46;
    this.setScale(1, 1 + Math.sin(this.wingPhase) * 0.14); // wing flap
    (this.body as Phaser.Physics.Arcade.Body).updateFromGameObject?.();
  }

  private static ensureTexture(scene: Phaser.Scene): void {
    if (scene.textures.exists(TEXTURE_KEY)) return;
    const g = scene.add.graphics();
    const w = 44;
    const h = 26;
    const cx = w / 2;
    const cy = h / 2;
    // Body.
    g.fillStyle(0x5b4632, 1);
    g.fillEllipse(cx, cy, 14, 8);
    // Head + hooked beak.
    g.fillStyle(0x6b5540, 1);
    g.fillCircle(cx + 8, cy - 2, 4);
    g.fillStyle(0xf3c11b, 1);
    g.fillTriangle(cx + 11, cy - 3, cx + 16, cy - 1, cx + 11, cy + 1);
    // Wings (spread).
    g.fillStyle(0x4a3826, 1);
    g.fillTriangle(cx - 2, cy - 2, cx - 22, cy - 10, cx - 6, cy + 2);
    g.fillTriangle(cx + 2, cy - 2, cx + 22, cy - 10, cx + 6, cy + 2);
    // Wing tip feathers (lighter).
    g.fillStyle(0x7a6248, 1);
    g.fillTriangle(cx - 16, cy - 8, cx - 22, cy - 10, cx - 16, cy - 4);
    g.fillTriangle(cx + 16, cy - 8, cx + 22, cy - 10, cx + 16, cy - 4);
    // Tail.
    g.fillStyle(0x4a3826, 1);
    g.fillTriangle(cx - 8, cy, cx - 16, cy + 4, cx - 8, cy + 3);
    g.generateTexture(TEXTURE_KEY, w, h);
    g.destroy();
  }
}
