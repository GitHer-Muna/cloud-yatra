/**
 * constants.ts — game-wide constants shared by scenes and entities.
 * Keeping these in one place avoids "magic numbers" and keeps future levels consistent.
 */

// Visible window (the canvas the player looks through).
export const VIEW_WIDTH = 960;
export const VIEW_HEIGHT = 540;

// The world is wider than the view so the camera scrolls across Himal Rajya.
export const WORLD_WIDTH = 3600;
export const WORLD_HEIGHT = 540;

// Gravity for arcade physics (pixels/s²).
export const GRAVITY_Y = 1000;

/**
 * Original, Nepal-evoking palette (hex values only — no copied assets).
 * A clear golden-dawn sky over the Himalaya, terraced paddy hills, rhododendron reds,
 * prayer-flag colours, and warm earthen ground.
 */
export const PALETTE = {
  // Sky: warm high-altitude dawn, top → horizon.
  skyTop: 0x2f5aa8,
  skyUpper: 0x5b8fd6,
  skyMid: 0x9fc4ee,
  skyLow: 0xfbe6c4,
  skyGlow: 0xffd98a,
  sun: 0xfff2c9,

  // Snow & rock for the layered Himalaya.
  snow: 0xf7fbff,
  snowShade: 0xdfe9f5,
  peakFar: 0xb9c6d8,
  peakMid: 0x93a6bd,
  peakRock: 0x74869d,
  peakShade: 0x5c6d84,

  // Terraced hills (far → near), greener as they approach.
  hillFar: 0x7fae74,
  hillMid: 0x5f9a55,
  hillNear: 0x477f3f,
  terraceLine: 0x2f5f34,
  terraceLip: 0xa9d18e,

  // Ground / soil.
  ground: 0x4a7a3f,
  groundGrass: 0x5a9048,
  groundDark: 0x37602f,
  soil: 0x6b4a2f,
  soilDark: 0x4f3620,
  stone: 0x8d8676,

  cloud: 0xffffff,
  mist: 0xdbe6f2,

  // Prayer-flag colours (traditional order): blue, white, red, green, yellow.
  prayerBlue: 0x2b6cff,
  prayerWhite: 0xffffff,
  prayerRed: 0xe23b3b,
  prayerGreen: 0x2fae5a,
  prayerYellow: 0xf3c623,
  prayerCord: 0x6b5a3f,

  // Rhododendron (lali gurans) — Nepal's national flower.
  rhodoRed: 0xe0294a,
  rhodoDark: 0xb01d38,
  rhodoLeaf: 0x2f7d4f,

  // Nepal flag pennant.
  flagCrimson: 0xdc143c,
  flagBlue: 0x003893,
  flagPole: 0x9a8f7a,

  // Pagoda-temple silhouette (abstract, non-photographic).
  pagodaRoof: 0x7a3b2e,
  pagodaBody: 0xb98a5a,
  pagodaShade: 0x8f6a45,

  // Markers / text.
  checkpointGlow: 0xf3c623,
  endMarker: 0x2ecc71,
  text: 0x10233b,
  textLight: 0xf4f9ff,
  panel: 0x10233b,
} as const;
