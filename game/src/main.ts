/**
 * main.ts — the entry point. Creates the Phaser Game with a config that defines the
 * canvas size, arcade physics/gravity, the container div, and the scene order.
 */
import Phaser from 'phaser';
import { VIEW_WIDTH, VIEW_HEIGHT, GRAVITY_Y, PALETTE } from './config/constants';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { HimalRajyaScene } from './scenes/HimalRajyaScene';
import { LeaderboardScene } from './scenes/LeaderboardScene';
import { initFaro } from './telemetry/faro';

// Initialize Grafana Faro RUM as early as possible so it can catch startup errors.
// Inert (returns null) if no public VITE_FARO_URL is configured — see faro.ts.
initFaro();

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-root',
  width: VIEW_WIDTH,
  height: VIEW_HEIGHT,
  backgroundColor: PALETTE.skyLow,
  pixelArt: false,
  roundPixels: true, // draw sprites at integer positions → no sub-pixel shimmer
  render: {
    antialias: true,
    powerPreference: 'high-performance',
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: GRAVITY_Y },
      debug: false,
    },
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, MenuScene, HimalRajyaScene, LeaderboardScene],
};

const game = new Phaser.Game(config);

// Expose the game instance for debugging/diagnostics in the browser console
// (e.g. `window.__CY_GAME__.scene.getScene('HimalRajya')`). Harmless in production.
(window as unknown as { __CY_GAME__?: Phaser.Game }).__CY_GAME__ = game;
