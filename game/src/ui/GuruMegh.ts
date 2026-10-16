/**
 * GuruMegh.ts — the on-screen dialogue for Guru Megh, the cloud-sage NPC.
 *
 * A small cloud avatar + a speech panel that slides in with a short line (from Bedrock
 * via /oracle, or a local fallback) and auto-dismisses. Screen-fixed (scrollFactor 0),
 * non-intrusive, and never blocks input. Original art, drawn in code.
 */
import Phaser from 'phaser';
import type { OracleResponse } from '../telemetry/oracleClient';

export class GuruMegh {
  private container?: Phaser.GameObjects.Container;
  private hideEvent?: Phaser.Time.TimerEvent;
  private asyncGeneration = 0;

  constructor(private scene: Phaser.Scene) {}

  /** Show a line from Guru Megh. Replaces any current line. */
  say(text: string, holdMs = 5000): void {
    // Any new line supersedes an in-flight Bedrock response.
    this.asyncGeneration += 1;
    this.dismiss();

    const cam = this.scene.cameras.main;
    const W = Math.min(520, cam.width - 60);
    const x = cam.width / 2;
    // Up in the SKY (upper area) where Guru Megh belongs — but positioned JUST BELOW the
    // top HUD row (score/lives/time/combo/progress at y≈14-54) and the top-right
    // collectibles panel (y≈74-132), so the cloud-sage floats clearly in the sky without
    // covering any HUD element. Panel is 68px tall (±34), centred at y=168 → spans 134-202.
    const y = 168;

    const panel = this.scene.add.graphics();
    panel.fillStyle(0x10233b, 0.9);
    panel.fillRoundedRect(-W / 2, -34, W, 68, 12);
    panel.lineStyle(2, 0x8ecbff, 0.8);
    panel.strokeRoundedRect(-W / 2, -34, W, 68, 12);

    // Cloud-sage avatar (a soft cloud with a serene face) on the left.
    const avatar = this.scene.add.graphics();
    const ax = -W / 2 + 30;
    avatar.fillStyle(0xffffff, 0.95);
    avatar.fillCircle(ax, 0, 16);
    avatar.fillCircle(ax + 12, 6, 12);
    avatar.fillCircle(ax - 12, 6, 11);
    avatar.fillCircle(ax + 2, -10, 10);
    avatar.fillStyle(0x10233b, 1);
    avatar.fillCircle(ax - 4, 0, 1.6);
    avatar.fillCircle(ax + 4, 0, 1.6);
    avatar.lineStyle(1.5, 0x10233b, 1);
    avatar.beginPath();
    avatar.arc(ax, 3, 4, Phaser.Math.DegToRad(20), Phaser.Math.DegToRad(160));
    avatar.strokePath();

    const name = this.scene.add.text(-W / 2 + 56, -26, 'Guru Megh', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '13px',
      color: '#8ecbff',
      fontStyle: 'bold',
    });

    const body = this.scene.add.text(-W / 2 + 56, -8, text, {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '15px',
      color: '#eaf4ff',
      wordWrap: { width: W - 72 },
    });

    const container = this.scene.add.container(x, y, [panel, avatar, name, body]);
    container.setScrollFactor(0).setDepth(3000).setAlpha(0);
    this.container = container;

    // Slide down + fade in (descends gently from above, like a cloud settling in the sky).
    container.y = y - 20;
    this.scene.tweens.add({ targets: container, y, alpha: 1, duration: 260, ease: 'Quad.out' });

    this.hideEvent = this.scene.time.delayedCall(holdMs, () => this.dismiss());
  }

  /** Show a placeholder immediately, then replace it only if this scene/request is still current. */
  sayAsync(promise: Promise<OracleResponse>, holdMs = 5000): void {
    this.say('…', 1500);
    const requestGeneration = this.asyncGeneration;
    void promise
      .then((response) => {
        if (requestGeneration !== this.asyncGeneration) return;
        if (!this.scene.sys.isActive()) return;
        this.say(response.text, holdMs);
      })
      .catch(() => {
        // oracleClient already supplies a fallback; never create an unhandled UI rejection.
      });
  }

  dismiss(): void {
    this.hideEvent?.remove(false);
    this.hideEvent = undefined;
    if (!this.container) return;
    const c = this.container;
    this.container = undefined;
    this.scene.tweens.add({
      targets: c,
      alpha: 0,
      y: c.y - 16,
      duration: 220,
      onComplete: () => c.destroy(),
    });
  }
}
