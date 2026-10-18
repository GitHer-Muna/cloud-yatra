/**
 * LeaderboardScene — the "Top Pilgrims" board for Himal Rajya.
 *
 * A dark-navy panel with a gold title, a ranked, scrollable list of scores, and prompts
 * to play again (Enter/Space) or return to the menu (L/Esc). If the player just finished
 * a run, their row is highlighted in gold.
 *
 * Data source: the backend leaderboard when a public API URL is configured; otherwise a
 * zero-cost local (browser-stored) leaderboard so the board always works offline. Both
 * fetches are resilient — the scene always renders a sensible state.
 */
import Phaser from 'phaser';
import { VIEW_WIDTH, VIEW_HEIGHT } from '../config/constants';
import { fetchLeaderboardStatus, type LeaderboardEntry } from '../telemetry/leaderboardClient';
import { getLocalLeaderboard } from '../telemetry/localLeaderboard';

interface LeaderboardInit {
  score?: number;
  playerName?: string;
  justFinished?: boolean;
}

const GOLD = '#f3c623';
const INK = '#f4f9ff';
const FONT = 'system-ui, sans-serif';

export class LeaderboardScene extends Phaser.Scene {
  private score = 0;
  private playerName = '';
  private justFinished = false;

  /** Holds dynamic rows/messages so we can clear + re-render after the fetch. */
  private listContainer?: Phaser.GameObjects.Container;
  /** Scrolling state for a long list. */
  private scrollY = 0;
  private scrollMin = 0; // most-negative offset (how far the list can move up)
  /** Top y of the action-button strip; drag-to-scroll must not start over the buttons. */
  private buttonBandTop = Number.POSITIVE_INFINITY;

  constructor() {
    super('Leaderboard');
  }

  init(data: LeaderboardInit): void {
    this.score = typeof data?.score === 'number' && Number.isFinite(data.score) ? data.score : 0;
    this.playerName = (data?.playerName ?? '').trim();
    this.justFinished = data?.justFinished === true;
  }

