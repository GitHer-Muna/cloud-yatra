/**
 * PrayerBell.ts — a rare, high-value pickup: a golden temple/prayer bell. Each one is a
 * blessing worth +1 life, placed along the trail to reward exploring.
 *
 * CONCEPT: the bell rests ON the walking surface (origin at the bottom-centre), not
 * floating in the sky. It is a little larger than a bloom because it is rare and valuable,
 * but it stays PROPORTIONATE to the ~45×60px traveller. A gold pulsing glow and a subtle
 * glint mark it as a pickup. 100% original art.
 */
import Phaser from 'phaser';

const TEXTURE_KEY = 'prayer-bell';
const TEX_SIZE = 28; // compact native texture, proportionate to the ~45×60px traveller

export class PrayerBell extends Phaser.Physics.Arcade.Sprite {
  private collected = false;
  private glow?: Phaser.GameObjects.Arc;

  /**
   * @param x  world x of the bell.
   * @param y  the SURFACE top the bell rests on (its base sits here).
   */
  constructor(scene: Phaser.Scene, x: number, y: number) {
    PrayerBell.ensureTexture(scene);

    // Gold pulsing glow centred on the bell body (upper-middle of the sprite), behind it.
    const bodyY = y - TEX_SIZE * 0.5;
    const glow = scene.add.circle(x, bodyY, 12, 0xf3c623, 0.4).setDepth(2);
    scene.tweens.add({
      targets: glow,
      scale: { from: 0.85, to: 1.4 },
      alpha: { from: 0.5, to: 0.14 },
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });

    super(scene, x, y, TEXTURE_KEY);
    this.glow = glow;
    scene.add.existing(this);
    scene.physics.add.existing(this);
    // Origin at the BOTTOM-centre so the bell base rests exactly on the surface `y`.
    this.setOrigin(0.5, 1);
    this.setDepth(3);

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setImmovable(true);
    // Pickup box covers the whole bell so a walking player collects it on the ground path.
    body.setSize(TEX_SIZE, TEX_SIZE);
    body.setOffset(0, 0);

    // Centre-pivoted glint only (gentle scale, no Y translation → no shimmer).
    scene.tweens.add({
      targets: this,
      scale: 1.08,
      duration: 650,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });
  }

  /**
   * Extend the pickup hitbox DOWNWARD by `px` pixels (the visual stays put), so a bell on
   * an elevated ledge can be collected by a jump rising from the ground below.
   */
  extendPickupDownward(px: number): void {
    if (px <= 0) return;
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setSize(TEX_SIZE, TEX_SIZE + px);
    body.setOffset(0, 0);
  }

  collect(): boolean {
    if (this.collected) return false;
    this.collected = true;
    (this.body as Phaser.Physics.Arcade.Body).enable = false;
    this.scene.tweens.killTweensOf(this);
    if (this.glow) {
      this.scene.tweens.killTweensOf(this.glow);
      this.scene.tweens.add({
        targets: this.glow,
        scale: 2.4,
        alpha: 0,
        duration: 300,
        onComplete: () => this.glow?.destroy(),
      });
    }
    this.scene.tweens.add({
      targets: this,
      scale: 1.7,
      alpha: 0,
      duration: 300,
      ease: 'Quad.out',
      onComplete: () => this.destroy(),
    });
    return true;
  }

  private static ensureTexture(scene: Phaser.Scene): void {
    if (scene.textures.exists(TEXTURE_KEY)) return;
    const g = scene.add.graphics();
    const S = TEX_SIZE;
    const cx = S / 2;
    // Proportional layout so the bell scales cleanly with TEX_SIZE.
    const top = S * 0.26; // top of the bell body
    const bot = S * 0.82; // bottom (rim) of the bell body
    const halfTop = S * 0.17;
    const halfBot = S * 0.31;
    const o = S * 0.05; // outline thickness offset
    const outline = 0x5a3e0b;

    // Dark outline shell behind the bell so it reads on any backdrop.
    g.fillStyle(outline, 1);
    g.beginPath();
    g.moveTo(cx - halfBot - o, bot + o);
    g.lineTo(cx - halfTop - o, top - o);
    g.lineTo(cx + halfTop + o, top - o);
    g.lineTo(cx + halfBot + o, bot + o);
    g.closePath();
    g.fillPath();
    g.fillEllipse(cx, bot + o, (halfBot + o) * 2, S * 0.19);

    // Golden bell body.
    g.fillStyle(0xe8b93a, 1);
    g.beginPath();
    g.moveTo(cx - halfBot, bot);
    g.lineTo(cx - halfTop, top);
    g.lineTo(cx + halfTop, top);
    g.lineTo(cx + halfBot, bot);
    g.closePath();
    g.fillPath();
    g.fillEllipse(cx, bot, halfBot * 2, S * 0.15); // flared rim

    // Lighter highlight down the left face.
    g.fillStyle(0xfff2c9, 1);
    g.fillRect(cx - halfTop * 0.6, top + S * 0.08, S * 0.06, bot - top - S * 0.15);

    // Top loop + clapper.
    g.fillStyle(0xc9971f, 1);
    g.fillRect(cx - S * 0.04, top - S * 0.15, S * 0.08, S * 0.15); // loop stem
    g.lineStyle(Math.max(1, S * 0.04), outline, 1);
    g.strokeCircle(cx, top - S * 0.17, S * 0.075);
    g.fillStyle(0xc9971f, 1);
    g.fillCircle(cx, bot + S * 0.1, S * 0.06); // clapper below the rim

    g.generateTexture(TEXTURE_KEY, S, S);
    g.destroy();
  }
}
