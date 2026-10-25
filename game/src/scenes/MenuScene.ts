/**
 * MenuScene — the title / start screen.
 *
 * Designed to be understood in ~2 seconds:
 *   • Big title, one-line what-it-is.
 *   • A name field that you must CLICK to focus before typing (click-to-type). When it is
 *     not focused, keystrokes are ignored — so the screen never feels like you're
 *     "already typing in a box". A clear focus ring + caret show when it's active.
 *   • One obvious ▶ START GAME button. You must click START (or press Enter) to play.
 *   • A tiny controls line. Nothing text-heavy.
 *
 * The name is REQUIRED: Start is disabled and the field nudges the player until a
 * non-empty name is entered (see startGame/hasValidName). This keeps the shared
 * leaderboard meaningful (no anonymous "Yatri" floods).
 */
import Phaser from 'phaser';
import { VIEW_WIDTH, VIEW_HEIGHT, PALETTE } from '../config/constants';
import { Yatri } from '../entities/Yatri';
import { isTouchDevice } from '../ui/TouchControls';

const NAME_KEY = 'cy_player_name';
const BEST_KEY = 'cy_best_score';
const NAME_MAX = 12;

const PANEL_W = 460;
const PANEL_X = VIEW_WIDTH / 2 - PANEL_W / 2;
const PANEL_TOP = 150;
const PANEL_BOTTOM = 470;

export class MenuScene extends Phaser.Scene {
  private playerName = '';
  private focused = false; // the name field is "active" (click-to-type) only when true
  private nameValueText?: Phaser.GameObjects.Text;
  private caret?: Phaser.GameObjects.Rectangle;
  private fieldBox?: Phaser.GameObjects.Graphics;
  private fieldHintText?: Phaser.GameObjects.Text;
  private nameFieldLeft = 0;
  private fieldRect = { x: 0, y: 0, w: 300, h: 44 };
  private startBg?: Phaser.GameObjects.Graphics;
  private startLabel?: Phaser.GameObjects.Text;
  private startHint?: Phaser.GameObjects.Text;
  private startRect = { cx: 0, y: 0, w: 250, h: 54 };
  private nameHit?: Phaser.GameObjects.Rectangle;
  /**
   * A real but visually hidden <input> overlaid on the Phaser-drawn name field, used on
   * EVERY device. It makes keyboard entry robust (keystrokes go to a real DOM input, not
   * dependent on the canvas holding focus) and accessible, and on touch it opens the OS
   * keyboard. Its value mirrors into `playerName`; it is removed on scene shutdown.
   */
  private hiddenInput?: HTMLInputElement;

  constructor() {
    super('Menu');
  }

