/**
 * levels.ts — the three DISTINCT levels of Cloud Yatra, mapped to Nepal's three real
 * geographic regions (authentic + educational):
 *   Level 1 — TERAI: subtropical lowland jungle, tall grass, sal forest, warm greens.
 *   Level 2 — HILLS: terraced paddy, pagoda temples, stupa, rhododendron (the valley).
 *   Level 3 — HIMAL: the high Himalaya finale — snow, glaciers, thin air, great peaks.
 *
 * The scene is data-driven: it reads a LevelConfig and renders/plays accordingly, so the
 * three levels look and feel clearly different without duplicating scene code.
 */

export type Region = 'terai' | 'hills' | 'himal';

export interface LevelPalette {
  skyTop: number;
  skyUpper: number;
  skyMid: number;
  skyLow: number;
  skyGlow: number;
  ground: number;
  groundGrass: number;
  soil: number;
  platformTop: number;
  platformBody: number;
  accent: number; // collectible/foliage accent
}

export interface Hazard {
  x: number;
  y: number;
  range: number;
  speed: number;
  kind: 'mist' | 'eagle' | 'rockfall' | 'monkey';
}

/** A khukuri-cuttable obstacle placed on the ground at world-x `x`. */
export interface Cuttable {
  x: number;
  kind: 'thorn' | 'bamboo' | 'nettle' | 'khar' | 'lahara';
}

export interface LevelConfig {
  id: Region;
  index: 1 | 2 | 3;
  name: string;
  subtitle: string;
  worldWidth: number;
  palette: LevelPalette;
  platforms: Array<{ x: number; dy: number; w: number }>;
  // Blooms and bells are placed at world-x `x` ON the route surface (see surfaceTopAt in
  // the scene), so only `x` is needed here.
  blooms: Array<{ x: number }>;
  bells: Array<{ x: number }>;
  hazards: Hazard[];
  cuttables: Cuttable[];
  checkpoints: number[];
  parTimeMs: number;
}

// Shared scoring (level-independent).
export const SCORING = {
  scorePerBloom: 10,
  // Combo tuned to be ACTUALLY reachable in a clean run: a wider window to chain the
  // next bloom, and a bigger step so the x4 cap arrives in 5 blooms (not 7). This makes
  // the headline multiplier — and Guru Megh's "combo streak" cheer — visible in normal play.
  comboWindowMs: 3500,
  comboStep: 0.75,
  comboMax: 4,
  timeBonusMax: 500,
  // Lower than before so simply surviving no longer dwarfs actual collecting at the end
  // of a level (it used to be 100/life → up to 600, more than the whole bloom haul).
  livesBonus: 60,
  bellPoints: 50,
  levelClearBonus: 300, // awarded per level cleared
  cutPoints: 15, // awarded for clearing a khukuri-cuttable obstacle
  // Planting a pennant (checkpoint) is a signature beat — reward it so it feels earned,
  // not a silent save point.
  checkpointPoints: 40,

  // --- Reward economy: makes collecting MEANINGFUL (not just an abstract score) ---
  // Every GARLAND_SIZE blooms completes a "garland" (mala) that grants +1 life. This
  // gives a concrete survival reason to chase every bloom, not only points.
  garlandSize: 12,
  garlandBonusPoints: 150, // points awarded alongside the garland life
  garlandCapConvertPoints: 100, // extra points when a garland completes but lives are full
  // A prayer bell is a rare blessing: it grants +1 life immediately (big, felt reward)
  // on top of its points. At the life cap it converts to a large point bonus instead.
  bellLifeBonus: 1,
  bellCapConvertPoints: 150, // extra points when a bell is found but lives are full
} as const;

const GROUND = 60;

