/**
 * Yatri.ts — the playable character: YATRINI, an original Nepali woman traveler in a
 * traditional gunyu-cholo (crimson blouse + saffron wrap-skirt with a green hem), a red
 * patuka sash, a dhaka-weave shawl, hair gathered in a bun with a red tika — and she
 * carries a KHUKURI, the iconic curved Nepali blade, which she can swing to cut through
 * certain obstacles on the path.
 *
 * ARCHITECTURE (kept deliberately simple + robust):
 *  - Yatri is a plain Arcade physics SPRITE. The physics body auto-aligns to the sprite,
 *    so there is NO manual offset math to get wrong (the previous container approach had
 *    fragile body-offset + art-base-Y alignment).
 *  - The ORIGINAL bug (jitter/desync) was mutating `setDisplayOrigin` every frame, which
 *    shifts the body. The fix: all per-frame animation is done with `setScale` (which
 *    pivots around the sprite's centre origin and does NOT move the physics body) — never
 *    by moving the sprite position or origin.
 *  - The KHUKURI SWING is a short-lived separate blade sprite drawn in front of the
 *    Yatrini; while it is active the scene can query `getAttackHitbox()` to cut obstacles.
 *  - TELEMETRY-READY: the Yatri never touches the network. It calls an optional `onEvent`
 *    callback for meaningful moments (jump, land, damaged, died, respawn, attack).
 *  - ART: 100% original, drawn in code (no external files). See CREDITS.md.
 */
import Phaser from 'phaser';
import { PLAYER, type YatriState } from '../config/playerConfig';
import type { Region } from '../config/levels';

export interface YatriEvent {
  type: 'jump' | 'land' | 'damaged' | 'died' | 'respawn' | 'state_change' | 'attack' | 'stomp';
  state?: YatriState;
  x: number;
  y: number;
}
export type YatriEventHandler = (event: YatriEvent) => void;

type DressPalette = {
  cholo: number;
  choloShade: number;
  choloTrim: number;
  gunyu: number;
  gunyuShade: number;
  gunyuHem: number;
  patuka: number;
  patukaShade: number;
  shawlBase: number;
  shawlRed: number;
  shawlBlue: number;
  shawlGreen: number;
};

/**
 * Respectful regional dress accents: the same Yatrini travels in one silhouette, while
 * colours/material cues change with the geography. These are original game-art palettes,
 * not claims that one outfit represents every Nepali community.
 */
const DRESS_BY_REGION: Record<Region, DressPalette> = {
  // Terai: warm cotton colours, marigold-gold accents and green lowland tones.
  terai: {
    cholo: 0xd8672d,
    choloShade: 0xa94722,
    choloTrim: 0xf3c11b,
    gunyu: 0x3f8f4f,
    gunyuShade: 0x2e6c3c,
    gunyuHem: 0xf3c11b,
    patuka: 0xd23b2e,
    patukaShade: 0xa82a20,
    shawlBase: 0xf6ead2,
    shawlRed: 0xe07b2c,
    shawlBlue: 0x1f5fbf,
    shawlGreen: 0x3f8f4f,
  },
  // Middle Hills: the original crimson, saffron and dhaka-weave contrast.
  hills: {
    cholo: 0xb61f36,
    choloShade: 0x8f142a,
    choloTrim: 0xf3c11b,
    gunyu: 0xef8a2b,
    gunyuShade: 0xcf6f1c,
    gunyuHem: 0x2f9e5a,
    patuka: 0xd23b2e,
    patukaShade: 0xa82a20,
    shawlBase: 0xf4ede0,
    shawlRed: 0xd23b2e,
    shawlBlue: 0x1f5fbf,
    shawlGreen: 0x2f9e5a,
  },
  // High Himalaya: deep wool-like blue/maroon layers with bright snow-visible trim.
  himal: {
    cholo: 0x304c86,
    choloShade: 0x1e315e,
    choloTrim: 0xf3c11b,
    gunyu: 0x8f3158,
    gunyuShade: 0x64213e,
    gunyuHem: 0xf4f8fc,
    patuka: 0xdc143c,
    patukaShade: 0xa30f2d,
    shawlBase: 0x7894ad,
    shawlRed: 0xdc143c,
    shawlBlue: 0x304c86,
    shawlGreen: 0xdfe9f5,
  },
};

const TEXTURE_PREFIX = 'yatri-';
const BLADE_KEY = 'khukuri-blade';

