/**
 * PrayerBell.ts — a rare, high-value pickup: a golden temple/prayer bell. Each one is a
 * blessing worth +1 life, placed up on platforms to reward exploring.
 *
 * VISIBILITY: drawn at a LARGE native size (64px) with a bold dark outline and a bright
 * gold pulsing glow ring behind it, so the rare bell is unmistakable. Idle motion is a
 * centre-pivoted glint (no Y translation → no pixel-rounding shimmer). 100% original art.
 */
import Phaser from 'phaser';

const TEXTURE_KEY = 'prayer-bell';
const TEX_SIZE = 88; // large native texture (was 30 → too small/invisible)

export class PrayerBell extends Phaser.Physics.Arcade.Sprite {
  private collected = false;
  private glow?: Phaser.GameObjects.Arc;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    PrayerBell.ensureTexture(scene);

    // Bright gold pulsing glow behind the bell (drawn before super → lower in z-order).
    const glow = scene.add.circle(x, y, 44, 0xf3c623, 0.42).setDepth(2);
    scene.tweens.add({
      targets: glow,
      scale: { from: 0.85, to: 1.5 },
      alpha: { from: 0.55, to: 0.16 },
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });

    super(scene, x, y, TEXTURE_KEY);
    this.glow = glow;
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setOrigin(0.5, 0.5);
    this.setDepth(3);

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setImmovable(true);
    body.setCircle(26, TEX_SIZE / 2 - 26, TEX_SIZE / 2 - 26);

    // Centre-pivoted glint only (no Y translation → no shimmer).
    scene.tweens.add({
      targets: this,
      scale: 1.12,
      duration: 650,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });
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
      scale: 2,
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
    const top = 22; // top of the bell body
    const bot = 62; // bottom (rim) of the bell body
    const halfTop = 14;
    const halfBot = 26;
    const outline = 0x5a3e0b;

    // Dark outline shell behind the bell so it reads on any backdrop.
    g.fillStyle(outline, 1);
    g.beginPath();
    g.moveTo(cx - halfBot - 4, bot + 4);
    g.lineTo(cx - halfTop - 4, top - 3);
    g.lineTo(cx + halfTop + 4, top - 3);
    g.lineTo(cx + halfBot + 4, bot + 4);
    g.closePath();
    g.fillPath();
    g.fillEllipse(cx, bot + 4, (halfBot + 4) * 2, 16);

    // Golden bell body.
    g.fillStyle(0xe8b93a, 1);
    g.beginPath();
    g.moveTo(cx - halfBot, bot);
    g.lineTo(cx - halfTop, top);
    g.lineTo(cx + halfTop, top);
    g.lineTo(cx + halfBot, bot);
    g.closePath();
    g.fillPath();
    g.fillEllipse(cx, bot, halfBot * 2, 13); // flared rim

    // Lighter highlight down the left face.
    g.fillStyle(0xfff2c9, 1);
    g.fillRect(cx - 9, top + 6, 6, bot - top - 10);

    // Top loop + clapper.
    g.fillStyle(0xc9971f, 1);
    g.fillRect(cx - 4, top - 12, 8, 12); // loop stem
    g.lineStyle(3, outline, 1);
    g.strokeCircle(cx, top - 14, 6);
    g.fillStyle(0xc9971f, 1);
    g.fillCircle(cx, bot + 9, 5); // clapper below the rim

    g.generateTexture(TEXTURE_KEY, S, S);
    g.destroy();
  }
}
