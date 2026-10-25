/**
 * RhododendronBloom.ts — the main collectible of Cloud Yatra (the "lali gurans", Nepal's
 * national flower). Collecting blooms builds the combo and completes garlands (+1 life).
 *
 * CONCEPT: a flower GROWS FROM THE GROUND — it is NOT a coin floating in the sky. The
 * sprite is drawn as a flower head on a short stem and is placed so the base of the stem
 * sits ON the walking surface (origin at the bottom-centre). The player collects it by
 * simply walking past it on the trail.
 *
 * SIZE: the flower head is sized to read clearly but stay PROPORTIONATE to the ~45×60px
 * traveller — roughly half her height. A soft pulsing glow marks it as a pickup. 100%
 * original art.
 */
import Phaser from 'phaser';
import { PALETTE } from '../config/constants';

const TEXTURE_KEY = 'rhodo-bloom';
// Native texture canvas. The flower head occupies the TOP portion; a short stem drops to
// the bottom so the plant visually "grows" from the ground it is placed on. The canvas is
// sized with enough headroom at the top that the full flower head (petals + white halo)
// fits WITHOUT clipping at the canvas edge — the head's radius with halo is ~18px, so the
// head centre must sit at least that far below the top.
const TEX_SIZE = 40;
// Head centre, measured from the TOP of the canvas. Chosen so the head (petal ring 8 +
// petal radius 8 + 1.5px white halo ≈ 17.5px) clears the top edge, leaving a tall stem
// below. Shared by the texture drawing and the external glow placement so they align.
const HEAD_OFFSET_FROM_TOP = 19;

export type BloomVariant = 'marigold' | 'rhododendron' | 'himalPoppy';

// Per-variant colours, each botanically mapped to where it actually grows in Nepal:
//  - marigold (sayapatri): the cultivated garland flower of Terai villages (Tihar malas).
//  - rhododendron (lali gurans): Nepal's national flower, of the MIDDLE HILLS / lower
//    subalpine forest — not the high glacier zone.
//  - himalPoppy (the blue Himalayan poppy, Meconopsis): a true high-altitude alpine
//    bloom for the Himal region, so the summit flora is honest to its elevation.
const VARIANT_COLORS: Record<BloomVariant, { petal: number; dark: number; glow: number }> = {
  marigold: { petal: 0xffa41e, dark: 0xd97a0a, glow: 0xffb020 },
  rhododendron: { petal: 0xe0294a, dark: 0xb01d38, glow: 0xff3b6b },
  himalPoppy: { petal: 0x4f8fe0, dark: 0x2f5aa8, glow: 0x7fb0e6 },
};

export class RhododendronBloom extends Phaser.Physics.Arcade.Sprite {
  private collected = false;
  private glow?: Phaser.GameObjects.Arc;

  /**
   * @param x  world x of the plant.
   * @param y  the SURFACE top the flower grows from (its stem base rests here).
   */
  constructor(scene: Phaser.Scene, x: number, y: number, variant: BloomVariant = 'rhododendron') {
    RhododendronBloom.ensureTexture(scene, variant);
    const col = VARIANT_COLORS[variant];

    // Soft pulsing glow centred on the flower HEAD (upper portion of the sprite), behind
    // it. With a bottom-centre origin, the head centre sits (TEX_SIZE - headOffset) px
    // above the base `y` — keep this in sync with the texture's head position.
    const headY = y - (TEX_SIZE - HEAD_OFFSET_FROM_TOP);
    const glow = scene.add.circle(x, headY, 12, col.glow, 0.34).setDepth(2);
    scene.tweens.add({
      targets: glow,
      scale: { from: 0.85, to: 1.35 },
      alpha: { from: 0.42, to: 0.12 },
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });

    super(scene, x, y, `${TEXTURE_KEY}-${variant}`);
    this.glow = glow;

    scene.add.existing(this);
    scene.physics.add.existing(this);
    // Origin at the BOTTOM-centre so the stem base sits exactly on the surface `y`.
    this.setOrigin(0.5, 1);
    this.setDepth(3); // above terrain and the player

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setImmovable(true);
    // Pickup box = the full plant (head + stem), so a walking player collects it on the
    // ground path. With a bottom origin the body offset is measured from the top-left.
    body.setSize(TEX_SIZE, TEX_SIZE);
    body.setOffset(0, 0);

    // Gentle breathing sway of the flower head (centre-pivoted via the glow + a subtle
    // scale on the sprite). No Y translation → no pixel-rounding shimmer.
    scene.tweens.add({
      targets: this,
      scaleX: 1.06,
      scaleY: 0.96,
      duration: 1100,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });
    scene.tweens.add({
      targets: this,
      angle: { from: -4, to: 4 },
      duration: 1600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });
  }

  isCollected(): boolean {
    return this.collected;
  }

  /**
   * Extend the pickup hitbox DOWNWARD by `px` pixels (the visual stays put). Used when a
   * bloom sits on an elevated platform: a player jumping up from the ground below should
   * collect it as the jump arc reaches the ledge, without having to land perfectly on top.
   */
  extendPickupDownward(px: number): void {
    if (px <= 0) return;
    const body = this.body as Phaser.Physics.Arcade.Body;
    // With a bottom-centre origin, the body's top-left offset is measured from the top of
    // the texture; growing the height and keeping offset.y=0 stretches the box downward
    // past the stem base into the airspace below the ledge.
    body.setSize(TEX_SIZE, TEX_SIZE + px);
    body.setOffset(0, 0);
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
      scale: 1.6,
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
    const cx = S / 2;
    // Flower head sits in the upper portion with enough top headroom that no petal is
    // clipped; the stem fills the lower portion down to the base (bottom of canvas).
    const headY = HEAD_OFFSET_FROM_TOP;
    const petalR = 8; // petal size, proportionate to the canvas
    const ring = 8; // distance of petals from the head centre

    // Green stem + two small leaves, from the head down to the base (bottom of canvas).
    g.fillStyle(PALETTE.rhodoLeaf, 1);
    g.fillRect(cx - 2, headY, 4, S - headY); // stem to the ground
    g.fillTriangle(cx - 1, headY + 12, cx - 12, headY + 9, cx - 2, headY + 3);
    g.fillTriangle(cx + 1, headY + 16, cx + 12, headY + 13, cx + 2, headY + 7);

    // Five bold petals with a WHITE outline each so the flower reads on any backdrop.
    const petal = (fill: number, r: number) => {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        g.fillStyle(fill, 1);
        g.fillCircle(cx + Math.cos(a) * ring, headY + Math.sin(a) * ring, r);
      }
    };
    petal(0xffffff, petalR + 1.5); // white halo/outline
    petal(col.petal, petalR); // bold region-coloured petals

    // Darker centre + bright golden pistil.
    g.fillStyle(col.dark, 1);
    g.fillCircle(cx, headY, 5.5);
    g.fillStyle(PALETTE.prayerYellow, 1);
    g.fillCircle(cx, headY, 3);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(cx - 1, headY - 1, 1.1);

    g.generateTexture(key, S, S);
    g.destroy();
  }
}