// ---------------- LEVEL 1 — TERAI (lowland jungle) ----------------
const TERAI: LevelConfig = {
  id: 'terai',
  index: 1,
  name: 'Terai Lowlands',
  subtitle: 'Through the sal forest & tall grass',
  worldWidth: 3400,
  parTimeMs: 82000, // Terai: the gentlest, most generous introduction
  palette: {
    skyTop: 0x4a90c2,
    skyUpper: 0x77b3d9,
    skyMid: 0xa9d6e8,
    skyLow: 0xe8f4dd,
    skyGlow: 0xf3f0c8,
    ground: 0x3e7a2e,
    groundGrass: 0x5aa838,
    soil: 0x6b4a2f,
    platformTop: 0x5aa838,
    platformBody: 0x5a3d24,
    accent: 0xffb020, // marigold
  },
  platforms: [
    { x: 460, dy: -80, w: 150 },
    { x: 760, dy: -130, w: 130 },
    { x: 1080, dy: -95, w: 150 },
    { x: 1420, dy: -150, w: 120 },
    { x: 1760, dy: -100, w: 150 },
    { x: 2120, dy: -140, w: 130 },
    { x: 2480, dy: -100, w: 150 },
    { x: 2840, dy: -150, w: 120 },
    { x: 3160, dy: -100, w: 150 },
  ],
  blooms: [
    { x: 340 }, { x: 620 }, { x: 900 }, { x: 1180 },
    { x: 1460 }, { x: 1740 }, { x: 2020 }, { x: 2300 },
    { x: 2560 }, { x: 2820 }, { x: 3000 }, { x: 3120 },
  ],
  bells: [
    { x: 1150 },  // spread across the journey, on the ground path (all before END)
    { x: 2250 },
    { x: 3080 },
  ],
  // Seven readable challenge moments: two upper-route eagles, one rockfall, and a
  // small number of predictable ground hazards. The lower trail remains viable.
  hazards: [
    { x: 620, y: 430, range: 110, speed: 65, kind: 'mist' },
    { x: 1080, y: 300, range: 210, speed: 110, kind: 'eagle' },
    { x: 1180, y: 430, range: 130, speed: 70, kind: 'monkey' },
    { x: 1540, y: 120, range: 0, speed: 190, kind: 'rockfall' },
    { x: 1900, y: 430, range: 130, speed: 75, kind: 'mist' },
    { x: 2480, y: 300, range: 220, speed: 115, kind: 'eagle' },
    { x: 3040, y: 430, range: 120, speed: 80, kind: 'mist' },
  ],
  // Ground obstacles the khukuri clears — Terai jungle: thorn thickets, bamboo, and the
  // golden thatch-grass (khar) of the lowlands.
  cuttables: [
    { x: 900, kind: 'thorn' },
    { x: 1300, kind: 'khar' },
    { x: 1600, kind: 'bamboo' },
    { x: 2300, kind: 'thorn' },
    { x: 2680, kind: 'khar' },
    { x: 2960, kind: 'bamboo' },
  ],
  checkpoints: [700, 1500, 2300, 3000],
};

// ---------------- LEVEL 2 — HILLS (terraced valley) ----------------
const HILLS: LevelConfig = {
  id: 'hills',
  index: 2,
  name: 'Middle Hills',
  subtitle: 'Terraced paddy, temples & prayer flags',
  worldWidth: 3600,
  parTimeMs: 72000, // Hills: a step up — longer world, tighter time
  palette: {
    skyTop: 0x2f5aa8,
    skyUpper: 0x5b8fd6,
    skyMid: 0x9fc4ee,
    skyLow: 0xfbe6c4,
    skyGlow: 0xffd98a,
    ground: 0x4a7a3f,
    groundGrass: 0x5a9048,
    soil: 0x6b4a2f,
    platformTop: 0x5a9048,
    platformBody: 0x6b4a2f,
    accent: 0xe0294a, // rhododendron
  },
  platforms: [
    { x: 430, dy: -80, w: 150 }, { x: 680, dy: -140, w: 120 }, { x: 940, dy: -200, w: 110 },
    { x: 1200, dy: -140, w: 150 }, { x: 1480, dy: -95, w: 140 }, { x: 1760, dy: -160, w: 120 },
    { x: 2040, dy: -220, w: 100 }, { x: 2320, dy: -150, w: 150 }, { x: 2600, dy: -100, w: 140 },
    { x: 2900, dy: -170, w: 120 }, { x: 3180, dy: -110, w: 160 },
  ],
  blooms: [
    { x: 320 }, { x: 600 }, { x: 880 }, { x: 1160 },
    { x: 1440 }, { x: 1720 }, { x: 2000 }, { x: 2280 },
    { x: 2560 }, { x: 2840 }, { x: 3120 }, { x: 3380 },
  ],
  bells: [
    { x: 1250 }, { x: 2350 }, { x: 3300 },
  ],
  // The same seven-moment rhythm as the other regions: fair, readable, and optional.
  hazards: [
    { x: 560, y: 430, range: 110, speed: 70, kind: 'mist' },
    { x: 940, y: 220, range: 230, speed: 110, kind: 'eagle' },
    { x: 1480, y: 430, range: 140, speed: 80, kind: 'mist' },
    { x: 1900, y: 120, range: 0, speed: 190, kind: 'rockfall' },
    { x: 2040, y: 230, range: 260, speed: 120, kind: 'eagle' },
    { x: 2600, y: 430, range: 150, speed: 85, kind: 'mist' },
    { x: 3000, y: 430, range: 130, speed: 90, kind: 'mist' },
  ],
  // Hill-trail bamboo, nettle (sisnu), and hanging creeper-vine curtains (lahara).
  cuttables: [
    { x: 780, kind: 'bamboo' },
    { x: 1150, kind: 'lahara' },
    { x: 1350, kind: 'nettle' },
    { x: 2200, kind: 'bamboo' },
    { x: 2500, kind: 'lahara' },
    { x: 2780, kind: 'nettle' },
  ],
  checkpoints: [700, 1600, 2600, 3200],
};

