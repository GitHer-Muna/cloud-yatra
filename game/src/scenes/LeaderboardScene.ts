/**
 * LeaderboardScene — the public "Top Pilgrims" board for Himal Rajya.
 *
 * Screen-fixed UI (no camera scroll): a dark-navy panel with a gold title, the top 10
 * scores fetched from the backend, and prompts to play again (SPACE) or return to the
 * menu (L). If the player just finished a run, their final score is highlighted.
 *
 * All fetching goes through leaderboardClient (6s timeout, never throws). The scene
 * shows a friendly message for empty/error states so it always renders something sane.
 */
import Phaser from 'phaser';
import { VIEW_WIDTH, VIEW_HEIGHT } from '../config/constants';
import { fetchLeaderboardStatus, type LeaderboardEntry } from '../telemetry/leaderboardClient';

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

    // Clear actions: replay immediately, or return to the name/menu screen.
    const promptY = panelY + panelH - 48;
    const playButton = this.add
      .text(VIEW_WIDTH / 2 - 130, promptY, '▶  PLAY AGAIN', {
        fontFamily: FONT,
        fontSize: '17px',
        color: INK,
        fontStyle: 'bold',
        backgroundColor: 'rgba(46,204,113,0.28)',
        padding: { x: 12, y: 7 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    const menuButton = this.add
      .text(VIEW_WIDTH / 2 + 130, promptY, '☰  MENU', {
        fontFamily: FONT,
        fontSize: '17px',
        color: INK,
        fontStyle: 'bold',
        backgroundColor: 'rgba(142,203,255,0.2)',
        padding: { x: 12, y: 7 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    playButton.on('pointerdown', () => this.startNewJourney());
    menuButton.on('pointerdown', () => this.goToMenu());

    const prompt = this.add
      .text(VIEW_WIDTH / 2, promptY + 26, 'Enter / Space: play again   ·   L / Esc: menu', {
        fontFamily: FONT,
        fontSize: '13px',
        color: INK,
      })
      .setOrigin(0.5)
      .setAlpha(0.75);
    this.tweens.add({ targets: prompt, alpha: 0.35, duration: 900, yoyo: true, repeat: -1 });

    // Keyboard mirrors the visible actions.
    this.input.keyboard?.once('keydown-SPACE', () => this.startNewJourney());
    this.input.keyboard?.once('keydown-ENTER', () => this.startNewJourney());
    this.input.keyboard?.on('keydown-L', () => this.goToMenu());
    this.input.keyboard?.on('keydown-ESC', () => this.goToMenu());

    // Fetch after the screen is usable; loading never blocks the action buttons.
    void this.loadAndRender(listTop + 40, colRankX, colNameX, colScoreX, panelX, panelW);
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

  /** Fetch the board and render the top 10 (or a friendly empty/error message). */
  private async loadAndRender(
    top: number,
    colRankX: number,
    colNameX: number,
    colScoreX: number,
    panelX: number,
    panelW: number,
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

    // Scene may have been stopped/restarted before the fetch resolved.
    if (!this.scene.isActive() || !this.listContainer) return;
    this.listContainer.removeAll(true);

    if (!base || status === 'unavailable') {
      this.setMessage(top, 'Leaderboard unavailable right now. Your journey is still safe.');
      return;
    }
    if (status === 'empty' || entries.length === 0) {
      this.setMessage(top, 'No completed journeys yet — be the first to reach the summit!');
      return;
    }

    const rowH = 30;
    const highlightScore = this.justFinished ? this.score : null;
    let highlightedOnce = false;

    entries.slice(0, 10).forEach((entry, i) => {
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
