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
  // ─── Responsive, consistent input on every browser (esp. Chrome) ───────────────────
  // IMPORTANT: we DO NOT average the frame delta ('smoothStep' is OFF). Delta-smoothing
  // blends each frame's delta with recent frames, which SMEARS the time applied to
  // movement for a frame or two after any jitter. On Chrome — whose rAF cadence is
  // noticeably jitterier than other browsers on a WebGL canvas doing lots of procedural
  // fills — that smearing read as laggy, "sticky" controls: you press → Yatri barely
  // moves for a beat → then catches up. Using the RAW per-frame delta makes a key press
  // translate to movement on the very next frame, which is what the other browsers were
  // already doing well.
  fps: {
    min: 20, // a lower clamp floor: only truly huge stalls (>50ms) are capped, so a normal
             // Chrome frame is NEVER shortened — the old 30 floor (33ms) clipped Chrome's
             // slightly-long frames and made Yatri move LESS than real time (the "hard to
             // move / so slow to go forward" feeling). 20 ≈ 50ms still blocks tunneling.
    target: 60, // the rate the game feel is tuned around
    smoothStep: false, // RAW delta → immediate, 1-frame-latency input response
  },
  render: {
    antialias: true,
    // 'default' (not 'high-performance') avoids forcing a discrete-GPU switch on some
    // laptops — notably under Edge — which can cause periodic frame stalls. Benign and
    // consistent across browsers; only affects which GPU the browser picks.
    powerPreference: 'default',
    // NOTE: `desynchronized` was intentionally REMOVED. It's a low-latency hint designed
    // for stylus/drawing apps that bypasses the normal compositor. On a WebGL canvas that
    // Phaser clears every frame it can cause flicker/tearing (per Chrome's own docs, it
    // needs preserveDrawingBuffer to avoid the display controller reading an empty buffer),
    // and its behavior differs by browser/GPU/compositor — which made the experience
    // inconsistent (smooth in Brave, worse in Edge/Firefox). Dropping it puts every browser
    // on the standard, well-tested compositing path for the most CONSISTENT feel everywhere.
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: GRAVITY_Y },
      debug: false,
      // VARIABLE timestep (fixedStep:false) is the key to smooth, consistent motion.
      //
      // Phaser's DEFAULT (fixedStep:true) advances physics in fixed 1/60s chunks and runs
      // as many as fit the elapsed time each frame — so depending on real frame timing it
      // runs 0 steps (Yatri briefly freezes → "slow"), 1 step (normal), or 2 steps (Yatri
      // lurches forward → "fast"). On any display that isn't a perfectly-even 60Hz (every
      // real browser, and all 120/144Hz screens) that quantization is the exact "sometimes
      // fast, sometimes slow, inconsistent" judder.
      //
      // With fixedStep:false, physics advances by the REAL elapsed delta exactly ONCE per
      // frame (position += velocity × realSeconds), so movement/jump/fall are perfectly
      // proportional to wall-clock time at ANY refresh rate — no lurches, no freezes, fully
      // consistent. Combined with RAW (un-smoothed) deltas and the low fps.min:20 clamp
      // above, a key press now moves Yatri the correct amount on the very next frame, which
      // is what fixed the Chrome "sluggish / hard to move" feel. The only risk (tunneling
      // through a thin platform on a giant delta) is bounded by the fps.min:20 clamp.
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

