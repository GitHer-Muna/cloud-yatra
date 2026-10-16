/**
 * RhododendronBloom.ts — the main collectible of Cloud Yatra (the "lali gurans", Nepal's
 * national flower). Collecting blooms builds the combo and completes garlands (+1 life).
 *
 * VISIBILITY: drawn at a LARGE native size (64px) with bold, high-contrast petals and a
 * white outline, plus a bright pulsing glow ring behind it — so it is unmistakable on the
 * trail against any backdrop. Idle motion is a gentle centre-pivoted scale/sway (no Y
 * translation, which shimmered under the camera's pixel rounding). 100% original art.
 */
import Phaser from 'phaser';
import { PALETTE } from '../config/constants';

const TEXTURE_KEY = 'rhodo-bloom';
const TEX_SIZE = 88; // large native texture (was 26 → too small to see)

export type BloomVariant = 'marigold' | 'rhododendron';

// Per-variant colours. Rhododendron (lali gurans) is Nepal's hill/Himalayan national
// flower; the subtropical Terai lowlands instead get warm marigold (sayapatri) blooms —
// botanically truer to where each actually grows in Nepal.
const VARIANT_COLORS: Record<BloomVariant, { petal: number; dark: number; glow: number }> = {
  marigold: { petal: 0xffa41e, dark: 0xd97a0a, glow: 0xffb020 },
  rhododendron: { petal: 0xe0294a, dark: 0xb01d38, glow: 0xff3b6b },
};

export class RhododendronBloom extends Phaser.Physics.Arcade.Sprite {
  private collected = false;
  private glow?: Phaser.GameObjects.Arc;

  constructor(scene: Phaser.Scene, x: number, y: number, variant: BloomVariant = 'rhododendron') {
    RhododendronBloom.ensureTexture(scene, variant);
    const col = VARIANT_COLORS[variant];

    // Bright pulsing glow ring BEHIND the bloom (drawn before super → lower in z-order).
    const glow = scene.add.circle(x, y, 40, col.glow, 0.38).setDepth(2);
    scene.tweens.add({
      targets: glow,
      scale: { from: 0.85, to: 1.45 },
      alpha: { from: 0.5, to: 0.14 },
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });

    super(scene, x, y, `${TEXTURE_KEY}-${variant}`);
    this.glow = glow;

    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setOrigin(0.5, 0.5);
    this.setDepth(3); // above terrain and the player

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setImmovable(true);
    // A tall, generous pickup box: full texture width, and extending well BELOW the
    // flower so a player walking on the ground collects a raised bloom without jumping.
    body.setSize(TEX_SIZE, TEX_SIZE + 48);
    body.setOffset(0, 0);

    // Gentle breathing + sway (centre-pivoted; no shimmer). No base scale — the texture
    // is already large.
    scene.tweens.add({
      targets: this,
      scaleX: 1.08,
      scaleY: 0.92,
      duration: 1100,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });
    scene.tweens.add({
      targets: this,
      angle: { from: -5, to: 5 },
      duration: 1600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });
  }

  isCollected(): boolean {
    return this.collected;
  }

  /** Pick up: returns true only the FIRST time (prevents double scoring). */
  collect(): boolean {
    if (this.collected) return false;
    this.collected = true;
    (this.body as Phaser.Physics.Arcade.Body).enable = false;
    this.scene.tweens.killTweensOf(this);
    if (this.glow) {
      this.scene.tweens.killTweensOf(this.glow);
      this.scene.tweens.add({
        targets: this.glow,
        scale: 2.2,
        alpha: 0,
        duration: 240,
        onComplete: () => this.glow?.destroy(),
      });
    }
    this.scene.tweens.add({
      targets: this,
      scale: 1.8,
      alpha: 0,
      angle: 0,
      duration: 240,
      ease: 'Quad.out',
      onComplete: () => this.destroy(),
    });
    return true;
  }

  private static ensureTexture(scene: Phaser.Scene, variant: BloomVariant): void {
    const key = `${TEXTURE_KEY}-${variant}`;
    if (scene.textures.exists(key)) return;
    const col = VARIANT_COLORS[variant];
    const g = scene.add.graphics();
    const S = TEX_SIZE;
    const c = S / 2;
    const petalR = 20; // bigger petals fill the larger canvas → clearly visible on screen
    const ring = 20; // distance of petals from centre

    // Green stem + two leaves (below the flower head), scaled up to match.
    g.fillStyle(PALETTE.rhodoLeaf, 1);
    g.fillRect(c - 4, c + 16, 8, 26);
    g.fillTriangle(c - 3, c + 30, c - 26, c + 24, c - 6, c + 16);
    g.fillTriangle(c + 3, c + 34, c + 26, c + 28, c + 6, c + 20);

    // Five bold petals with a WHITE outline each so the flower reads clearly on any
    // backdrop. Outline first (slightly larger), then the coloured fill on top.
    const petal = (fill: number, r: number) => {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        g.fillStyle(fill, 1);
        g.fillCircle(c + Math.cos(a) * ring, c + Math.sin(a) * ring, r);
      }
    };
    petal(0xffffff, petalR + 3.5); // white halo/outline
    petal(col.petal, petalR); // bold region-coloured petals

    // Darker centre + bright golden pistil.
    g.fillStyle(col.dark, 1);
    g.fillCircle(c, c, 14);
    g.fillStyle(PALETTE.prayerYellow, 1);
    g.fillCircle(c, c, 7);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(c - 2.5, c - 2.5, 2.6);

    g.generateTexture(key, S, S);
    g.destroy();
  }
}
