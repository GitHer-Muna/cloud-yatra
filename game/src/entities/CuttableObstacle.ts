/**
 * CuttableObstacle.ts — an obstacle on the path that the Yatrini can slash apart with her
 * KHUKURI. These are the natural tangles a hill traveler really clears with a khukuri:
 *   - 'thorn'  : a thicket of thorn bush (kaande jhaadi) in the Terai lowlands.
 *   - 'bamboo' : a clump of tall bamboo (baans) barring the hill trail.
 *   - 'nettle' : a patch of stinging nettle / vines (sisnu) on the high path.
 *   - 'khar'   : dry tall elephant-grass (khar, cut for thatch roofs) in the Terai.
 *   - 'lahara' : a hanging forest creeper/vine curtain (lahara) on the hill trail.
 *
 * BEHAVIOUR:
 *   - It is a STATIC, immovable body sitting on the ground. Touching it (walking into it)
 *     costs the Yatrini a life — so it is a real obstacle, not just decoration.
 *   - A khukuri swing whose hitbox overlaps it CUTS it: it plays a quick fall-apart tween,
 *     awards points, and is removed so the path opens. This is the core new verb.
 *
 * All art is 100% original, drawn procedurally in code (no external files). See CREDITS.md.
 */
import Phaser from 'phaser';

export type CuttableKind = 'thorn' | 'bamboo' | 'nettle' | 'khar' | 'lahara';

const TEXTURE_PREFIX = 'cuttable-';

export class CuttableObstacle extends Phaser.Physics.Arcade.Sprite {
  private cutDone = false;
  readonly kind: CuttableKind;

  constructor(scene: Phaser.Scene, x: number, groundTopY: number, kind: CuttableKind) {
    CuttableObstacle.ensureTexture(scene, kind);
    // Anchor the sprite so its BOTTOM sits on the ground line.
    super(scene, x, groundTopY, `${TEXTURE_PREFIX}${kind}`);
    this.kind = kind;

    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setOrigin(0.5, 1); // bottom-centre on the ground
    this.setDepth(1);

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setImmovable(true);
    // Slim the collision box so it feels fair (narrower than the drawn foliage).
    const w = this.width * 0.5;
    const h = this.height * 0.9;
    body.setSize(w, h);
    // With origin (0.5, 1) the body offset must place the box over the drawn art.
    body.setOffset((this.width - w) / 2, this.height - h);
  }

  /** True once this obstacle has been cut (so the scene stops treating it as a hazard). */
  isCut(): boolean {
    return this.cutDone;
  }

