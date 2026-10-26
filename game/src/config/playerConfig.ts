/**
 * playerConfig.ts — tuning knobs for the Yatri character (a Nepali traveler in
 * gunyu-cholo dress, carrying a khukuri). Plain data, no Phaser import.
 * Adjust how the character FEELS here without touching game logic.
 */

export const PLAYER = {
  // Movement feel.
  moveSpeed: 230, // horizontal px/s top speed. Movement eases in/out via accel/decel below
  // (not instant), so it no longer feels twitchy even at this speed — and the widest
  // platform gap (225px) clears with real margin (flight ≈ 276px at JV=600).
  // How quickly Yatri ramps up to / slows down from top speed (px/s²). A short ramp removes
  // the "instant snap" that felt over-sensitive, while staying responsive.
  groundAccel: 2600,
  groundDecel: 3200, // stronger than accel so stopping feels crisp, not slidey
  airAccel: 1800, // a touch floatier in the air for controllable jump arcs
  // Jump impulse. Set to 600 so Yatri can CLIMB to the elevated platforms and collect the
  // blooms/bells sitting on them, rather than grabbing them from below. With GRAVITY_Y=1000:
  //   max height = 600²/(2·1000) = 180px  per first jump (clears a full platform layer)
  //   air-time   = 2·600/1000    = 1.2s
  //   h-flight   = 230·1.2       = 276px  (widest platform gap ≈225px → clears it, ~18px margin)
  // A single jump reaches the lower/mid ledges directly; the DOUBLE JUMP (below) stacks on
  // top so the HIGHEST layers (tallest platform ≈220px) are reachable with real margin —
  // the player actually jumps UP to the pickup. The levels.test.ts accessibility checks
  // derive their bounds from these values so no gap/rise exceeds what the jumps can clear.
  jumpVelocity: 600, // upward impulse for the first (ground) jump (bigger = higher)
  airControl: 0.9,

  // Double jump: Yatri can jump once more while airborne, so the higher platform layers (and
  // the collectibles on them) are reachable by climbing. maxJumps=2 means ground jump + one
  // mid-air jump. The mid-air jump is a touch softer so it still feels like a boost.
  //   second-jump height ≈ (600·0.92)²/(2·1000) ≈ 152px
  //   double-jump ceiling ≈ 180 + 152 = 332px  (well above the tallest 220px platform)
  maxJumps: 2,
  doubleJumpFactor: 0.92, // mid-air jump impulse = jumpVelocity × this

  // Forgiving-platformer feel.
  coyoteMs: 90,
  jumpBufferMs: 120,
  cutJumpFactor: 0.45,

  // Physics body size, kept smaller than the art so narrow ledges remain fair.
  width: 22,
  height: 36,

  // Compact pixel-art grid: 30 × 40 at 1.5px/cell gives a ~45 × 60px traveler.
  gridCols: 30,
  gridRows: 40,
  px: 1.5,

  // Respawn / falling.
  fallLimitPadding: 120,
  respawnFlashMs: 400,
  damageInvulnMs: 1500,
  startingLives: 4,
  maxLives: 6, // reward cap: blooms/bells can grant lives up to this ceiling

  // Procedural animation feel.
  walkBobHz: 9,
  walkBobPixels: 3,
  walkLeanDeg: 3,

  // Khukuri attack tuning.
  attack: {
    durationMs: 300, // how long a swing lasts (also the visual + hitbox window)
    cooldownMs: 380, // minimum time between swings
    reach: 40, // how far in front the blade hitbox extends (px)
    hitboxHeight: 40, // vertical size of the blade hitbox (px)
  },

  /**
   * Culturally-accurate palette for the YATRI — a Nepali traveler dressed in a
   * traditional GUNYU-CHOLO, carrying a KHUKURI.
   *  - cholo: a fitted blouse (deep Nepali red / crimson) with gold trim at the cuffs.
   *  - gunyu / patuki: a pleated wrap-skirt in warm saffron/orange with a green sari-style
   *    hem border (the classic red-green-gold Newari/hill palette).
   *  - patuka: a red cloth sash wound at the waist.
   *  - hair: dark, gathered in a low bun, with a bright red tika on the brow and small
   *    gold earrings (respectful, common festival/daily dress).
   *  - shawl: a folded dhaka-weave shawl draped over one shoulder (multi-colour geometry).
   *  - khukuri: the iconic inward-curved Nepali blade with a pale bone/horn handle.
   */
  colors: {
    // skin
    skin: 0xe6b184,
    skinShade: 0xc98f5f,
    // hair (dark, gathered) + the red tika dot
    hair: 0x241812,
    hairShade: 0x160d08,
    tika: 0xe11d2b,
    // cholo (blouse) — deep Nepali crimson with gold trim
    cholo: 0xb61f36, // blouse body
    choloShade: 0x8f142a, // blouse shadow fold
    choloTrim: 0xf3c11b, // gold cuff/neck trim
    // gunyu (wrap-skirt) — warm saffron with a green hem border
    gunyu: 0xef8a2b, // saffron body
    gunyuShade: 0xcf6f1c, // pleat shadow
    gunyuHem: 0x2f9e5a, // green sari-style hem border
    // patuka (waist sash) — strong Nepali red
    patuka: 0xd23b2e,
    patukaShade: 0xa82a20,
    // dhaka-weave shawl over the shoulder (bright geometric weave)
    shawlBase: 0xf4ede0,
    shawlRed: 0xd23b2e,
    shawlBlue: 0x1f5fbf,
    shawlGold: 0xf3c11b,
    shawlGreen: 0x2f9e5a,
    // gold jewellery (earrings / bangles)
    gold: 0xf3c11b,
    // shoes
    shoe: 0x4a3220,
    shoeShade: 0x33230f,
    // khukuri: pale bone/horn handle, steel blade with a lighter edge
    khukuriHandle: 0xe8dcc0,
    khukuriHandleShade: 0xbfae8c,
    khukuriBlade: 0xcdd6df,
    khukuriEdge: 0xf4f8fc,
    khukuriGuard: 0x8a6a3a,
    // outline (dark, for crisp silhouette)
    outline: 0x241a10,
    white: 0xffffff,
  },
} as const;

export type YatriState = 'idle' | 'walk' | 'jump' | 'fall' | 'attack';