  create(): void {
    // Backdrop wash so the panel reads clearly regardless of what's behind.
    this.add.rectangle(0, 0, VIEW_WIDTH, VIEW_HEIGHT, 0x081426, 0.85).setOrigin(0, 0);

    // Panel geometry.
    const panelW = VIEW_WIDTH * 0.7;
    const panelH = VIEW_HEIGHT * 0.82;
    const panelX = (VIEW_WIDTH - panelW) / 2;
    const panelY = (VIEW_HEIGHT - panelH) / 2;

    // Dark-navy panel with a gold border.
    const panel = this.add.graphics();
    panel.fillStyle(0x10233b, 0.96);
    panel.fillRoundedRect(panelX, panelY, panelW, panelH, 16);
    panel.lineStyle(3, 0xf3c623, 0.9);
    panel.strokeRoundedRect(panelX, panelY, panelW, panelH, 16);

    // Title.
    this.add
      .text(VIEW_WIDTH / 2, panelY + 34, 'Himal Rajya — Top Pilgrims', {
        fontFamily: FONT,
        fontSize: '30px',
        color: GOLD,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    // Gold underline rule beneath the title.
    const rule = this.add.graphics();
    rule.lineStyle(2, 0xf3c623, 0.6);
    rule.beginPath();
    rule.moveTo(panelX + 40, panelY + 60);
    rule.lineTo(panelX + panelW - 40, panelY + 60);
    rule.strokePath();

    // If the player just finished, show their final score up top.
    let listTop = panelY + 84;
    if (this.justFinished) {
      const who = this.playerName ? ` (${this.playerName})` : '';
      this.add
        .text(VIEW_WIDTH / 2, panelY + 78, `Your final score: ${this.score}${who}`, {
          fontFamily: FONT,
          fontSize: '20px',
          color: INK,
          fontStyle: 'bold',
          backgroundColor: 'rgba(243,198,35,0.18)',
          padding: { x: 12, y: 6 },
        })
        .setOrigin(0.5);
      listTop = panelY + 112;
    }

    // Column headers.
    const colRankX = panelX + 40;
    const colNameX = panelX + 110;
    const colScoreX = panelX + panelW - 40;
    this.add
      .text(colRankX, listTop, '#', { fontFamily: FONT, fontSize: '15px', color: GOLD })
      .setOrigin(0, 0.5);
    this.add
      .text(colNameX, listTop, 'PILGRIM', { fontFamily: FONT, fontSize: '15px', color: GOLD })
      .setOrigin(0, 0.5);
    this.add
      .text(colScoreX, listTop, 'SCORE', { fontFamily: FONT, fontSize: '15px', color: GOLD })
      .setOrigin(1, 0.5);

    // Container for dynamic rows / status messages.
    this.listContainer = this.add.container(0, 0);

    // Loading placeholder while the fetch is in flight.
    this.setMessage(listTop + 40, 'Summoning the pilgrims…');

    // Clear actions: replay immediately, or return to the name/menu screen. Each button
    // is a label plus a dedicated transparent hit-rectangle at a high depth, so the click
    // target is generous and nothing (list rows, mask) can sit above and swallow the tap.
    const promptY = panelY + panelH - 48;
    const BTN_W = 170;
    const BTN_H = 40;

    // Record the action-button strip so the list's drag-to-scroll handler can never
    // start a drag (and thus swallow a tap) when the pointer is over a button.
    this.buttonBandTop = promptY - BTN_H / 2;

    const makeButton = (
      cx: number,
      label: string,
      fill: number,
      onClick: () => void,
    ): void => {
      // The hit-rectangle IS the button: it carries a visible fill, sits at the top
      // depth, and is the interactive target — so nothing can render above and steal the
      // tap, and the clickable area matches exactly what the player sees.
      const btn = this.add
        .rectangle(cx, promptY, BTN_W, BTN_H, fill, 0.9)
        .setStrokeStyle(1.5, 0xf3c623, 0.5)
        .setDepth(5000)
        .setInteractive({ useHandCursor: true });

      this.add
        .text(cx, promptY, label, {
          fontFamily: FONT,
          fontSize: '17px',
          color: INK,
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setDepth(5001); // label above the button fill, but it is NOT interactive

      // Fire once per tap, on pointerup, and guard against any double-trigger. A hover
      // tint gives clear affordance that the control is live.
      let fired = false;
      btn.on('pointerover', () => btn.setFillStyle(fill, 1));
      btn.on('pointerout', () => btn.setFillStyle(fill, 0.9));
      const activate = (p?: Phaser.Input.Pointer): void => {
        p?.event?.stopPropagation();
        if (fired) return;
        fired = true;
        onClick();
      };
      btn.on('pointerup', activate);
    };

    makeButton(VIEW_WIDTH / 2 - 110, '▶  PLAY AGAIN', 0x2e8b57, () => this.startNewJourney());
    makeButton(VIEW_WIDTH / 2 + 110, '☰  MENU', 0x2f5f8f, () => this.goToMenu());

    const prompt = this.add
      .text(VIEW_WIDTH / 2, promptY + 26, 'Enter / Space: play again   ·   L / Esc: menu', {
        fontFamily: FONT,
        fontSize: '13px',
        color: INK,
      })
      .setOrigin(0.5)
      .setDepth(5000)
      .setAlpha(0.75);
    this.tweens.add({ targets: prompt, alpha: 0.35, duration: 900, yoyo: true, repeat: -1 });

    // Keyboard mirrors the visible actions.
    this.input.keyboard?.once('keydown-SPACE', () => this.startNewJourney());
    this.input.keyboard?.once('keydown-ENTER', () => this.startNewJourney());
    this.input.keyboard?.on('keydown-L', () => this.goToMenu());
    this.input.keyboard?.on('keydown-ESC', () => this.goToMenu());

    // Fetch after the screen is usable; loading never blocks the action buttons.
    void this.loadAndRender(listTop + 40, colRankX, colNameX, colScoreX, panelX, panelW, panelY, panelH);
  }

  private startNewJourney(): void {
    this.scene.start('HimalRajya', {
      levelIndex: 1,
      cumulativeScore: 0,
      playerName: this.playerName,
    });
  }

  private goToMenu(): void {
    this.scene.start('Menu', { playerName: this.playerName });
  }

  /** Fetch the board and render the ranked list (scrollable if long). */
  private async loadAndRender(
    top: number,
    colRankX: number,
    colNameX: number,
    colScoreX: number,
    panelX: number,
    panelW: number,
    panelY: number,
    panelH: number,
  ): Promise<void> {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
    const base = env.VITE_API_BASE_URL ?? '';
    let entries: LeaderboardEntry[] = [];
    let status: 'ok' | 'empty' | 'unavailable' = 'unavailable';
    if (base) {
      const result = await fetchLeaderboardStatus(base, 'himal_rajya');
      entries = result.entries;
      status = result.status;
      // The final telemetry flush normally wins the race, but one short retry keeps a
      // newly completed pilgrim visible if DynamoDB/API propagation is slightly delayed.
      const hasOwnScore = entries.some((entry) => entry.score === this.score);
      if (this.justFinished && (status !== 'ok' || !hasOwnScore)) {
        await new Promise((resolve) => setTimeout(resolve, 350));
        const retry = await fetchLeaderboardStatus(base, 'himal_rajya');
        entries = retry.entries;
        status = retry.status;
      }
    }
    // No backend (or it was unavailable) → use the local, browser-stored leaderboard so
    // the board is always a real, working feature (your past runs persist and rank).
    if (!base || status === 'unavailable') {
      entries = getLocalLeaderboard();
      status = entries.length > 0 ? 'ok' : 'empty';
    }

    // Ensure we run AFTER create() has finished and the scene is RUNNING. On the
    // no-backend path there is no network await, so without this yield the code below
    // would execute while the scene is still initializing — at which point
    // scene.isActive() is false and the old guard bailed out, leaving the board stuck on
    // "Summoning the pilgrims…". A single microtask hop guarantees the scene is live.
    await Promise.resolve();

    // Bail only if the scene was actually shut down/destroyed before we got here (e.g. the
    // player left during a slow backend fetch). listContainer is destroyed on shutdown.
    if (!this.listContainer || !this.listContainer.active || !this.sys.isActive()) return;
    this.listContainer.removeAll(true);

    if (status === 'empty' || entries.length === 0) {
      this.setMessage(top, 'No completed journeys yet — be the first to reach the summit!');
      return;
    }

    const rowH = 30;
    const highlightScore = this.justFinished ? this.score : null;
    let highlightedOnce = false;

    // Render EVERY entry into the container; the viewport is masked and scrollable so a
    // long board doesn't overflow the panel.
    entries.forEach((entry, i) => {
      const y = top + i * rowH;
      const isMine = highlightScore !== null && !highlightedOnce && entry.score === highlightScore;
      if (isMine) highlightedOnce = true;

      if (isMine) {
        const hl = this.add.graphics();
        hl.fillStyle(0xf3c623, 0.16);
        hl.fillRoundedRect(panelX + 24, y - rowH / 2 + 3, panelW - 48, rowH - 4, 6);
        this.listContainer?.add(hl);
      }

      const rowColor = isMine ? GOLD : INK;
      const name = entry.name && entry.name.trim() ? entry.name.trim() : 'Anonymous Yatri';

      const rankText = this.add
        .text(colRankX, y, String(i + 1), {
          fontFamily: FONT,
          fontSize: '18px',
          color: rowColor,
          fontStyle: isMine ? 'bold' : 'normal',
        })
        .setOrigin(0, 0.5);
      const nameText = this.add
        .text(colNameX, y, name, {
          fontFamily: FONT,
          fontSize: '18px',
          color: rowColor,
          fontStyle: isMine ? 'bold' : 'normal',
        })
        .setOrigin(0, 0.5);
      const scoreText = this.add
        .text(colScoreX, y, String(entry.score), {
          fontFamily: FONT,
          fontSize: '18px',
          color: rowColor,
          fontStyle: 'bold',
        })
        .setOrigin(1, 0.5);

      this.listContainer?.add([rankText, nameText, scoreText]);
    });

    // --- Scrolling: mask the list to a viewport and allow wheel/drag when it overflows ---
    const viewportTop = top - rowH / 2;
    const viewportBottom = panelY + panelH - 70; // leave room for the action buttons
    const viewportH = viewportBottom - viewportTop;
    const contentH = entries.length * rowH;

    this.scrollY = 0;
    this.scrollMin = Math.min(0, viewportH - contentH); // negative when content is taller

    // Geometry mask so rows outside the viewport are clipped (don't cover the buttons).
    const maskG = this.make.graphics({ x: 0, y: 0 });
    maskG.fillStyle(0xffffff);
    maskG.fillRect(panelX + 16, viewportTop, panelW - 32, viewportH);
    const mask = maskG.createGeometryMask();
    this.listContainer.setMask(mask);

    if (this.scrollMin < 0) {
      // A subtle "scroll for more" hint + wheel/drag handlers.
      const hint = this.add
        .text(VIEW_WIDTH / 2, viewportBottom + 2, '▲ scroll / drag for more ▼', {
          fontFamily: FONT,
          fontSize: '12px',
          color: GOLD,
        })
        .setOrigin(0.5, 0)
        .setAlpha(0.7);
      this.tweens.add({ targets: hint, alpha: 0.3, duration: 900, yoyo: true, repeat: -1 });

      const applyScroll = (delta: number): void => {
        this.scrollY = Phaser.Math.Clamp(this.scrollY - delta, this.scrollMin, 0);
        this.listContainer?.setY(this.scrollY);
      };
      this.input.on(
        'wheel',
        (_p: unknown, _o: unknown, _dx: number, dy: number) => applyScroll(dy),
      );
      // Touch/pointer drag to scroll (phones + mouse).
      let dragging = false;
      let lastPointerY = 0;
      this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
        // Never begin a drag over the action buttons, or their taps get eaten.
        if (p.y >= this.buttonBandTop) return;
        if (p.y >= viewportTop && p.y <= viewportBottom) {
          dragging = true;
          lastPointerY = p.y;
        }
      });
      this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
        if (!dragging) return;
        applyScroll(lastPointerY - p.y);
        lastPointerY = p.y;
      });
      this.input.on('pointerup', () => {
        dragging = false;
      });
    }
  }

  /** Clear the list container and show a single centered status message. */
  private setMessage(y: number, msg: string): void {
    this.listContainer?.removeAll(true);
    const text = this.add
      .text(VIEW_WIDTH / 2, y + 24, msg, {
        fontFamily: FONT,
        fontSize: '18px',
        color: INK,
        align: 'center',
        wordWrap: { width: VIEW_WIDTH * 0.55 },
      })
      .setOrigin(0.5);
    this.listContainer?.add(text);
  }
}
