/**
 * LeaderboardScene — the "Top Pilgrims" board for Himal Rajya.
 *
 * A dark-navy panel with a gold title, a ranked, scrollable list of scores, and prompts
 * to play again (Enter/Space) or return to the menu (L/Esc). If the player just finished
 * a run, their row is highlighted in gold.
 *
 * Data source: the shared backend leaderboard (Cloudflare Worker + D1) when configured,
 * MERGED with a zero-cost local (browser-stored) board so it always works offline and
 * never depends on a server being reachable.
 */
import Phaser from 'phaser';
import { VIEW_WIDTH, VIEW_HEIGHT } from '../config/constants';
import { getRankedBoard, findRank, type RankedEntry } from '../telemetry/localLeaderboard';
import { fetchLeaderboard } from '../telemetry/api';

const TOP_N = 10;

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
    void this.loadAndRender(listTop + 40, panelX, panelW, panelY, panelH);
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

  /** Fetch the board and render the Top-10 ranked list (+ the player's pinned rank). */
  private async loadAndRender(
    top: number,
    panelX: number,
    panelW: number,
    panelY: number,
    panelH: number,
  ): Promise<void> {
    // The board is the shared backend leaderboard when configured, merged with this
    // browser's local runs + legends. fetchLeaderboard() falls back to the local board on
    // any network failure, so this await never leaves the board broken.
    let entries: RankedEntry[] = await fetchLeaderboard(TOP_N + 10);
    if (entries.length === 0) entries = getRankedBoard();
    const status: 'ok' | 'empty' | 'unavailable' = entries.length > 0 ? 'ok' : 'empty';
    let myRank: number | null = null;
    let myTotal = 0;
    if (this.justFinished) {
      const r = findRank(this.score);
      myRank = r.rank;
      myTotal = r.total;
    }

    // Ensure we run AFTER create() has finished and the scene is RUNNING. On the
    // There is no network await, so without this yield the code below
    // would execute while the scene is still initializing — at which point
    // scene.isActive() is false and the old guard bailed out, leaving the board stuck on
    // "Summoning the pilgrims…". A single microtask hop guarantees the scene is live.
    await Promise.resolve();

    // Bail only if the scene was actually shut down/destroyed before we got here (e.g. the
    // player left during a scene transition). listContainer is destroyed on shutdown.
    if (!this.listContainer || !this.listContainer.active || !this.sys.isActive()) return;
    this.listContainer.removeAll(true);

    if (status === 'empty' || entries.length === 0) {
      this.setMessage(top, 'No completed journeys yet — be the first to reach the summit!');
      return;
    }

    // --- Vertical layout budget ------------------------------------------------------
    // Rows must fit between `top` and the action-button strip. When the player is outside
    // the Top 10 we anchor a pinned "your rank" row just above the buttons and give the
    // Top-10 list only the space above that, so nothing ever overlaps the buttons.
    const buttonBandTop = panelY + panelH - 48 - 24; // promptY - ~half button height
    const needPinnedRow = this.justFinished && myRank !== null && myRank > TOP_N;
    const pinnedReserve = needPinnedRow ? 38 : 0; // separator + pinned row height
    const visibleCount = Math.min(entries.length, TOP_N);
    const listBottom = buttonBandTop - pinnedReserve - 4;
    const available = listBottom - top;
    const rowH = Math.max(18, Math.min(30, visibleCount > 0 ? available / visibleCount : 30));
    const top10 = entries.slice(0, TOP_N);

    // The player's own row is the one at their computed rank. Highlighting by rank index
    // is precise even
    // when two runs share a score.
    const myIndex =
      myRank !== null ? myRank - 1 : this.justFinished ? entries.findIndex((e) => e.score === this.score) : -1;
    let highlightedOnce = false;

    top10.forEach((entry, i) => {
      const y = top + i * rowH;
      const isMine = this.justFinished && i === myIndex && !highlightedOnce;
      if (isMine) highlightedOnce = true;
      this.renderRow(entry, i + 1, y, rowH, isMine, panelX, panelW);
    });

    // If the player finished but their score didn't make the Top 10, pin a dedicated
    // "you are here" row just above the buttons — the standard arcade pattern that always
    // shows a player their position and the gap to climb, which drives "one more try".
    if (needPinnedRow && myRank !== null) {
      const pinnedY = buttonBandTop - 14;
      const sepY = pinnedY - 18;
      const sep = this.add.graphics();
      sep.lineStyle(1, 0xf3c623, 0.35);
      sep.beginPath();
      sep.moveTo(panelX + 28, sepY);
      sep.lineTo(panelX + panelW - 28, sepY);
      sep.strokePath();
      this.listContainer?.add(sep);

      const myRow: RankedEntry = {
        score: this.score,
        name: this.playerName ? `${this.playerName} (you)` : 'You',
      };
      this.renderRow(myRow, myRank, pinnedY, 24, true, panelX, panelW);
    }

    // Encouraging banner shown directly beneath the header (not at the panel bottom, which
    // belongs to the buttons). Celebrates a Top-10 placement or shows the climb ahead.
    if (this.justFinished && myRank !== null) {
      let msg: string;
      if (myRank === 1) msg = '👑 You top the board! Can anyone catch you?';
      else if (myRank <= TOP_N) msg = `🏔 Top ${TOP_N}! You are #${myRank} of ${myTotal}.`;
      else {
        const ahead = entries[Math.max(0, myRank - 2)];
        const gap = ahead ? ahead.score - this.score : 0;
        msg = `#${myRank} of ${myTotal} — ${gap > 0 ? `${gap} pts` : 'a push'} to climb higher!`;
      }
      const banner = this.add
        .text(VIEW_WIDTH / 2, top - 16, msg, {
          fontFamily: FONT,
          fontSize: '13px',
          color: GOLD,
          fontStyle: 'bold',
          align: 'center',
          wordWrap: { width: panelW - 80 },
        })
        .setOrigin(0.5)
        .setDepth(4000);
      this.tweens.add({ targets: banner, alpha: { from: 1, to: 0.55 }, duration: 1000, yoyo: true, repeat: -1 });
    }
  }

  /** Render a single leaderboard row (rank, name, score) into the list container. */
  private renderRow(
    entry: RankedEntry,
    rank: number,
    y: number,
    rowH: number,
    isMine: boolean,
    panelX: number,
    panelW: number,
  ): void {
    const colRankX = panelX + 40;
    const colNameX = panelX + 110;
    const colScoreX = panelX + panelW - 40;

    if (isMine) {
      const hl = this.add.graphics();
      hl.fillStyle(0xf3c623, 0.16);
      hl.fillRoundedRect(panelX + 24, y - rowH / 2 + 3, panelW - 48, rowH - 4, 6);
      this.listContainer?.add(hl);
    }

    // Legends (seeded aspirational scores) are dimmed slightly so real runs stand out.
    const rowColor = isMine ? GOLD : entry.legend ? '#c9d6e6' : INK;
    const name = entry.name && entry.name.trim() ? entry.name.trim() : 'Anonymous Yatri';

    const rankText = this.add
      .text(colRankX, y, String(rank), {
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
