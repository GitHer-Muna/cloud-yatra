/**
 * Eagle.ts — a Himalayan eagle hazard that patrols the HIGH path in a swooping arc, so
 * the elevated platform route is risky rather than a safe shortcut. Predictable (no
 * chasing) — watch the arc and time your move. Touch = lose a life. Original art in code.
 */
import Phaser from 'phaser';

const TEXTURE_KEY = 'eagle';
// Logical (display) size of the eagle. The texture is rendered at SS× this resolution and
// then shown at the logical size, so the FIT camera upscale stays crisp instead of
// washed-out/blurry (which is what made the eagle look faint and faded before).
const EAGLE_W = 58;
const EAGLE_H = 34;
const SS = 3; // supersample factor

export class Eagle extends Phaser.Physics.Arcade.Sprite {
  private minX: number;
  private maxX: number;
  private baseY: number;
  private speed: number;
  private dead = false;

  constructor(scene: Phaser.Scene, x: number, y: number, range: number, speed: number) {
    Eagle.ensureTexture(scene);
    super(scene, x, y, TEXTURE_KEY);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    // The texture is SS× oversampled; display it at the logical size so it reads sharp
    // (crisp dark silhouette) under the camera's FIT upscale.
    this.setDisplaySize(EAGLE_W, EAGLE_H);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setImmovable(true);
    // Hit only the BODY, not the full wingspan — the spread wings are visual, so the
    // player isn't killed by a feather tip. (Logical size is 58×34; body is the central
    // mass.) setSize/offset are in TEXTURE (oversampled) pixels, so scale by SS.
    body.setSize(26 * SS, 16 * SS);
    body.setOffset(((EAGLE_W - 26) / 2) * SS, ((EAGLE_H - 16) / 2) * SS);
    this.setDepth(1);

    this.minX = x - range / 2;
    this.maxX = x + range / 2;
    this.baseY = y;
    this.speed = speed;
    this.setVelocityX(speed);
  }

  /** True once the eagle has been stomped (so the scene stops patrolling/hurting it). */
  isDead(): boolean {
    return this.dead;
  }

  /**
   * Stomped! The eagle is knocked out: it stops patrolling, spins, and tumbles away with
   * a puff of feathers, then is removed. Returns false if it was already dead.
   */
  kill(): boolean {
    if (this.dead) return false;
    this.dead = true;
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.enable = false;

    // A few feathers puff out.
    for (let i = 0; i < 5; i++) {
      const f = this.scene.add
        .rectangle(this.x, this.y, 3, 6, 0x7a6248)
        .setDepth(2)
        .setAngle(Phaser.Math.Between(0, 360));
      this.scene.tweens.add({
        targets: f,
        x: f.x + Phaser.Math.Between(-30, 30),
        y: f.y - Phaser.Math.Between(6, 24),
        alpha: 0,
        duration: Phaser.Math.Between(300, 520),
        onComplete: () => f.destroy(),
      });
    }
    // Tumble down and fade out.
    this.scene.tweens.add({
      targets: this,
      y: this.y + 160,
      angle: 220,
      alpha: 0,
      duration: 620,
      ease: 'Quad.in',
      onComplete: () => this.destroy(),
    });
    return true;
  }

  /** Swoop: patrol left↔right and bob in a smooth sine arc. Call each frame. */
  patrol(): void {
    if (this.dead) return;
    if (this.x <= this.minX) {
      this.setVelocityX(this.speed);
      this.setFlipX(false);
    } else if (this.x >= this.maxX) {
      this.setVelocityX(-this.speed);
      this.setFlipX(true);
    }
    // Vertical swoop arc based on horizontal progress — a single smooth rise-and-fall over
    // the patrol span. This is the ONLY motion: the eagle glides.
    //
    // NO per-frame rotation/tilt flap. Rotating this tiny 58×34 bitmap a few degrees back
    // and forth every frame (under antialias + roundPixels, then camera-upscaled) made its
    // edges shimmer — which read as the eagle "blinking" and looking washed-out/faded.
    // Gliding without the micro-rotation keeps the silhouette crisp and solid at all times.
    const t = (this.x - this.minX) / Math.max(1, this.maxX - this.minX);
    // Round the swoop height to a whole pixel. The eagle texture is tiny (58×34) and the
    // camera upscales it (FIT scale). A fractional Y under roundPixels snaps the sprite
    // between two pixel rows every frame → an edge shimmer that reads as "blinking". Keeping
    // Y on an integer row makes the silhouette rock-solid and stops the flicker entirely.
    this.y = Math.round(this.baseY + Math.sin(t * Math.PI) * 46);
    (this.body as Phaser.Physics.Arcade.Body).updateFromGameObject?.();
  }

