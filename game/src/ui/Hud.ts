/**
 * Hud.ts — on-screen display (score, lives, combo, time) and the intro overlay.
 * UI uses scrollFactor 0 so it sticks to the screen and does not move with the camera.
 * All text uses the browser system font (no bundled fonts).
 */
import Phaser from 'phaser';

export class Hud {
  private scoreText: Phaser.GameObjects.Text;
  private livesText: Phaser.GameObjects.Text;
  private timeText: Phaser.GameObjects.Text;
  private comboText: Phaser.GameObjects.Text;
  private bloomText?: Phaser.GameObjects.Text;
  private bellText?: Phaser.GameObjects.Text;
  private progress?: Phaser.GameObjects.Graphics;
  private progressIcon?: Phaser.GameObjects.Text;
  private fpsText?: Phaser.GameObjects.Text;
  private muteText?: Phaser.GameObjects.Text;
  private banner?: Phaser.GameObjects.Container;

  constructor(
    private scene: Phaser.Scene,
    private bloomTextureKey = 'rhodo-bloom-rhododendron',
  ) {
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '20px',
      color: '#ffffff',
      fontStyle: 'bold',
      stroke: '#10233b',
      strokeThickness: 4,
    };
    this.scoreText = scene.add.text(16, 14, 'Score: 0', style).setScrollFactor(0).setDepth(1000);
    this.livesText = scene.add
      .text(16, 44, '❤ ❤ ❤', { ...style, fontSize: '18px', color: '#ff7a7a' })
      .setScrollFactor(0)
      .setDepth(1000);

    const w = scene.scale.width;
    this.timeText = scene.add
      .text(w - 16, 14, 'Time: 0.0s', style)
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(1000);
    this.comboText = scene.add
      .text(w - 16, 44, '', { ...style, color: '#f3c623' })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(1000);

    // Persistent guide: players should never have to remember how to move, attack, or win.
    scene.add
      .text(
        w / 2,
        scene.scale.height - 10,
        '← → / A D  RUN   •   ↑ / W / SPACE  JUMP   •   F / J  KHUKURI   •   REACH THE PENNANT TO WIN   •   R RESTART',
        {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '13px',
          color: '#ffffff',
          fontStyle: 'bold',
          backgroundColor: 'rgba(16,35,59,0.72)',
          padding: { x: 10, y: 5 },
        },
      )
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(1000);

