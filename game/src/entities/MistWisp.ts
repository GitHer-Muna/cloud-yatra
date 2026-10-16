/**
 * MistWisp.ts — the original, predictable hazard of Himal Rajya.
 *
 * CONCEPT: a "Mist Wisp" is a cold mountain-fog mote that drifts back and forth
 * along a fixed horizontal path at constant speed. NOT an enemy with intelligence —
 * no chasing, no pathfinding. Beginner-friendly: watch it, learn the pattern, time
 * your move. Touching one costs the Yatri a life. Art is 100% original, drawn in code.
 */
import Phaser from 'phaser';

const TEXTURE_KEY = 'mist-wisp';

export class MistWisp extends Phaser.Physics.Arcade.Sprite {
  private minX: number;
  private maxX: number;
  private speed: number;

  constructor(scene: Phaser.Scene, x: number, y: number, range: number, speed: number) {
    MistWisp.ensureTexture(scene);
    super(scene, x, y, TEXTURE_KEY);

    scene.add.existing(this);
    scene.physics.add.existing(this);

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setImmovable(true);
    this.setDepth(0);

    this.minX = x - range / 2;
    this.maxX = x + range / 2;
    this.speed = speed;
    this.setVelocityX(speed);

    // Gentle drift bob + slow pulse so it reads as living fog.
    scene.tweens.add({
      targets: this,
      alpha: 0.6,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });
  }

  /** Reverse at patrol edges — predictable back-and-forth. Call each frame. */
  patrol(): void {
    if (this.x <= this.minX) this.setVelocityX(this.speed);
    else if (this.x >= this.maxX) this.setVelocityX(-this.speed);
  }

  private static ensureTexture(scene: Phaser.Scene): void {
    if (scene.textures.exists(TEXTURE_KEY)) return;
    const g = scene.add.graphics();
    const size = 30;
    const c = size / 2;

    // Layered soft grey-blue puffs (a cold fog mote).
    g.fillStyle(0x9fb3c8, 0.35);
    g.fillCircle(c, c, c);
    g.fillStyle(0xc3d2e0, 0.7);
    g.fillCircle(c - 5, c, 8);
    g.fillCircle(c + 6, c + 2, 7);
    g.fillCircle(c, c - 5, 6);
    // Two faint "eyes" so it reads as a wisp, not a cloud (kept subtle, not cute-copy).
    g.fillStyle(0x5a6b7d, 0.8);
    g.fillCircle(c - 3, c, 1.6);
    g.fillCircle(c + 4, c + 1, 1.6);

    g.generateTexture(TEXTURE_KEY, size, size);
    g.destroy();
  }
}