  private loadName(): string {
    try {
      return (localStorage.getItem(NAME_KEY) ?? '').slice(0, NAME_MAX);
    } catch {
      return '';
    }
  }
  private saveName(name: string): void {
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      /* ignore */
    }
  }
  private loadBest(): number {
    try {
      return Number(localStorage.getItem(BEST_KEY) ?? '0') || 0;
    } catch {
      return 0;
    }
  }

  create(): void {
    this.playerName = this.loadName();
    this.focused = false;

    // Phaser reuses the SAME scene instance across restarts (Leaderboard → Menu → …), so
    // our GameObject fields still point at the PREVIOUS run's objects — which Phaser has
    // already destroyed. If we don't clear them, drawNameField()→redrawField()→
    // refreshStartButton() runs before drawStartButton() recreates the button and the
    // `if (!this.startBg) return` guards pass on STALE destroyed objects, so
    // `startLabel.setColor()` touches a null canvas → "drawImage of null" crash. Resetting
    // the references here makes the guards behave the same as on a fresh first load.
    this.nameValueText = undefined;
    this.caret = undefined;
    this.fieldBox = undefined;
    this.fieldHintText = undefined;
    this.nameHit = undefined;
    this.startBg = undefined;
    this.startLabel = undefined;
    this.startHint = undefined;
    this.hiddenInput = undefined;

    this.drawBackdrop();
    this.drawMascot();
    this.drawPanel();
    this.drawTitle();
    this.drawNameField();
    this.drawStartButton();
    this.drawControlsLine();
    this.drawCornerExtras();
    this.wireInput();

    // Auto-focus the name field on load so it's immediately obvious where to type. Also
    // create + focus the real hidden <input> on desktop so keystrokes land without needing
    // a click first. On touch we DON'T auto-focus the input (that would pop the keyboard
    // uninvited); the field's gold ring still shows and a tap opens the keyboard.
    this.setFocused(true);
    if (!isTouchDevice()) this.ensureHiddenInput().focus();
  }

  // ---------------------------------------------------------------- backdrop

  private drawBackdrop(): void {
    const g = this.add.graphics().setDepth(-10);
    const bands: Array<[number, number]> = [
      [PALETTE.skyTop, 0.0],
      [PALETTE.skyUpper, 0.3],
      [PALETTE.skyMid, 0.55],
      [PALETTE.skyLow, 0.8],
      [PALETTE.skyGlow, 0.92],
    ];
    for (let i = 0; i < bands.length; i++) {
      const [color, start] = bands[i];
      const end = i + 1 < bands.length ? bands[i + 1][1] : 1;
      g.fillStyle(color, 1);
      g.fillRect(0, VIEW_HEIGHT * start, VIEW_WIDTH, VIEW_HEIGHT * (end - start) + 1);
    }
    g.fillStyle(PALETTE.sun, 0.35);
    g.fillCircle(VIEW_WIDTH * 0.88, VIEW_HEIGHT * 0.2, 58);
    g.fillStyle(0xfff8e6, 1);
    g.fillCircle(VIEW_WIDTH * 0.88, VIEW_HEIGHT * 0.2, 32);

    const baseY = VIEW_HEIGHT;
    const peaks = [
      { x: 90, w: 320, h: 250, c: PALETTE.peakFar },
      { x: 430, w: 380, h: 320, c: PALETTE.peakRock },
      { x: 800, w: 340, h: 270, c: PALETTE.peakMid },
      { x: 1040, w: 300, h: 220, c: PALETTE.peakFar },
    ];
    for (const p of peaks) {
      g.fillStyle(p.c, 1);
      g.fillTriangle(p.x, baseY - p.h, p.x + p.w / 2, baseY, p.x - p.w / 2, baseY);
      g.fillStyle(PALETTE.snow, 1);
      g.fillTriangle(p.x, baseY - p.h, p.x + p.w * 0.2, baseY - p.h * 0.6, p.x - p.w * 0.2, baseY - p.h * 0.6);
    }

    const flagColors = [PALETTE.prayerBlue, PALETTE.prayerWhite, PALETTE.prayerRed, PALETTE.prayerGreen, PALETTE.prayerYellow];
    const fy = 26;
    g.lineStyle(2, PALETTE.prayerCord, 0.9);
    g.beginPath();
    g.moveTo(VIEW_WIDTH * 0.08, fy);
    g.lineTo(VIEW_WIDTH * 0.92, fy + 22);
    g.strokePath();
    for (let i = 0; i < 20; i++) {
      const t = i / 20;
      g.fillStyle(flagColors[i % flagColors.length], 0.95);
      g.fillRect(VIEW_WIDTH * 0.08 + t * VIEW_WIDTH * 0.84, fy + t * 22, 13, 17);
    }
  }

  private drawMascot(): void {
    const yatri = new Yatri(this, 110, VIEW_HEIGHT - 120, 3, 'hills');
    (yatri.body as Phaser.Physics.Arcade.Body).setAllowGravity(false);
    yatri.setScale(1.5).setDepth(-2);
    this.add
      .text(110, VIEW_HEIGHT - 72, 'Yatri', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '14px',
        color: '#ffffff',
        fontStyle: 'bold',
        stroke: '#10233b',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(-2);
  }

  private drawPanel(): void {
    const panel = this.add.graphics().setDepth(5);
    panel.fillStyle(0x0b1a30, 0.82);
    panel.fillRoundedRect(PANEL_X, PANEL_TOP, PANEL_W, PANEL_BOTTOM - PANEL_TOP, 18);
    panel.lineStyle(2, 0xf3c623, 0.5);
    panel.strokeRoundedRect(PANEL_X, PANEL_TOP, PANEL_W, PANEL_BOTTOM - PANEL_TOP, 18);
  }

  private drawTitle(): void {
    this.add
      .text(VIEW_WIDTH / 2, 66, 'Cloud Yatra', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '54px',
        color: '#ffffff',
        fontStyle: 'bold',
        stroke: '#10233b',
        strokeThickness: 8,
      })
      .setOrigin(0.5)
      .setDepth(10);
    this.add
      .text(VIEW_WIDTH / 2, 106, 'Climb from the Terai jungle to the Himalayan summit — guided by Guru Megh', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '15px',
        color: '#ffffff',
        fontStyle: 'bold',
        stroke: '#10233b',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(10);
  }

  // ---------------------------------------------------------------- name field

  private drawNameField(): void {
    const cx = VIEW_WIDTH / 2;
    const labelY = PANEL_TOP + 30;
    const fieldY = PANEL_TOP + 68;
    const boxW = 300;
    const boxH = 44;
    this.fieldRect = { x: cx - boxW / 2, y: fieldY - boxH / 2, w: boxW, h: boxH };

    this.add
      .text(cx, labelY, 'YOUR NAME', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '14px',
        color: '#ffe8b0',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(11);

    this.fieldBox = this.add.graphics().setDepth(9);
    this.nameFieldLeft = cx - boxW / 2 + 16;

    this.nameValueText = this.add
      .text(this.nameFieldLeft, fieldY, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '22px',
        color: '#10233b',
        fontStyle: 'bold',
      })
      .setOrigin(0, 0.5)
      .setDepth(12);

    this.caret = this.add
      .rectangle(this.nameFieldLeft, fieldY, 2, 24, 0x10233b)
      .setOrigin(0, 0.5)
      .setDepth(12)
      .setVisible(false);
    this.tweens.add({ targets: this.caret, alpha: { from: 1, to: 0 }, duration: 500, yoyo: true, repeat: -1 });

    // A tiny hint under the field that changes with focus state.
    this.fieldHintText = this.add
      .text(cx, fieldY + 34, 'Click here to type your name', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '12px',
        color: '#bfe3ff',
      })
      .setOrigin(0.5)
      .setDepth(11);

    // Clicking the field focuses it (click-to-type). Clicking elsewhere blurs it.
    const hit = this.add
      .rectangle(cx, fieldY, boxW, boxH, 0xffffff, 0.001)
      .setDepth(13)
      .setInteractive({ useHandCursor: true });
    this.nameHit = hit;
    hit.on('pointerdown', (p: Phaser.Input.Pointer) => {
      p.event.stopPropagation();
      this.setFocused(true);
      // Focus the real hidden <input> on EVERY device. This makes keyboard entry robust:
      // it no longer depends on the Phaser canvas holding keyboard focus (a real DOM input
      // reliably receives keystrokes), and on touch devices the OS keyboard opens too.
      this.ensureHiddenInput().focus();
    });

    this.redrawField();
  }

  /** Focus/blur the name field; redraws the ring, caret and hint accordingly. */
  private setFocused(on: boolean): void {
    this.focused = on;
    this.redrawField();
  }

  /**
   * Lazily create (once) the hidden real <input> used on touch devices. It is positioned
   * over the Phaser name field and kept visually invisible, but remains a focusable form
   * control so keystrokes land reliably (and the mobile OS keyboard opens). Its value is
   * the single source of truth while present; we mirror it into `playerName`.
   */
  private ensureHiddenInput(): HTMLInputElement {
    if (this.hiddenInput) return this.hiddenInput;
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'text';
    input.autocapitalize = 'words';
    input.autocomplete = 'off';
    input.maxLength = NAME_MAX;
    input.value = this.playerName;
    input.setAttribute('aria-label', 'Your name');
    // Visually hidden but still focusable and able to summon the keyboard. We avoid
    // display:none / visibility:hidden because those block focus on some browsers.
    Object.assign(input.style, {
      position: 'fixed',
      left: '50%',
      bottom: '0',
      transform: 'translateX(-50%)',
      width: '280px',
      height: '1px',
      opacity: '0',
      border: '0',
      padding: '0',
      margin: '0',
      zIndex: '-1',
      background: 'transparent',
      color: 'transparent',
    } as Partial<CSSStyleDeclaration>);

    input.addEventListener('input', () => {
      // Keep only the characters the game allows, then mirror into the Phaser field.
      const cleaned = input.value.replace(/[^A-Za-z0-9 ]/g, '').replace(/^ +/, '').slice(0, NAME_MAX);
      if (cleaned !== input.value) input.value = cleaned;
      this.playerName = cleaned;
      this.saveName(this.playerName);
      this.redrawField();
    });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        input.blur();
        this.startGame();
      }
    });
    input.addEventListener('blur', () => this.setFocused(false));

    document.body.appendChild(input);
    this.hiddenInput = input;

    // Remove the DOM element when the scene shuts down to avoid leaks across restarts.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroyHiddenInput());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.destroyHiddenInput());
    return input;
  }

  private destroyHiddenInput(): void {
    this.hiddenInput?.remove();
    this.hiddenInput = undefined;
  }

  private redrawField(): void {
    if (!this.fieldBox || !this.nameValueText || !this.caret || !this.fieldHintText) return;
    const { x, y, w, h } = this.fieldRect;
    const g = this.fieldBox;
    g.clear();
    g.fillStyle(0xffffff, 0.97);
    g.fillRoundedRect(x, y, w, h, 10);
    // Focus ring: bright gold + glow when focused, thin grey when not.
    if (this.focused) {
      g.lineStyle(3, 0xf3c623, 1);
      g.strokeRoundedRect(x, y, w, h, 10);
      g.lineStyle(6, 0xf3c623, 0.25);
      g.strokeRoundedRect(x - 2, y - 2, w + 4, h + 4, 12);
    } else {
      g.lineStyle(2, 0x9aa6b4, 0.9);
      g.strokeRoundedRect(x, y, w, h, 10);
    }

    const hasName = this.playerName.length > 0;
    // Placeholder only when empty AND not focused; once focused it's a real empty field.
    const showPlaceholder = !hasName && !this.focused;
    this.nameValueText.setText(hasName ? this.playerName : showPlaceholder ? 'Yatri' : '');
    this.nameValueText.setColor(hasName ? '#10233b' : '#9aa6b4');

    const endX = this.nameFieldLeft + (hasName ? this.nameValueText.width + 3 : 0);
    this.caret.setX(endX).setVisible(this.focused);

    this.fieldHintText.setText(
      this.focused
        ? 'Type your name • Enter to start'
        : isTouchDevice()
          ? 'Tap here to type your name'
          : 'Click here to type your name',
    );

    // A name change flips the START button between enabled/disabled.
    this.refreshStartButton();
  }

  // ---------------------------------------------------------------- start button

  private drawStartButton(): void {
    const cx = VIEW_WIDTH / 2;
    const y = PANEL_TOP + 150;
    const w = 250;
    const h = 54;
    this.startRect = { cx, y, w, h };

    this.startBg = this.add.graphics().setDepth(9);
    this.startLabel = this.add
      .text(cx, y, '▶  START GAME', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '24px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(11);

    const hit = this.add
      .rectangle(cx, y, w, h, 0xffffff, 0.001)
      .setDepth(13)
      .setInteractive({ useHandCursor: true });
    hit.on('pointerover', () => {
      if (this.hasValidName()) this.paintStart(0x37b56a, 1.04);
    });
    hit.on('pointerout', () => {
      if (this.hasValidName()) this.paintStart(0x2f9e5a, 1);
    });
    hit.on('pointerdown', (p: Phaser.Input.Pointer) => {
      p.event.stopPropagation();
      this.startGame();
    });

    this.startHint = this.add
      .text(cx, y + 36, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '12px',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setDepth(11)
      .setAlpha(0.9);

    this.refreshStartButton();
  }

  /** True once the player has typed a non-empty name (name is REQUIRED to start). */
  private hasValidName(): boolean {
    return this.playerName.trim().length > 0;
  }

  private paintStart(fill: number, labelScale: number): void {
    if (!this.startBg || !this.startLabel) return;
    const { cx, y, w, h } = this.startRect;
    const g = this.startBg;
    g.clear();
    g.fillStyle(fill, 1);
    g.fillRoundedRect(cx - w / 2, y - h / 2, w, h, 14);
    g.lineStyle(3, 0xffffff, 0.9);
    g.strokeRoundedRect(cx - w / 2, y - h / 2, w, h, 14);
    this.startLabel.setScale(labelScale);
  }

  /** Enable (green, pulsing) when a name exists; disable (grey, dim) when it's empty. */
  private refreshStartButton(): void {
    if (!this.startBg || !this.startLabel || !this.startHint) return;
    const enabled = this.hasValidName();
    this.tweens.killTweensOf(this.startBg);
    if (enabled) {
      this.paintStart(0x2f9e5a, 1);
      this.startBg.setAlpha(1);
      this.startLabel.setColor('#ffffff');
      this.startHint.setText('Click START (or press Enter) to play');
      this.tweens.add({ targets: this.startBg, alpha: { from: 1, to: 0.85 }, duration: 900, yoyo: true, repeat: -1 });
    } else {
      this.paintStart(0x45515f, 1); // greyed-out
      // Keep the disabled label legible: a near-white label on the grey fill clears WCAG AA
      // (~4.5:1), where the previous #c3ccd6 sat around 2.8:1. Don't drop the fill to 0.7
      // alpha either (that further reduced contrast against the panel behind it).
      this.startBg.setAlpha(0.9);
      this.startLabel.setColor('#eef2f6');
      this.startHint.setText('Enter your name first ↑');
    }
  }

  // ---------------------------------------------------------------- controls line

  private drawControlsLine(): void {
    const cx = VIEW_WIDTH / 2;
    const y = PANEL_BOTTOM - 34;
    const controls = isTouchDevice()
      ? 'Move  ◀ ▶   ·   Jump  ⤒  (tap again in the air to double-jump)   ·   Khukuri  🗡'
      : 'Move  ← →   ·   Jump  ↑  (press again in the air to double-jump)   ·   Khukuri  F';
    this.add
      .text(cx, y, controls, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '14px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(11);
    this.add
      .text(cx, y + 20, '🌸 collect flowers & 🔔 bells for extra lives', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '12px',
        color: '#bfe3ff',
      })
      .setOrigin(0.5)
      .setDepth(11);
  }

  // ---------------------------------------------------------------- corner extras

  private drawCornerExtras(): void {
    const best = this.loadBest();
    if (best > 0) {
      this.add
        .text(14, 12, `Best: ${best}`, {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '15px',
          color: '#ffffff',
          fontStyle: 'bold',
          backgroundColor: 'rgba(16,35,59,0.5)',
          padding: { x: 8, y: 4 },
        })
        .setOrigin(0, 0)
        .setDepth(12);
    }

    const lbBtn = this.add
      .text(VIEW_WIDTH - 14, 12, '🏆 Leaderboard', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '15px',
        color: '#ffffff',
        fontStyle: 'bold',
        backgroundColor: 'rgba(16,35,59,0.5)',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(1, 0)
      .setDepth(13)
      .setInteractive({ useHandCursor: true });
    lbBtn.on('pointerdown', (p: Phaser.Input.Pointer) => {
      p.event.stopPropagation();
      this.scene.start('Leaderboard', { playerName: this.playerName.trim() });
    });
  }

  // ---------------------------------------------------------------- input + flow

  private wireInput(): void {
    // Keystrokes only edit the name WHILE the field is focused (click-to-type).
    // Enter always starts the game (whether focused or not).
    this.input.keyboard?.on('keydown', (ev: KeyboardEvent) => {
      if (ev.key === 'Enter') {
        this.startGame();
        return;
      }
      if (!this.focused) return; // not focused → ignore typing entirely
      // When the real hidden <input> is the active element it owns text editing (its
      // `input` event updates playerName). Skip here to avoid appending each key twice.
      if (this.hiddenInput && document.activeElement === this.hiddenInput) return;
      if (ev.key === 'Escape') {
        this.setFocused(false);
        return;
      }
      if (ev.key === 'Backspace') {
        this.playerName = this.playerName.slice(0, -1);
        this.saveName(this.playerName);
        this.redrawField();
        return;
      }
      if (ev.key.length === 1 && /[A-Za-z0-9 ]/.test(ev.key)) {
        if (ev.key === ' ' && this.playerName.length === 0) return;
        if (this.playerName.length < NAME_MAX) {
          this.playerName += ev.key;
          this.saveName(this.playerName);
          this.redrawField();
        }
      }
    });

    // A click blurs the name field ONLY if it was not on the field itself. We check what
    // is under the pointer (rather than relying on stopPropagation, which does not stop
    // this scene-level input event) so that clicking the field focuses it and keeps it
    // focused instead of immediately blurring.
    this.input.on(
      'pointerdown',
      (_p: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) => {
        if (this.nameHit && currentlyOver.includes(this.nameHit)) return; // clicked field
        if (this.focused) this.setFocused(false);
      },
    );
  }

  private resolveName(): string {
    return this.playerName.trim();
  }

  private startGame(): void {
    const name = this.resolveName();
    // Name is REQUIRED. If empty, focus the field and nudge the hint — do NOT start.
    if (!name) {
      this.setFocused(true);
      if (this.fieldHintText) {
        this.fieldHintText.setColor('#ff9a9a').setText('Please enter your name to start');
        this.tweens.add({
          targets: this.fieldHintText,
          scale: { from: 1.2, to: 1 },
          duration: 200,
        });
      }
      return;
    }
    this.saveName(name);
    this.scene.start('HimalRajya', {
      levelIndex: 1,
      cumulativeScore: 0,
      playerName: name,
    });
  }
}
