/**
 * Checkpoint.ts — a pole where Yatri "plants the pennant" (Nepal-flag-shaped) to set
 * a respawn point. Starts as a bare pole; when the Yatri reaches it, the double-pennant
 * unfurls and it glows. It's an overlap sensor (touch, not push). Original art in code.
 *
 * The physics sensor uses a tiny 1×1 transparent texture (generated once) so Phaser has
 * a valid texture to attach the body to while nothing is actually drawn for it; the
 * visible pole and pennant are separate graphics.
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
    // Draw the pennant ONCE in LOCAL coordinates (hoist at local x=0) and position the
    // graphics object at the pole. Previously a 60ms loop timer cleared and fully re-drew
    // the double pennon ~16×/second forever (and was never removed on scene shutdown,
    // stacking per checkpoint). Now we draw once and flutter via a cheap GPU-side scaleX
    // yoyo pivoted at the pole — zero per-frame CPU redraw cost.
    this.pennant.setPosition(x, top);
    this.redrawPennant();

    const reducedMotion = Boolean(this.scene.registry.get('reducedMotion'));
    if (!reducedMotion) {
      // The graphics object (and any tween of it) is auto-cleaned by Phaser on scene
      // shutdown, so there is no manual timer teardown to leak.
      this.scene.tweens.add({
        targets: this.pennant,
        scaleX: { from: 1, to: 1.06 },
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.inOut',
      });
    }

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

  private redrawPennant(): void {
    const g = this.pennant;
    g.clear();
    // Nepal's flag carries TWO DISTINCT white emblems: a crescent MOON on the upper
    // pennon and a SUN on the lower, larger pennon. We draw them differently so the
    // national symbol reads correctly (drawing the same dot on both would misrepresent it).
    // Coordinates are LOCAL to the graphics object (hoist at x=0, top at y=0); the object
    // is positioned at the pole and fluttered via a scaleX tween.
    const drawPennant = (topY: number, height: number, emblem: 'moon' | 'sun') => {
      const x = 0;
      const width = 46;
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

      const ex = x + 11; // emblem x (toward the hoist)
      const ey = topY + height * 0.5; // emblem y (vertically centred on the pennon)
      g.fillStyle(0xffffff, 0.95);
      if (emblem === 'moon') {
        // Crescent: a white disc with a crimson disc offset to carve the crescent.
        g.fillCircle(ex, ey, 4);
        g.fillStyle(PALETTE.flagCrimson, 1);
        g.fillCircle(ex + 2, ey - 1, 3.2);
        // A few straight rays below the crescent (the moon pennon's emblem has rays too).
        g.fillStyle(0xffffff, 0.95);
        g.fillTriangle(ex - 3, ey + 4, ex + 3, ey + 4, ex, ey + 7);
      } else {
        // Sun: a white disc with short triangular rays all around.
        const R = 3.4;
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          g.fillTriangle(
            ex + Math.cos(a) * R,
            ey + Math.sin(a) * R,
            ex + Math.cos(a + 0.26) * R,
            ey + Math.sin(a + 0.26) * R,
            ex + Math.cos(a + 0.13) * (R + 3),
            ey + Math.sin(a + 0.13) * (R + 3),
          );
        }
        g.fillCircle(ex, ey, R);
      }
    };
    drawPennant(0, 36, 'moon'); // upper, smaller pennon → crescent moon
    drawPennant(34, 42, 'sun'); // lower, larger pennon → sun
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