  /**
   * Cut the obstacle apart with the khukuri: a quick fall-apart flourish, then remove it.
   * Returns false if it was already cut (so points aren't awarded twice).
   */
  cut(): boolean {
    if (this.cutDone) return false;
    this.cutDone = true;
    // Disable its physics immediately so the now-open path is passable this frame.
    (this.body as Phaser.Physics.Arcade.Body).enable = false;

    // A couple of "chopped" pieces fly off, then the stump fades.
    const pieces = 5;
    for (let i = 0; i < pieces; i++) {
      const piece = this.scene.add
        .rectangle(
          this.x + Phaser.Math.Between(-8, 8),
          this.y - Phaser.Math.Between(6, this.height - 6),
          Phaser.Math.Between(4, 8),
          Phaser.Math.Between(4, 8),
          this.tintTopLeft || 0x2f7d4f,
        )
        .setDepth(2);
      this.scene.tweens.add({
        targets: piece,
        x: piece.x + Phaser.Math.Between(-40, 40),
        y: piece.y - Phaser.Math.Between(10, 40),
        angle: Phaser.Math.Between(-180, 180),
        alpha: 0,
        duration: Phaser.Math.Between(320, 520),
        ease: 'Quad.out',
        onComplete: () => piece.destroy(),
      });
    }
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      scaleY: 0.2,
      duration: 180,
      ease: 'Quad.in',
      onComplete: () => this.destroy(),
    });
    return true;
  }

  private static ensureTexture(scene: Phaser.Scene, kind: CuttableKind): void {
    const key = `${TEXTURE_PREFIX}${kind}`;
    if (scene.textures.exists(key)) return;
    const g = scene.add.graphics();

    if (kind === 'thorn') {
      // A low, wide thorn thicket: tangled dark-green mass with pale thorn spikes.
      const w = 56;
      const h = 46;
      g.fillStyle(0x2f6a2a, 1);
      g.fillEllipse(w / 2, h - 10, 52, 30);
      g.fillStyle(0x3f7d34, 1);
      g.fillEllipse(w / 2 - 8, h - 16, 26, 20);
      g.fillEllipse(w / 2 + 10, h - 14, 24, 18);
      // Thorn spikes poking out.
      g.fillStyle(0xcdb98a, 1);
      const spikes: Array<[number, number, number, number, number, number]> = [
        [8, h - 18, 2, h - 34, 14, h - 20],
        [22, h - 26, 18, h - 42, 28, h - 26],
        [36, h - 24, 40, h - 40, 44, h - 22],
        [48, h - 16, 54, h - 30, 50, h - 14],
      ];
      for (const [x1, y1, x2, y2, x3, y3] of spikes) g.fillTriangle(x1, y1, x2, y2, x3, y3);
      // A few red berries for the Terai look.
      g.fillStyle(0xe0294a, 1);
      g.fillCircle(18, h - 20, 2.5);
      g.fillCircle(38, h - 16, 2.5);
      g.generateTexture(key, w, h);
    } else if (kind === 'bamboo') {
      // A clump of three tall bamboo canes with segment nodes + a few leaves.
      const w = 40;
      const h = 96;
      const cane = (cx: number, top: number, shade: number) => {
        g.fillStyle(shade, 1);
        g.fillRect(cx - 3, top, 6, h - top);
        // Segment nodes.
        g.fillStyle(0x6f8f2f, 1);
        for (let y = top + 12; y < h; y += 18) g.fillRect(cx - 4, y, 8, 2);
      };
      cane(12, 10, 0x8bbf3a);
      cane(22, 2, 0x9ccf47);
      cane(30, 18, 0x7aae30);
      // Leaves near the tops.
      g.fillStyle(0x3f8d34, 1);
      g.fillTriangle(22, 2, 34, -6, 26, 8);
      g.fillTriangle(22, 2, 10, -6, 18, 8);
      g.fillTriangle(12, 10, 2, 4, 8, 16);
      g.generateTexture(key, w, Math.max(1, h));
    } else if (kind === 'nettle') {
      // Nettle / vine patch: clumped stinging-nettle leaves on thin stalks.
      const w = 48;
      const h = 52;
      g.fillStyle(0x2f7d4f, 1);
      // Stalks.
      for (const sx of [12, 24, 36]) {
        g.fillRect(sx - 1, h - 34, 2, 34);
      }
      // Serrated leaf clusters.
      const leaf = (cx: number, cy: number, s: number, col: number) => {
        g.fillStyle(col, 1);
        g.fillTriangle(cx, cy - s, cx - s, cy + s, cx + s, cy + s);
      };
      leaf(12, h - 30, 8, 0x3f9d5f);
      leaf(24, h - 40, 10, 0x2f7d4f);
      leaf(36, h - 30, 8, 0x3f9d5f);
      leaf(18, h - 20, 7, 0x4fae6f);
      leaf(30, h - 20, 7, 0x4fae6f);
      // Fine stinging hairs (pale dots).
      g.fillStyle(0xd8f0d8, 0.9);
      g.fillCircle(24, h - 46, 1.5);
      g.fillCircle(12, h - 36, 1.5);
      g.fillCircle(36, h - 36, 1.5);
      g.generateTexture(key, w, h);
    } else if (kind === 'khar') {
      // 'khar' — dry tall elephant-grass, the golden thatch-grass of the Terai. A dense
      // fan of straw-coloured blades leaning slightly, with a few seed plumes on top.
      const w = 50;
      const h = 88;
      // Warm dry-grass palette (pale straw → deeper ochre).
      const blades: Array<[number, number]> = [];
      const cols = [0xd9c27a, 0xe6cf87, 0xc9ad5f, 0xf0dc9a];
      // Build a fan of blades rooted along the base, splaying outward toward the top.
      for (let i = 0; i < 11; i++) {
        const rootX = 8 + i * 3.4;
        const lean = (i - 5) * 3.2; // outer blades lean further out
        const topX = rootX + lean;
        blades.push([rootX, topX]);
        g.fillStyle(cols[i % cols.length], 1);
        // A thin tapering blade from base to a point near the top.
        g.beginPath();
        g.moveTo(rootX - 2, h);
        g.lineTo(rootX + 2, h);
        g.lineTo(topX + 1, 8 + (i % 3) * 6);
        g.lineTo(topX - 1, 8 + (i % 3) * 6);
        g.closePath();
        g.fillPath();
      }
      // Fluffy seed plumes at a few blade tips.
      g.fillStyle(0xf3e8c8, 1);
      for (const [, topX] of [blades[2], blades[5], blades[8]]) {
        g.fillEllipse(topX, 8, 7, 12);
      }
      g.generateTexture(key, w, h);
    } else {
      // 'lahara' — a hanging forest creeper/vine curtain draped across the hill trail:
      // a woody top bar with trailing green vines, small leaves, and a couple of blooms.
      const w = 54;
      const h = 84;
      // The woody top branch the vines hang from.
      g.fillStyle(0x6b4a2f, 1);
      g.fillRect(0, 2, w, 6);
      // Trailing vines at several x positions, each a wavy vertical strand.
      const vineXs = [8, 18, 27, 36, 46];
      for (let v = 0; v < vineXs.length; v++) {
        const baseX = vineXs[v];
        g.fillStyle(v % 2 === 0 ? 0x3f8d34 : 0x2f7d4f, 1);
        const len = h - 12 - (v % 3) * 8;
        for (let y = 8; y < 8 + len; y += 4) {
          const wobble = Math.sin((y + v * 7) / 9) * 3;
          g.fillRect(baseX + wobble - 1, y, 3, 4);
        }
        // A few leaves along the vine.
        g.fillStyle(0x4fae6f, 1);
        for (let k = 1; k <= 3; k++) {
          const ly = 8 + (len * k) / 4;
          const wob = Math.sin((ly + v * 7) / 9) * 3;
          const side = k % 2 === 0 ? -1 : 1;
          g.fillTriangle(
            baseX + wob,
            ly,
            baseX + wob + side * 7,
            ly - 3,
            baseX + wob + side * 5,
            ly + 4,
          );
        }
      }
      // A couple of small rhododendron-red blooms tucked in the curtain.
      g.fillStyle(0xe0294a, 1);
      g.fillCircle(20, 34, 3);
      g.fillCircle(40, 52, 3);
      g.generateTexture(key, w, h);
    }
    g.destroy();
  }
}
