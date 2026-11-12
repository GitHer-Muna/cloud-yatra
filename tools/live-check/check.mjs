/**
 * check.mjs — live console/network health check for the deployed Cloud Yatra page.
 *
 * WHY: the embedded Grafana public dashboard runs Grafana Cloud's own frontend, which Grafana
 * auto-updates. A Grafana release can start calling a new endpoint or re-enable a feature our
 * Worker proxy neutralises, and the first sign is new red noise in the browser console. This
 * script loads the real page in headless Chromium, plays the game for a while, and FAILS
 * (non-zero exit) on any console error, uncaught page error, or failed / 4xx / 5xx request —
 * minus a short, documented allowlist of known-harmless Grafana behaviour. A scheduled
 * GitHub Action runs it daily so a regression is caught (and emailed) within a day.
 *
 * Usage:  node check.mjs [url] [playSeconds]
 */
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'https://cloud-yatra.pages.dev/';
const playSeconds = Number(process.argv[3] ?? 40);

/**
 * Known-harmless noise we cannot remove from our origin. Keep this list SHORT and explain
 * every entry — anything not matched here is treated as a real regression.
 */
const ALLOWED = [
  // Grafana deliberately loads a fake image inside a sandboxed srcdoc iframe to detect
  // whether a Content Security Policy is active; the "violation" IS the probe. The code is
  // served from Grafana's CDN, not through our proxy.
  /grafana-csp-check\.invalid/,
  // Chaos Mode intentionally returns synthetic 503s on gameplay routes while a window is on.
  /\/(event|events|score) .*\b503\b|\b503\b .*\/(event|events|score)(\?|$)/,
];

const problems = [];
const isAllowed = (s) => ALLOWED.some((re) => re.test(s));
const note = (s) => {
  if (!isAllowed(s)) problems.push(s);
};

const browser = await chromium.launch(
  process.env.CHROME ? { executablePath: process.env.CHROME } : {},
);
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

page.on('console', (m) => {
  if (m.type() === 'error') note(`console.error: ${m.text().slice(0, 300)}`);
});
page.on('pageerror', (e) => note(`pageerror: ${String(e).slice(0, 300)}`));
page.on('requestfailed', (r) => note(`request failed: ${r.url().slice(0, 200)} (${r.failure()?.errorText})`));
page.on('response', (r) => {
  if (r.status() >= 400) note(`HTTP ${r.status()} ${r.request().method()} ${r.url().slice(0, 200)}`);
});

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForTimeout(5_000);
// Start a run and play: move right, jump, swing the khukuri.
await page.mouse.click(700, 300);
await page.keyboard.press('Enter');
for (let s = 0; s < playSeconds; s++) {
  await page.keyboard.down('ArrowRight');
  if (s % 2 === 0) await page.keyboard.press('Space');
  if (s % 5 === 0) await page.keyboard.press('f');
  await page.waitForTimeout(1_000);
}
await page.keyboard.up('ArrowRight');
// Give the embedded dashboard one refresh cycle to surface any late errors.
await page.waitForTimeout(10_000);
await browser.close();

const counts = new Map();
for (const p of problems) counts.set(p, (counts.get(p) ?? 0) + 1);
if (counts.size === 0) {
  console.log(`OK — no console errors or failed requests on ${url} (${playSeconds}s of play).`);
  process.exit(0);
}
console.error(`FOUND ${counts.size} distinct problem(s) on ${url}:`);
for (const [p, n] of counts) console.error(`  ${n}x ${p}`);
process.exit(1);
