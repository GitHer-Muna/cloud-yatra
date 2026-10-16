/**
 * Checkpoint.ts — a pole where Yatri "plants the pennant" (Nepal-flag-shaped) to set
 * a respawn point. Starts as a bare pole; when the Yatri reaches it, the double-pennant
 * unfurls and it glows. It's an overlap sensor (touch, not push). Original art in code.
 *
 * FIX: the sensor sprite previously used an EMPTY texture key ('') which makes Phaser
 * emit a "missing texture" green box + console warnings. We now generate a tiny 1x1
 * transparent texture once and use that as the sensor key — no warnings, nothing drawn.
 */
import Phaser from 'phaser';
import { PALETTE } from '../config/constants';

const SENSOR_KEY = '__transparent_sensor__';

export class Checkpoint extends Phaser.Physics.Arcade.Sprite {
  private planted = false;
  private pennant: Phaser.GameObjects.Graphics;
  readonly worldX: number;
  readonly groundTopY: number;

  constructor(scene: Phaser.Scene, x: number, groundTopY: number) {
    Checkpoint.ensureSensorTexture(scene);
    // A thin invisible sensor sprite at the pole; visuals are drawn separately.
    super(scene, x, groundTopY - 60, SENSOR_KEY);
    this.worldX = x;
    this.groundTopY = groundTopY;

    scene.add.existing(this);
    scene.physics.add.existing(this);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setImmovable(true);
    body.setSize(34, 130);
    this.setVisible(false); // the sprite itself is just the sensor

    // Draw the pole (weathered wood) with a base stone so it reads as a waypoint cairn.
    const pole = scene.add.graphics().setDepth(-4);
    pole.fillStyle(PALETTE.flagPole, 1);
    pole.fillRect(x - 2, groundTopY - 130, 4, 130);
    pole.fillStyle(0x9a8f7a, 1);
    pole.fillRect(x - 3, groundTopY - 132, 6, 4); // finial
    // Small mani-stone cairn at the base (a respectful roadside waypoint motif).
    pole.fillStyle(0x8d8676, 1);
    pole.fillEllipse(x, groundTopY, 26, 10);
    pole.fillStyle(0x736c5e, 1);
    pole.fillEllipse(x, groundTopY - 6, 18, 9);
    pole.fillStyle(0x9a9284, 1);
    pole.fillEllipse(x, groundTopY - 11, 10, 7);

    // Pennant graphics (empty until planted).
    this.pennant = scene.add.graphics().setDepth(-3);
  }

  isPlanted(): boolean {
    return this.planted;
  }

  /** Plant the pennant: unfurl the Nepal-flag-shaped double triangle + glow. */
  plant(): boolean {
    if (this.planted) return false;
    this.planted = true;

    const x = this.worldX + 2;
    const top = this.groundTopY - 128;
    this.redrawPennant(x, top, 1);

    // Gentle wave animation on the planted pennant.
    let t = 0;
    this.scene.time.addEvent({
      delay: 60,
      loop: true,
      callback: () => {
        t += 0.2;
        const wave = 1 + Math.sin(t) * 0.06;
        this.redrawPennant(x, top, wave);
      },
    });

    // Glow flash on plant.
    const glow = this.scene.add
      .circle(this.worldX, this.groundTopY - 60, 40, PALETTE.checkpointGlow, 0.5)
      .setDepth(-5);
    this.scene.tweens.add({
      targets: glow,
      alpha: 0,
      scale: 1.8,
      duration: 500,
      onComplete: () => glow.destroy(),
    });
    return true;
  }

  private redrawPennant(x: number, top: number, waveScale: number): void {
    const g = this.pennant;
    g.clear();
    const drawPennant = (topY: number, height: number) => {
      const width = 46 * waveScale;
      g.fillStyle(PALETTE.flagBlue, 1);
      g.beginPath();
      g.moveTo(x, topY);
      g.lineTo(x + width + 5, topY + height * 0.5);
      g.lineTo(x, topY + height);
      g.closePath();
      g.fillPath();
      g.fillStyle(PALETTE.flagCrimson, 1);
      g.beginPath();
      g.moveTo(x + 3, topY + 4);
      g.lineTo(x + width, topY + height * 0.5);
      g.lineTo(x + 3, topY + height - 4);
      g.closePath();
      g.fillPath();
      // Tiny white sun/moon emblem hints (abstract, non-photographic).
      g.fillStyle(0xffffff, 0.9);
      g.fillCircle(x + 10, topY + height * 0.5, 1.6);
    };
    drawPennant(top, 36);
    drawPennant(top + 34, 42);
  }

  /** Generate a 1x1 fully-transparent texture once, used for invisible sensors. */
  private static ensureSensorTexture(scene: Phaser.Scene): void {
    if (scene.textures.exists(SENSOR_KEY)) return;
    const g = scene.add.graphics();
    g.fillStyle(0x000000, 0); // fully transparent
    g.fillRect(0, 0, 1, 1);
    g.generateTexture(SENSOR_KEY, 1, 1);
    g.destroy();
  }
}