    // Collectibles panel (top-right): shows LIVE counts and WHY they matter, so a
    // first-time player instantly understands the reward of collecting.
    this.buildCollectiblePanel(scene, w);
  }

  /**
   * A live "what you're collecting and why" panel:
   *   🌸 Blooms  N  (progress to the next +1 ❤ garland)
   *   🔔 Bells   M  (each = +1 ❤)
   */
  private buildCollectiblePanel(scene: Phaser.Scene, w: number): void {
    const panelW = 250;
    const panelH = 58;
    const x = w - panelW - 12;
    const y = 74;

    const bg = scene.add.graphics().setScrollFactor(0).setDepth(999);
    bg.fillStyle(0x10233b, 0.58);
    bg.fillRoundedRect(x, y, panelW, panelH, 8);
    bg.lineStyle(1, 0xf3c623, 0.35);
    bg.strokeRoundedRect(x, y, panelW, panelH, 8);

    const iconFor = (key: string, emoji: string, iy: number, scale: number): void => {
      if (scene.textures.exists(key)) {
        scene.add.image(x + 18, iy, key).setScrollFactor(0).setDepth(1000).setScale(scale);
      } else {
        scene.add
          .text(x + 18, iy, emoji, { fontSize: '15px' })
          .setOrigin(0.5)
          .setScrollFactor(0)
          .setDepth(1000);
      }
    };

    iconFor(this.bloomTextureKey, '🌸', y + 17, 0.26);
    iconFor('prayer-bell', '🔔', y + 41, 0.26);

    const textStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '12px',
      color: '#ffffff',
      fontStyle: 'bold',
    };
    this.bloomText = scene.add
      .text(x + 34, y + 17, 'Blooms 0  —  12 to +1 ❤', textStyle)
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(1000);
    this.bellText = scene.add
      .text(x + 34, y + 41, 'Bells 0  —  each = +1 ❤', textStyle)
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(1000);
  }

  /** Update the bloom counter + progress toward the next life-granting garland. */
  setBlooms(count: number, garlandSize: number): void {
    if (!this.bloomText) return;
    const into = count % garlandSize;
    const toGo = into === 0 && count > 0 ? 0 : garlandSize - into;
    const hint = toGo === 0 ? 'garland!' : `${toGo} to +1 ❤`;
    this.bloomText.setText(`Blooms ${count}  —  ${hint}`);
    this.bloomText.setScale(1.18);
    this.scene.tweens.add({ targets: this.bloomText, scale: 1, duration: 160 });
  }

  /** Update the bell counter. */
  setBells(count: number): void {
    if (!this.bellText) return;
    this.bellText.setText(`Bells ${count}  —  each = +1 ❤`);
    this.bellText.setScale(1.2);
    this.scene.tweens.add({ targets: this.bellText, scale: 1, duration: 160 });
  }

  setScore(score: number): void {
    this.scoreText.setText(`Score: ${score}`);
  }

  setLives(lives: number): void {
    this.livesText.setText(lives > 0 ? '❤ '.repeat(lives).trim() : '—');
  }

  setTime(ms: number): void {
    this.timeText.setText(`Time: ${(ms / 1000).toFixed(1)}s`);
  }

  /** Draw a journey progress bar (0..1) showing how far to the END pennant. */
  setProgress(frac: number): void {
    const f = Math.max(0, Math.min(1, frac));
    const w = 220;
    const x = this.scene.scale.width / 2 - w / 2;
    const y = 16;
    if (!this.progress) {
      this.progress = this.scene.add.graphics().setScrollFactor(0).setDepth(1000);
      this.progressIcon = this.scene.add
        .text(0, 0, '⛰', { fontSize: '16px' })
        .setScrollFactor(0)
        .setDepth(1001)
        .setOrigin(0.5);
    }
    const g = this.progress;
    g.clear();
    g.fillStyle(0x10233b, 0.55);
    g.fillRoundedRect(x, y, w, 10, 5);
    g.fillStyle(0x8ecbff, 1);
    g.fillRoundedRect(x, y, Math.max(6, w * f), 10, 5);
    g.fillStyle(0xf3c623, 1);
    g.fillCircle(x + w, y + 5, 5); // the END marker
    this.progressIcon?.setPosition(x + w * f, y + 5);
  }

  /** Show a combo multiplier (pass 0 to hide). */
  setCombo(multiplier: number): void {
    if (multiplier > 1) {
      this.comboText.setText(`Combo x${multiplier.toFixed(1)}`);
      // Small pop for feedback.
      this.comboText.setScale(1.25);
      this.scene.tweens.add({ targets: this.comboText, scale: 1, duration: 180 });
    } else {
      this.comboText.setText('');
    }
  }

  /** Show a small audio indicator (bottom-right): 🔊 or 🔇 with an (M) hint. */
  setMuted(muted: boolean): void {
    if (!this.muteText) {
      this.muteText = this.scene.add
        .text(this.scene.scale.width - 12, this.scene.scale.height - 22, '', {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '13px',
          color: '#bfe3ff',
        })
        .setOrigin(1, 0)
        .setScrollFactor(0)
        .setDepth(1000)
        .setAlpha(0.8);
    }
    this.muteText.setText(muted ? '🔇 (M)' : '🔊 (M)');
  }

  /** Small FPS readout (bottom-left) — helps diagnose real-browser frame rate. */
  setFps(fps: number): void {
    if (!this.fpsText) {
      this.fpsText = this.scene.add
        .text(12, this.scene.scale.height - 22, '', {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '12px',
          color: '#bfe3ff',
        })
        .setScrollFactor(0)
        .setDepth(1000)
        .setAlpha(0.7);
    }
    this.fpsText.setText(`${Math.round(fps)} fps`);
  }

  /**
   * A MINIMAL level intro: just the level name + a single short line, shown briefly and
   * fading on its own (or on the first move key). No text wall — the player should grasp
   * it in a glance, and the persistent bottom controls bar covers the details.
   */
  showIntro(autoHideMs = 2600, title = 'Himal Rajya', subtitle = 'The journey begins'): void {
    const cam = this.scene.cameras.main;
    const panelW = 420;
    const panelH = 92;
    const panel = this.scene.add.graphics();
    panel.fillStyle(0x10233b, 0.82);
    panel.fillRoundedRect(-panelW / 2, -panelH / 2, panelW, panelH, 14);
    panel.lineStyle(2, 0xf3c623, 0.7);
    panel.strokeRoundedRect(-panelW / 2, -panelH / 2, panelW, panelH, 14);

    const titleText = this.scene.add
      .text(0, -18, title, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '26px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    const subText = this.scene.add
      .text(0, 14, subtitle, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '14px',
        color: '#f3c623',
      })
      .setOrigin(0.5);

    const banner = this.scene.add.container(cam.width / 2, cam.height * 0.32, [
      panel,
      titleText,
      subText,
    ]);
    banner.setScrollFactor(0).setDepth(2000);
    this.banner = banner;
    this.scene.time.delayedCall(autoHideMs, () => this.hideIntro());
  }

  hideIntro(): void {
    if (!this.banner) return;
    const banner = this.banner;
    this.banner = undefined;
    this.scene.tweens.add({
      targets: banner,
      alpha: 0,
      duration: 300,
      onComplete: () => banner.destroy(),
    });
  }

  isIntroVisible(): boolean {
    return this.banner !== undefined;
  }
}
