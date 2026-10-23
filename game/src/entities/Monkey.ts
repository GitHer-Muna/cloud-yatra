/**
 * Monkey.ts — a Terai jungle hazard: a cheeky macaque that paces a stretch of the trail,
 * hopping back and forth. Predictable (no chasing/pathfinding), like the other hazards —
 * watch its pace and time your move. Touch costs the Yatri a life.
 *
 * Replaces the earlier placeholder (a brown-tinted MistWisp) with distinct, readable
 * original art + a little hop so it clearly reads as a monkey on the jungle path. 100%
 * original art, drawn in code.
 */
import Phaser from 'phaser';

const TEXTURE_KEY = 'monkey';

export class Monkey extends Phaser.Physics.Arcade.Sprite {
  private minX: number;
  private maxX: number;
  private speed: number;
  private baseY: number;
  private hopPhase = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, range: number, speed: number) {
    Monkey.ensureTexture(scene);
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

  /** Pace left↔right with a small hop. Call each frame. */
  patrol(): void {
    if (this.x <= this.minX) {
      this.setVelocityX(this.speed);
      this.setFlipX(false);
    } else if (this.x >= this.maxX) {
      this.setVelocityX(-this.speed);
      this.setFlipX(true);
    }
    // Little hopping bob so it reads as a lively animal, not a static sprite.
    this.hopPhase += 0.18;
    this.y = this.baseY - Math.abs(Math.sin(this.hopPhase)) * 8;
    (this.body as Phaser.Physics.Arcade.Body).updateFromGameObject?.();
  }

  private static ensureTexture(scene: Phaser.Scene): void {
    if (scene.textures.exists(TEXTURE_KEY)) return;
    const g = scene.add.graphics();
    const w = 30;
    const h = 30;
    const cx = w / 2;
    const fur = 0x7a5536; // brown fur
    const furDark = 0x5c3f27;
    const face = 0xe8c6a0; // pale muzzle/face
    const outline = 0x3a2817;

    // Tail (curled behind).
    g.lineStyle(3, furDark, 1);
    g.beginPath();
    g.arc(cx - 9, h - 10, 6, Phaser.Math.DegToRad(300), Phaser.Math.DegToRad(120));
    g.strokePath();

    // Body.
    g.fillStyle(fur, 1);
    g.fillEllipse(cx, h - 11, 16, 16);
    // Limbs.
    g.fillStyle(furDark, 1);
    g.fillEllipse(cx - 6, h - 5, 5, 8);
    g.fillEllipse(cx + 6, h - 5, 5, 8);

    // Head.
    g.fillStyle(fur, 1);
    g.fillCircle(cx + 3, 10, 9);
    // Ears.
    g.fillCircle(cx - 4, 8, 3.5);
    g.fillCircle(cx + 10, 8, 3.5);
    // Face/muzzle.
    g.fillStyle(face, 1);
    g.fillEllipse(cx + 4, 12, 9, 8);
    // Eyes.
    g.fillStyle(outline, 1);
    g.fillCircle(cx + 1, 10, 1.4);
    g.fillCircle(cx + 7, 10, 1.4);
    // Nostrils + mouth line.
    g.fillCircle(cx + 3, 13, 0.8);
    g.fillCircle(cx + 5, 13, 0.8);
    g.lineStyle(1, outline, 1);
    g.beginPath();
    g.arc(cx + 4, 14, 2.4, Phaser.Math.DegToRad(20), Phaser.Math.DegToRad(160));
    g.strokePath();

    g.generateTexture(TEXTURE_KEY, w, h);
    g.destroy();
  }
}