  private static ensureTexture(scene: Phaser.Scene): void {
    if (scene.textures.exists(TEXTURE_KEY)) return;
    const g = scene.add.graphics();
    // Draw everything scaled up by SS so the generated texture has SS× the pixels. The
    // sprite is then shown at the logical EAGLE_W×EAGLE_H size (see constructor), keeping
    // the silhouette crisp and dark under the camera upscale (no faded/blurry edges).
    g.setScale(SS);
    const w = EAGLE_W;
    const h = EAGLE_H;
    const cx = w / 2;
    const cy = h / 2;
    const outline = 0x1a0e02; // near-black brown outline for a bold, solid silhouette
    const bodyC = 0x4a2a0b; // deep, dark chocolate-brown body (never washed-out)
    const wingC = 0x2e1a06; // very dark wings for strong contrast against the sky
    const wingTip = 0xb07f3c; // warm golden feather tips (kept, but a touch deeper)
    const headC = 0xa06f22; // golden-brown head (a Himalayan golden-eagle cue)
    const beakC = 0xe09413;

    // Outline pass: draw each shape slightly larger in the outline colour first.
    const drawBird = (fillBody: number, fillWing: number, grow: number): void => {
      // Wings (broad, spread).
      g.fillStyle(fillWing, 1);
      g.fillTriangle(cx - 3 - grow, cy - 3 - grow, cx - 28 - grow, cy - 13 - grow, cx - 7 - grow, cy + 3 + grow);
      g.fillTriangle(cx + 3 + grow, cy - 3 - grow, cx + 28 + grow, cy - 13 - grow, cx + 7 + grow, cy + 3 + grow);
      // Tail.
      g.fillStyle(fillWing, 1);
      g.fillTriangle(cx - 10 - grow, cy + grow, cx - 20 - grow, cy + 5 + grow, cx - 10 - grow, cy + 4 + grow);
      // Body.
      g.fillStyle(fillBody, 1);
      g.fillEllipse(cx, cy, 19 + grow * 2, 11 + grow * 2);
      // Head.
      g.fillStyle(fillBody, 1);
      g.fillCircle(cx + 10, cy - 2, 5.5 + grow);
    };
    drawBird(outline, outline, 1.6); // dark outline shell
    drawBird(bodyC, wingC, 0); // coloured bird on top

    // Golden-brown head (a Himalayan golden-eagle cue), drawn over the body.
    g.fillStyle(headC, 1);
    g.fillCircle(cx + 10, cy - 2, 5.5);

    // Lighter feather tips at the wing ends.
    g.fillStyle(wingTip, 1);
    g.fillTriangle(cx - 20, cy - 10, cx - 28, cy - 13, cx - 20, cy - 5);
    g.fillTriangle(cx + 20, cy - 10, cx + 28, cy - 13, cx + 20, cy - 5);

    // Hooked beak + a sharp eye so the raptor reads clearly.
    g.fillStyle(beakC, 1);
    g.fillTriangle(cx + 14, cy - 4, cx + 21, cy - 1, cx + 14, cy + 1);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(cx + 11, cy - 3, 1.7);
    g.fillStyle(outline, 1);
    g.fillCircle(cx + 11.5, cy - 3, 0.9);

    g.generateTexture(TEXTURE_KEY, w * SS, h * SS);
    g.destroy();
  }
}