// ---------------- LEVEL 3 — HIMAL (high Himalaya finale) ----------------
const HIMAL: LevelConfig = {
  id: 'himal',
  index: 3,
  name: 'High Himalaya',
  subtitle: 'The final ascent to the summit',
  worldWidth: 3800,
  parTimeMs: 64000, // Himal: the tightest, most urgent final ascent
  palette: {
    skyTop: 0x14335f,
    skyUpper: 0x2f5aa8,
    skyMid: 0x7fb0e6,
    skyLow: 0xdcecfb,
    skyGlow: 0xf3f8ff,
    ground: 0xdfe9f5, // snow ground
    groundGrass: 0xf3f8ff,
    soil: 0xa9b6c8,
    platformTop: 0xf3f8ff, // snowy ledges
    platformBody: 0x8fa1b4,
    accent: 0x9fd8ff, // ice-blue
  },
  platforms: [
    { x: 420, dy: -70, w: 160 }, { x: 700, dy: -120, w: 135 }, { x: 980, dy: -175, w: 125 },
    { x: 1260, dy: -115, w: 145 }, { x: 1540, dy: -180, w: 120 }, { x: 1820, dy: -125, w: 140 },
    { x: 2120, dy: -190, w: 115 }, { x: 2420, dy: -135, w: 140 }, { x: 2720, dy: -200, w: 115 },
    { x: 3020, dy: -140, w: 140 }, { x: 3320, dy: -100, w: 170 },
  ],
  blooms: [
    { x: 320 }, { x: 620 }, { x: 920 }, { x: 1220 },
    { x: 1520 }, { x: 1820 }, { x: 2120 }, { x: 2420 },
    { x: 2720 }, { x: 3020 }, { x: 3320 }, { x: 3520 },
  ],
  bells: [
    { x: 1350 }, { x: 2420 }, { x: 3420 },
  ],
  // The summit keeps its snow/eagle identity but uses the same seven readable moments.
  hazards: [
    { x: 620, y: 430, range: 100, speed: 60, kind: 'mist' },
    { x: 980, y: 150, range: 220, speed: 105, kind: 'eagle' },
    { x: 1120, y: 120, range: 0, speed: 190, kind: 'rockfall' },
    { x: 1660, y: 430, range: 110, speed: 70, kind: 'mist' },
    { x: 2120, y: 155, range: 240, speed: 120, kind: 'eagle' },
    { x: 2520, y: 430, range: 120, speed: 80, kind: 'mist' },
    { x: 3160, y: 430, range: 110, speed: 85, kind: 'mist' },
  ],
  // High-pass nettle/vine tangles to cut through on the final ascent.
  cuttables: [
    { x: 820, kind: 'nettle' },
    { x: 1680, kind: 'nettle' },
    { x: 2340, kind: 'nettle' },
    { x: 2980, kind: 'nettle' },
  ],
  checkpoints: [700, 1500, 2400, 3200],
};

export const LEVELS: Record<Region, LevelConfig> = { terai: TERAI, hills: HILLS, himal: HIMAL };
export const LEVEL_ORDER: Region[] = ['terai', 'hills', 'himal'];
export const GROUND_HEIGHT = GROUND;

export function levelByIndex(index: number): LevelConfig {
  const id = LEVEL_ORDER[Math.max(0, Math.min(2, index - 1))];
  return LEVELS[id];
}