export class Yatri extends Phaser.Physics.Arcade.Sprite {
  private state_: YatriState = 'idle';
  private facing: 1 | -1 = 1;
  private spawnX: number;
  private spawnY: number;
  private walkTime = 0;
  private wasOnGround = true;
  private lives: number;
  private invulnerableUntil = 0;
  private onEvent?: YatriEventHandler;

  // Forgiving-jump timers.
  private lastGroundedAt = -1e9;
  private jumpBufferedAt = -1e9;
  private isJumpingUp = false;
  private jumpWasHeld = false;

  private attackUntil = 0; // while now < this, the swing (and hitbox) is active
  private attackCooldownUntil = 0; // earliest time the next swing may start
  private attackWasHeld = false; // rising-edge detection for the attack key
  private blade: Phaser.GameObjects.Sprite; // always-visible held khukuri; animated during attacks

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    startingLives: number,
    region: Region,
    onEvent?: YatriEventHandler,
  ) {
    Yatri.ensureTexture(scene, region);
    Yatri.ensureBladeTexture(scene);
    super(scene, x, y, `${TEXTURE_PREFIX}${region}`);

    this.spawnX = x;
    this.spawnY = y;
    this.lives = startingLives;
    this.onEvent = onEvent;

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setOrigin(0.5, 0.5);
    this.setCollideWorldBounds(false); // we handle "fell off the world" ourselves
    this.setDepth(1);

    // A physics box narrower/shorter than the drawn art, centered horizontally with its
    // bottom on the drawn feet (the figure is drawn feet-at-bottom on the pixel grid).
    const texW = PLAYER.gridCols * PLAYER.px;
    const texH = PLAYER.gridRows * PLAYER.px;
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setSize(PLAYER.width, PLAYER.height);
    body.setOffset((texW - PLAYER.width) / 2, texH - PLAYER.height);
    // Terminal velocity: capping fall speed means one big frame step can never move the
    // body further than the ground thickness, which prevents tunneling on slow displays.
    // The khukuri is part of her identity and remains visible even when she is idle. The
    // same sprite moves through the swing arc, so the visual and cutting hitbox agree.
    this.blade = scene.add
      .sprite(this.x, this.y, BLADE_KEY)
      .setDepth(2)
      .setScale(0.72);
    this.updateBlade();
  }

  /**
   * Per-frame movement. Accepts arrow cursors plus optional alternate keys (WASD).
   * Jump edge-detection is manual (tracking the previous held state) so merging two key
   * sources is robust.
   */
  updateFromInput(
    cursors: Phaser.Types.Input.Keyboard.CursorKeys,
    deltaMs: number,
    alt?: {
      left?: { isDown: boolean };
      right?: { isDown: boolean };
      up?: { isDown: boolean };
      attack?: { isDown: boolean };
    },
  ): void {
    const now = this.scene.time.now;
    const body = this.body as Phaser.Physics.Arcade.Body;
    const onGround = body.blocked.down || body.touching.down;
    if (onGround) this.lastGroundedAt = now;

    const left = Boolean(cursors.left?.isDown || alt?.left?.isDown);
    const right = Boolean(cursors.right?.isDown || alt?.right?.isDown);
    const speed = PLAYER.moveSpeed * (onGround ? 1 : PLAYER.airControl);
    if (left && !right) {
      this.setVelocityX(-speed);
      this.facing = -1;
    } else if (right && !left) {
      this.setVelocityX(speed);
      this.facing = 1;
    } else {
      this.setVelocityX(onGround ? 0 : body.velocity.x * 0.98);
    }

    // Khukuri swing (attack key). Manual rising-edge + cooldown so a held key doesn't
    // machine-gun. A swing does not interrupt movement or jumping — she can slash on the go.
    const attackHeld = Boolean(alt?.attack?.isDown);
    if (attackHeld && !this.attackWasHeld && now >= this.attackCooldownUntil) {
      this.startSwing(now);
    }
    this.attackWasHeld = attackHeld;
    this.updateBlade();

    // Jump (up-arrow / W / space). Manual rising-edge detection.
    const jumpHeld = Boolean(cursors.up?.isDown || cursors.space?.isDown || alt?.up?.isDown);
    if (jumpHeld && !this.jumpWasHeld) this.jumpBufferedAt = now;
    this.jumpWasHeld = jumpHeld;

    const canCoyote = now - this.lastGroundedAt <= PLAYER.coyoteMs;
    const hasBufferedJump = now - this.jumpBufferedAt <= PLAYER.jumpBufferMs;
    if (hasBufferedJump && canCoyote && (onGround || body.velocity.y >= 0)) {
      this.setVelocityY(-PLAYER.jumpVelocity);
      this.isJumpingUp = true;
      this.jumpBufferedAt = -1e9;
      this.lastGroundedAt = -1e9;
      this.emit_('jump');
    }

    // Variable jump height: releasing jump while rising cuts the ascent short.
    if (this.isJumpingUp && !jumpHeld && body.velocity.y < 0) {
      this.setVelocityY(body.velocity.y * PLAYER.cutJumpFactor);
      this.isJumpingUp = false;
    }
    if (body.velocity.y >= 0) this.isJumpingUp = false;

    if (onGround && !this.wasOnGround) this.emit_('land');
    this.wasOnGround = onGround;

    let next: YatriState;
    if (this.isAttacking()) next = 'attack';
    else if (!onGround) next = body.velocity.y < 0 ? 'jump' : 'fall';
    else if (Math.abs(body.velocity.x) > 1) next = 'walk';
    else next = 'idle';
    this.applyStateVisual(next, deltaMs);
  }

  getLives(): number {
    return this.lives;
  }
  isDead(): boolean {
    return this.lives <= 0;
  }
  isInvulnerable(): boolean {
    return this.scene.time.now < this.invulnerableUntil;
  }
  getVisualState(): YatriState {
    return this.state_;
  }

  /** True while a khukuri swing is active (its hitbox can cut obstacles). */
  isAttacking(): boolean {
    return this.scene.time.now < this.attackUntil;
  }

  /** Which way the Yatrini is facing (1 = right, -1 = left). */
  getFacing(): 1 | -1 {
    return this.facing;
  }

  /**
   * The world-space rectangle the khukuri sweeps this frame, in FRONT of the Yatrini.
   * Returns null when not attacking. The scene uses this to cut obstacles.
   */
  getAttackHitbox(): Phaser.Geom.Rectangle | null {
    if (!this.isAttacking()) return null;
    const reach = PLAYER.attack.reach;
    const h = PLAYER.attack.hitboxHeight;
    const bodyHalf = PLAYER.width / 2;
    const x = this.facing === 1 ? this.x + bodyHalf : this.x - bodyHalf - reach;
    return new Phaser.Geom.Rectangle(x, this.y - h / 2, reach, h);
  }

  /** A Mario-style stomp bounce after landing on an enemy's head. */
  bounceOffStomp(): void {
    this.setVelocityY(-PLAYER.jumpVelocity * 0.72);
    this.isJumpingUp = true;
    this.emit_('stomp');
  }

  /** True when fallen below the world (used by the scene). */
  hasFallenBelow(worldBottom: number): boolean {
    return this.y - this.height > worldBottom + PLAYER.fallLimitPadding;
  }

  /** Update where the Yatri respawns (called when a pennant is planted). */
  setCheckpoint(x: number, y: number): void {
    this.spawnX = x;
    this.spawnY = y;
  }

  /** Apply one hit; ignored while invulnerable. Returns true if a life was lost. */
  takeDamage(): boolean {
    if (this.isInvulnerable() || this.isDead()) return false;
    return this.applyDamage();
  }

  /**
   * Falling into the void: ALWAYS costs a life (ignores invulnerability — there is no
   * "recovering" from the bottom of the world). Returns true if a life was lost.
   */
  takeFallDamage(): boolean {
    if (this.isDead()) return false;
    return this.applyDamage();
  }

  /** Shared damage application: decrement a life, start invuln + the blink feedback. */
  private applyDamage(): boolean {
    this.lives -= 1;
    this.invulnerableUntil = this.scene.time.now + PLAYER.damageInvulnMs;

    // Brief knockback + blink so a hit reads clearly.
    this.setVelocity(-this.facing * 120, -180);
    this.setTint(0xff6b6b);
    this.scene.tweens.add({
      targets: this,
      alpha: 0.3,
      duration: 120,
      yoyo: true,
      repeat: Math.floor(PLAYER.damageInvulnMs / 240),
      onComplete: () => {
        this.clearTint();
        this.setAlpha(1);
      },
    });

    this.emit_('damaged');
    if (this.isDead()) this.emit_('died');
    return true;
  }

  /** Restore one life for the scene's one-time Pilgrim's Grace recovery. */
  restoreLifeForGrace(): void {
    this.lives = 1;
    this.invulnerableUntil = this.scene.time.now + PLAYER.damageInvulnMs * 2;
  }

  /**
   * Grant bonus lives from the reward economy (prayer bells, bloom garlands), capped at
   * PLAYER.maxLives. Returns the number of lives ACTUALLY added (0 if already at the cap),
   * so the scene can show the right feedback ("+1 life" vs "already full").
   */
  gainLife(amount = 1): number {
    if (this.lives >= PLAYER.maxLives) return 0;
    const before = this.lives;
    this.lives = Math.min(PLAYER.maxLives, this.lives + amount);
    return this.lives - before;
  }

  /** True when the player is at the life cap (so bonuses can convert to points instead). */
  isAtMaxLives(): boolean {
    return this.lives >= PLAYER.maxLives;
  }

  /** Send the Yatri back to its spawn/checkpoint and reset motion. */
  respawn(): void {
    this.setVelocity(0, 0);
    this.attackUntil = 0;
    this.attackCooldownUntil = 0;
    this.attackWasHeld = false;
    this.jumpBufferedAt = -1e9;
    this.jumpWasHeld = false;
    this.isJumpingUp = false;
    // Kill any in-flight damage-blink tween and clear its tint/alpha, otherwise a respawn
    // mid-blink leaves a faint red tint or partial transparency fighting the flash below.
    this.scene.tweens.killTweensOf(this);
    this.clearTint();
    this.setScale(1, 1);
    this.setPosition(this.spawnX, this.spawnY);
    (this.body as Phaser.Physics.Arcade.Body).reset(this.spawnX, this.spawnY);
    this.updateBlade();
    this.setAlpha(0.35);
    this.scene.tweens.add({ targets: this, alpha: 1, duration: PLAYER.respawnFlashMs });
    this.emit_('respawn');
  }

  // --- internal helpers ---

  private applyStateVisual(next: YatriState, deltaMs: number): void {
    if (next !== this.state_) {
      this.state_ = next;
      this.emit_('state_change', next);
    }

    // Face direction via flip (pivots around centre origin; does NOT move the body).
    this.setFlipX(this.facing === -1);

    // All animation is scale-only, pivoting around the centre origin — the body never
    // moves because of this, so collisions stay perfectly aligned.
    switch (next) {
      case 'walk': {
        this.walkTime += deltaMs / 1000;
        const phase = this.walkTime * PLAYER.walkBobHz * Math.PI;
        // Subtle vertical squash/stretch reads as a bouncy walk without moving the feet.
        const s = Math.abs(Math.sin(phase)) * 0.06;
        this.setScale(1 + s * 0.3, 1 - s);
        break;
      }
      case 'jump':
        this.setScale(0.92, 1.1); // stretch up
        break;
      case 'fall':
        this.setScale(1.08, 0.92); // squash for the fall
        break;
      case 'attack': {
        // A quick forward lean/lunge while the khukuri sweeps.
        const t = this.attackProgress();
        const lunge = Math.sin(t * Math.PI); // 0→1→0 over the swing
        this.setScale(1 + lunge * 0.08, 1 - lunge * 0.05);
        break;
      }
      default: {
        // Idle: gentle breathing.
        this.walkTime = 0;
        const breathe = Math.sin(this.scene.time.now / 500) * 0.02;
        this.setScale(1, 1 + breathe);
      }
    }
  }

  /** Begin a khukuri swing: arm the hitbox window + cooldown and spawn the blade visual. */
  private startSwing(now: number): void {
    this.attackUntil = now + PLAYER.attack.durationMs;
    this.attackCooldownUntil = now + PLAYER.attack.cooldownMs;
    if (!this.blade) {
      this.blade = this.scene.add.sprite(this.x, this.y, BLADE_KEY).setDepth(2);
    }
    this.blade.setVisible(true);
    this.emit_('attack');
  }

  /** 0..1 progress through the current swing (0 outside a swing). */
  private attackProgress(): number {
    const now = this.scene.time.now;
    if (now >= this.attackUntil) return 0;
    const start = this.attackUntil - PLAYER.attack.durationMs;
    return Phaser.Math.Clamp((now - start) / PLAYER.attack.durationMs, 0, 1);
  }

  /** Position the held khukuri; during an attack it sweeps forward, otherwise it stays
   * clearly beside the hand so players always understand the cutting tool is available. */
  private updateBlade(): void {
    const t = this.attackProgress();
    if (this.isAttacking()) {
      // Sweep the blade in a downward arc from raised (~-70°) to low (~+40°).
      const angle = Phaser.Math.Linear(-70, 40, t) * this.facing;
      const reach = PLAYER.width / 2 + PLAYER.attack.reach * 0.5;
      this.blade.setPosition(this.x + this.facing * reach, this.y - 6);
      this.blade.setAngle(angle);
    } else {
      // Resting grip: handle sits near the visible hand, blade points ahead and slightly up.
      const handReach = PLAYER.width / 2 + 15;
      this.blade.setPosition(this.x + this.facing * handReach, this.y - 2);
      this.blade.setAngle(this.facing === 1 ? 18 : -18);
    }
    this.blade.setFlipX(this.facing === -1);
    this.blade.setVisible(true);
  }

  private emit_(type: YatriEvent['type'], state?: YatriState): void {
    this.onEvent?.({ type, state, x: Math.round(this.x), y: Math.round(this.y) });
  }

  /**
   * Build the Yatrini texture once from an explicit PIXEL-ART grid so every cultural
   * detail reads clearly: hair gathered in a bun with a red tika, a crimson cholo blouse
   * with gold trim, a dhaka-weave shawl over one shoulder, a saffron gunyu wrap-skirt with
   * a green hem border, a red patuka sash — and a khukuri held at her side.
   *
   * The grid is 30 cols × 40 rows. Each glyph maps to a colour (see `KEY`). We paint each
   * cell as a PX×PX block. 100% original art (no external files).
   */
  private static ensureTexture(scene: Phaser.Scene, region: Region): void {
    const textureKey = `${TEXTURE_PREFIX}${region}`;
    if (scene.textures.exists(textureKey)) return;
    const c = PLAYER.colors;
    const dress = DRESS_BY_REGION[region];
    const PX = PLAYER.px;
    const COLS = PLAYER.gridCols;
    const ROWS = PLAYER.gridRows;

    // Colour key for the pixel map.
    const KEY: Record<string, number | null> = {
      '.': null, // transparent
      K: c.outline,
      S: c.skin,
      s: c.skinShade,
      H: c.hair,
      h: c.hairShade,
      i: c.tika, // red tika on the brow
      C: dress.cholo, // regional blouse body
      c: dress.choloShade, // regional blouse shadow
      T: dress.choloTrim, // gold trim
      G: dress.gunyu, // regional wrap-skirt
      g: dress.gunyuShade, // skirt pleat shadow
      E: dress.gunyuHem, // regional hem border
      P: dress.patuka, // waist sash
      p: dress.patukaShade,
      O: c.shoe,
      o: c.shoeShade,
      J: c.gold, // jewellery / earrings
      // region-specific dhaka/wool shawl colours
      w: dress.shawlBase,
      R: dress.shawlRed,
      B: dress.shawlBlue,
      N: dress.shawlGreen,
      // khukuri held at her side
      n: c.khukuriHandle,
      m: c.khukuriHandleShade,
      Z: c.khukuriBlade,
      z: c.khukuriEdge,
      Q: c.khukuriGuard,
      W: c.white,
    };

    // A Nepali woman traveler (Yatrini). Columns ~9..20 hold the figure; a khukuri is
    // held low at her right side (right = higher columns here since she faces right).
    //  - Hair bun on top, face with a red tika between the brows, gold earrings.
    //  - Crimson cholo with a gold neck/cuff trim; a dhaka shawl draped diagonally.
    //  - Red patuka sash; a full saffron gunyu skirt (widens toward the hem) with a
    //    green border; feet peeking beneath.
    const MAP = [
      '..............................',
      '.............KHHK.............',
      '............KHHHHK............',
      '............HHhhHH............',
      '.............KHHK.............',
      '..........KKKKKKKKKK.........',
      '.........KHHHHHHHHHHK.........',
      '.........KHSSSSSSSSHK.........',
      '.........KHSSiiSSSSHK.........',
      '........JKHSSSSSSSSHKJ........',
      '.........KHSsSSSSsSHK.........',
      '.........KHSSSSSSSSHK.........',
      '..........KSSSSSSSSK.........',
      '...........KKSSSSKK..........',
      '............KSSSSK...........',
      '..........KTTTTTTTTK.........',
      '.........KCCCCCCCCCCK........',
      '........KwCCCCCCCCCCCK.......',
      '.......KRwCCCCCCCCCCcK.......',
      '.......KBRwCCCCCCCCcCKn......',
      '.......KNBRwCCCCCCcCCKmn.....',
      '.......KcNBwCCCCCCCCcKQmn....',
      '........KTTTTTTTTTTTKZQm.....',
      '.........KPPPPPPPPPKZZQ......',
      '.........KpPPPPPPPpKZZz......',
      '.........KGGGGGGGGGKZzz......',
      '........KGGgGGGGgGGGKzz......',
      '........KGGGgGGGgGGGGKz......',
      '.......KGGGGgGGGgGGGGGK......',
      '.......KGgGGGGGGGGGgGGK......',
      '......KGGGGgGGGGGgGGGGGK.....',
      '......KGGGGGGGGGGGGGGGGK.....',
      '.....KGgGGGGGGGGGGGGgGGGK....',
      '.....KEEEEEEEEEEEEEEEEEEK....',
      '.....KEEEEEEEEEEEEEEEEEEK....',
      '......KGGGGGG..GGGGGGGK......',
      '.......KOOOOK..KOOOOK........',
      '.......KooooK..KooooK........',
      '........KKKK....KKKK.........',
      '..............................',
    ];

    const g = scene.add.graphics();
    for (let r = 0; r < MAP.length && r < ROWS; r++) {
      const row = MAP[r];
      for (let col = 0; col < row.length && col < COLS; col++) {
        const color = KEY[row[col]];
        if (color == null) continue;
        g.fillStyle(color, 1);
        g.fillRect(col * PX, r * PX, PX + 0.5, PX + 0.5);
      }
    }

    g.generateTexture(textureKey, COLS * PX, ROWS * PX);
    g.destroy();
  }

  /**
   * Build the transient KHUKURI blade texture used during a swing. The khukuri is the
   * iconic Nepali knife: a pale bone/horn handle, a brass guard, and a broad steel blade
   * that curves forward with a downward-angled belly. Drawn pointing to the RIGHT (the
   * sprite is flipped for a left-facing swing). 100% original art.
   */
  private static ensureBladeTexture(scene: Phaser.Scene): void {
    if (scene.textures.exists(BLADE_KEY)) return;
    const c = PLAYER.colors;
    const g = scene.add.graphics();
    const w = 46;
    const h = 22;
    const midY = h / 2;

    // Handle (left end).
    g.fillStyle(c.khukuriHandle, 1);
    g.fillRoundedRect(0, midY - 4, 12, 8, 3);
    g.fillStyle(c.khukuriHandleShade, 1);
    g.fillRect(2, midY + 1, 9, 2);
    // Brass guard between handle and blade.
    g.fillStyle(c.khukuriGuard, 1);
    g.fillRect(11, midY - 5, 3, 10);

    // Steel blade: a forward-curving belly. Built from a filled polygon (spine on top,
    // curved cutting edge below) so it reads as the classic inward-curved khukuri.
    g.fillStyle(c.khukuriBlade, 1);
    g.beginPath();
    g.moveTo(14, midY - 4); // spine start
    g.lineTo(30, midY - 5); // spine dips slightly
    g.lineTo(44, midY + 2); // tip
    g.lineTo(34, midY + 9); // belly (widest, downward)
    g.lineTo(20, midY + 6);
    g.lineTo(14, midY + 4);
    g.closePath();
    g.fillPath();
    // Bright edge highlight along the cutting belly.
    g.fillStyle(c.khukuriEdge, 1);
    g.beginPath();
    g.moveTo(20, midY + 6);
    g.lineTo(34, midY + 9);
    g.lineTo(44, midY + 2);
    g.lineTo(40, midY + 3);
    g.lineTo(32, midY + 7);
    g.lineTo(21, midY + 4);
    g.closePath();
    g.fillPath();
    // The characteristic notch (kaudi/cho) near the handle.
    g.fillStyle(c.khukuriGuard, 1);
    g.fillTriangle(16, midY + 4, 19, midY + 4, 17, midY + 6);

    g.generateTexture(BLADE_KEY, w, h);
    g.destroy();
  }
}
