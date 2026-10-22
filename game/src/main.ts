/**
 * main.ts — the entry point. Creates the Phaser Game with a config that defines the
 * canvas size, arcade physics/gravity, the container div, and the scene order.
 *
 * Public build-time config (VITE_API_BASE_URL, VITE_FARO_URL) is injected by Vite from
 * GitHub repository Variables at deploy time — see .github/workflows/deploy-cloudflare.yml.
 */
import Phaser from 'phaser';
import { VIEW_WIDTH, VIEW_HEIGHT, GRAVITY_Y, PALETTE } from './config/constants';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { HimalRajyaScene } from './scenes/HimalRajyaScene';
import { LeaderboardScene } from './scenes/LeaderboardScene';
import { initFaro } from './telemetry/faro';
import { initChaosPanel } from './telemetry/chaosPanel';

// Initialize Grafana Faro RUM as early as possible so it can catch startup errors.
// Inert (returns null) if no public VITE_FARO_URL is configured — see faro.ts.
initFaro();

// Admin-only Chaos Mode control (hidden; opens with Shift+C). Inert with no backend.
initChaosPanel();

// Respect the OS "reduce motion" setting (WCAG 2.3.3). Scenes read this from the registry
// to soften parallax/particles for players with vestibular sensitivity.
const prefersReducedMotion =
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false);

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
game.registry.set('reducedMotion', prefersReducedMotion);

// Remove the DOM loading placeholder and make the canvas keyboard-focusable so arrow/space
// go to the game (not the page) as soon as it is clicked/tapped.
game.events.once(Phaser.Core.Events.READY, () => {
  document.getElementById('cy-loading')?.remove();
  const canvas = game.canvas;
  if (canvas) {
    canvas.setAttribute('tabindex', '0');
    canvas.setAttribute('aria-label', 'Cloud Yatra game canvas');
    canvas.style.outline = 'none';
    canvas.addEventListener('pointerdown', () => canvas.focus());
    canvas.focus();
  }
});

