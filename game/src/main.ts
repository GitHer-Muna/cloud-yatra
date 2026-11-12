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
  // Responsive, consistent input
  // The frame delta is not averaged ('smoothStep' is off): delta-smoothing smears movement
  // for a frame or two after any jitter and reads as laggy controls. The raw per-frame
  // delta makes a key press move Yatri on the very next frame.
  fps: {
    min: 20, // clamp floor: only big stalls (>50ms) are capped, so normal frames keep
             // real-time movement while very long frames still can't tunnel through walls.
    target: 60, // the rate the game feel is tuned around
    smoothStep: false, // RAW delta → immediate, 1-frame-latency input response
  },
  render: {
    antialias: true,
    // 'default' (not 'high-performance') avoids forcing a discrete-GPU switch on some
    // laptops, which can cause periodic frame stalls.
    powerPreference: 'default',
    // `desynchronized` is deliberately not set: the low-latency hint bypasses the normal
    // compositor and can flicker or tear on a WebGL canvas that is cleared every frame,
    // with behaviour that varies by browser and GPU.
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: GRAVITY_Y },
      debug: false,
      // Variable timestep: physics advances by the real elapsed delta once per frame, so
      // movement is proportional to wall-clock time at any refresh rate. Phaser's fixed
      // 1/60s stepping would run 0, 1 or 2 steps per frame on displays that are not an even
      // 60Hz, which shows up as judder. Tunneling on large deltas is bounded by fps.min.
      fixedStep: false,
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

// Make the canvas keyboard-focusable and gate the game's key capture on focus, so the
// game and the embedding page can coexist on ONE scrollable page:
//   • The page scrolls normally with arrows / Space / PageUp-Down / touchpad UNTIL the
//     player clicks or taps the game (no auto-focus on load, so the page stays scrollable).
//   • Clicking/tapping the game focuses it; while focused, the scene captures the movement
//     keys (see HimalRajyaScene) so arrows/Space drive Yatri, not the page.
//   • Clicking/tapping anywhere outside the game (e.g. scrolling to the dashboard) blurs
//     the canvas, releasing capture so the keys scroll the page again.
game.events.once(Phaser.Core.Events.READY, () => {
  document.getElementById('cy-loading')?.remove();
  const canvas = game.canvas;
  if (!canvas) return;
  canvas.setAttribute('tabindex', '0');
  canvas.setAttribute('aria-label', 'Cloud Yatra game canvas');
  canvas.style.outline = 'none';
  // Focus the game on interaction only — never automatically on load.
  canvas.addEventListener('pointerdown', () => canvas.focus());
});

