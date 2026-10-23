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
  type: Phaser.AUTO, // WebGL when available, automatic Canvas fallback otherwise
  parent: 'game-root',
  width: VIEW_WIDTH,
  height: VIEW_HEIGHT,
  backgroundColor: PALETTE.skyLow,
  pixelArt: false,
  roundPixels: true, // draw sprites at integer positions → no sub-pixel shimmer
  render: {
    antialias: true,
    // Let the browser pick the GPU. 'high-performance' can force a discrete-GPU switch on
    // some laptops (notably under Edge), causing periodic stalls when the OS toggles GPUs.
    powerPreference: 'default',
    // A separate compositor path that avoids a frame of latency and reduces jank on
    // Chromium (Edge included). Safe for a game canvas that fully repaints each frame.
    desynchronized: true,
    // Do NOT refuse to start on machines where WebGL is only available via a slow software
    // path. Letting it run (or fall back to Canvas) is better than a black screen.
    failIfMajorPerformanceCaveat: false,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: GRAVITY_Y },
      debug: false,
      // Explicitly use a VARIABLE timestep. Phaser's arcade DEFAULT is fixedStep:true, so
      // we MUST set this to false — not just omit it — to turn fixed-step off.
      // WHY: every moving thing here is velocity-based (setVelocityX/Y in px/second), which
      // is inherently frame-rate-independent under a variable step — position integrates
      // velocity by the REAL elapsed delta, so run/jump speed is correct at any FPS. With
      // the default FIXED step, physics advances a fixed amount PER STEP but the number of
      // steps is driven by the render loop: a browser (e.g. Edge) running below 60fps can't
      // complete 60 steps/second, so velocity movement integrated over less wall-clock time
      // and everything moved in SLOW MOTION. A variable step always advances by true
      // wall-clock time and cannot slow-mo.
      fixedStep: false,
    },
  },
  scale: {
    // FIT keeps the 16:9 backing store fixed at VIEW_WIDTH×VIEW_HEIGHT and lets the browser
    // CSS-scale it to any screen. That means the GPU always shades the same, modest pixel
    // count regardless of a phone's device-pixel-ratio — cheap and consistent everywhere.
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    // Round the computed display size to whole pixels so FIT scaling can't land on a
    // fractional size that forces the browser into blurry, slower sub-pixel upscaling.
    autoRound: true,
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

// Pause the whole game loop while the "rotate your device" overlay is covering the screen
// on a portrait phone. Previously the overlay only hid the canvas with CSS, so Phaser kept
// rendering and stepping physics behind it — wasted battery/CPU and a running game the
// player can't see. We sleep the loop in portrait and wake it in landscape. The media
// query mirrors the CSS that shows #cy-rotate so the two never disagree.
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const portraitBlock = window.matchMedia(
    '(max-width: 900px) and (orientation: portrait), (pointer: coarse) and (orientation: portrait)',
  );
  const applyPortraitPause = (covered: boolean): void => {
    // `loop.sleep()` halts requestAnimationFrame (no render, no scene update); `wake()`
    // resumes it. Guard on readiness so we never poke the loop before it exists.
    if (!game.loop) return;
    if (covered) game.loop.sleep();
    else game.loop.wake();
  };
  applyPortraitPause(portraitBlock.matches);
  const onChange = (e: MediaQueryListEvent | MediaQueryList) => applyPortraitPause(e.matches);
  // addEventListener is the modern API; fall back to addListener for older WebKit.
  if (typeof portraitBlock.addEventListener === 'function') {
    portraitBlock.addEventListener('change', onChange as (e: MediaQueryListEvent) => void);
  } else if (typeof (portraitBlock as MediaQueryList).addListener === 'function') {
    (portraitBlock as MediaQueryList).addListener(onChange as (e: MediaQueryListEvent) => void);
  }
}

