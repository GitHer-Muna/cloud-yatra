/**
 * HimalRajyaScene — the playable levels of Cloud Yatra, now fully LEVEL-CONFIG-DRIVEN.
 *
 * The scene reads a `LevelConfig` (see config/levels.ts) for EVERYTHING that varies per
 * level: world width, palette, platforms, collectibles, hazards, checkpoints and par
 * time. This lets the three regions of Nepal look and play distinctly without cloning
 * scene code:
 *   - TERAI  (level 1): subtropical jungle — sal-forest silhouettes, tall grass, no snow.
 *   - HILLS  (level 2): terraced paddy, fishtail Himalaya, pagoda, stupa, prayer wheels.
 *   - HIMAL  (level 3): the high-Himalaya finale — big snow peaks, glacier, snow ground.
 *
 * Layers:
 *  - BACKGROUND (visual only): per-region procedural art with PARALLAX depth.
 *  - GAMEPLAY (physics): ground + platforms, Yatri, blooms, prayer bells, hazards,
 *    checkpoints, START/END markers.
 *
 * PROGRESSION: completing a level advances to the NEXT level (carrying cumulative score).
 * Completing level 3 is the finale → submits the final score and opens the Leaderboard.
 * Dying restarts the pilgrimage from level 1.
 *
 * All art is ORIGINAL, drawn procedurally (see CREDITS.md).
 */
import Phaser from 'phaser';
import { VIEW_WIDTH, VIEW_HEIGHT } from '../config/constants';
import { PLAYER } from '../config/playerConfig';
import {
  SCORING,
  GROUND_HEIGHT,
  levelByIndex,
  type LevelConfig,
  type LevelPalette,
} from '../config/levels';
import { Yatri, type YatriEvent } from '../entities/Yatri';
import { RhododendronBloom } from '../entities/RhododendronBloom';
import { PrayerBell } from '../entities/PrayerBell';
import { MistWisp } from '../entities/MistWisp';
import { Eagle } from '../entities/Eagle';
import { Rockfall } from '../entities/Rockfall';
import { CuttableObstacle } from '../entities/CuttableObstacle';
import { Checkpoint } from '../entities/Checkpoint';
import { Hud } from '../ui/Hud';
import { GuruMegh } from '../ui/GuruMegh';
import { askOracle } from '../telemetry/oracleClient';
import { TelemetryService } from '../telemetry/TelemetryService';
import { ConsoleSink, FaroSink, HttpBatchSink, MultiSink, type TelemetrySink } from '../telemetry/sinks';
import { getFaro } from '../telemetry/faro';
import { FpsSampler } from '../telemetry/FpsSampler';
import { NepaliAudio } from '../audio/NepaliAudio';

const FPS_SAMPLE_MS = 2000;

// The world height is fixed to the view height; only the world WIDTH varies per level.
const WORLD_HEIGHT = VIEW_HEIGHT;

export class HimalRajyaScene extends Phaser.Scene {
  private yatri!: Yatri;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<'up' | 'left' | 'right' | 'attack', Phaser.Input.Keyboard.Key>;
  private attackAltKey?: Phaser.Input.Keyboard.Key;
  private hud!: Hud;
  private guru!: GuruMegh;
  private apiBase = '';

  // The active level config + its palette (both come from levels.ts).
  private level!: LevelConfig;
  private palette!: LevelPalette;
  private worldWidth = 3600;

  private clouds: Phaser.GameObjects.Container[] = [];
  private wisps: MistWisp[] = [];
  private eagles: Eagle[] = [];
  private rockfalls: Rockfall[] = [];
  private cuttables: CuttableObstacle[] = [];
  private checkpoints: Checkpoint[] = [];
  private endX = 0;
  private score = 0;
  private bloomsCollected = 0;
  private bellsCollected = 0;
  private attempt = 1;
  private levelComplete = false;
  private gameOver = false;
  private levelTransitionStarted = false;
  private graceUsed = false;
  private levelStartTime = 0;

  // Continuation across levels: cumulative score is carried forward; best is persisted.
  private cumulativeScore = 0;
  private bestScore = 0;
  private playerName = '';
  private lastGuruAt = 0; // local throttle for spontaneous Guru Megh lines
  private nextGuruEncouragementAt = 0;
  private saidFirstBell = false;
  private cuttableHintShown = false;

  // Combo state.
  private combo = 0;
  private comboExpiresAt = 0;

  private statusText!: Phaser.GameObjects.Text;
  private telemetry!: TelemetryService;
  private fpsSampler!: FpsSampler;
  private sound_?: NepaliAudio;

  constructor() {
    super('HimalRajya');
  }

  /** Receives continuation data across scene restarts (which level + carried score). */
  init(data: { levelIndex?: number; cumulativeScore?: number; playerName?: string }): void {
    const levelIndex = Math.max(1, Math.min(3, data.levelIndex ?? 1));
    this.level = levelByIndex(levelIndex);
    this.palette = this.level.palette;
    this.worldWidth = this.level.worldWidth;
    this.cumulativeScore = data.cumulativeScore ?? 0;
    this.playerName = data.playerName ?? '';
    try {
      this.bestScore = Number(localStorage.getItem('cy_best_score') ?? '0') || 0;
    } catch {
      this.bestScore = 0;
    }
  }

  create(): void {
    // Reset per-run state (create() re-runs on scene.restart()).
    this.score = 0;
    this.bloomsCollected = 0;
    this.bellsCollected = 0;
    this.combo = 0;
    this.comboExpiresAt = 0;
    this.levelComplete = false;
    this.gameOver = false;
    this.levelTransitionStarted = false;
    this.graceUsed = false;
    this.saidFirstBell = false;
    this.cuttableHintShown = false;
    this.clouds = [];
    this.wisps = [];
    this.eagles = [];
    this.rockfalls = [];
    this.cuttables = [];
    this.checkpoints = [];

    this.physics.world.setBounds(0, 0, this.worldWidth, WORLD_HEIGHT);
    this.cameras.main.setBounds(0, 0, this.worldWidth, WORLD_HEIGHT);

    // Background (far → near), chosen per region so each level is visually distinct.
    this.createSky();
    this.createRegionBackdrop();
    this.createClouds();

    // Gameplay floor + platforms.
    const platforms = this.createGroundAndPlatforms();
    const groundTop = WORLD_HEIGHT - GROUND_HEIGHT;

    const startX = 120;
    this.endX = this.worldWidth - 150;
    this.createMarker(startX, groundTop, this.palette.accent, 'START');
    this.createRouteGuidance(groundTop);
    this.createEndPennant(this.endX, groundTop);

    // Yatri.
    const yatriHeight = PLAYER.gridRows * PLAYER.px;
    this.yatri = new Yatri(
      this,
      startX,
      groundTop - yatriHeight / 2,
      PLAYER.startingLives,
      this.level.id,
      (e) => this.onYatriEvent(e),
    );
    this.physics.add.collider(this.yatri, platforms);

    // Blooms are placed from the actual route surface, not hand-authored Y values. This
    // prevents a platform from covering a lali gurans and makes every collectible visible.
    // IMPORTANT: the group is created with allowGravity:false. Adding a sprite to a
    // physics group re-applies the group's defaults, which would otherwise RE-ENABLE
    // gravity and make every flower fall off the screen on spawn (the "falling" bug).
    const blooms = this.physics.add.group({ allowGravity: false, immovable: true });
    // Region-true flowers: rhododendron (lali gurans) grows in Nepal's HILLS & HIMALAYA;
    // the subtropical Terai lowlands get warm marigold (sayapatri) blooms instead.
    const bloomVariant = this.level.id === 'terai' ? 'marigold' : 'rhododendron';
    for (const b of this.level.blooms) {
      const surfaceTop = this.surfaceTopAt(b.x, groundTop);
      // Float the bloom clearly above the surface so it's fully visible in the play area
      // and never clipped by the bottom controls bar. The bloom's tall collision box
      // still reaches down to the walking player, so it's collectible on the ground path.
      const visibleY = surfaceTop - 62;
      blooms.add(new RhododendronBloom(this, b.x, visibleY, bloomVariant));
    }
    this.physics.add.overlap(this.yatri, blooms, (_p, obj) =>
      this.collectBloom(obj as RhododendronBloom),
    );

    // Prayer bells (rare bonus, big points) — spread across the journey. Same
    // allowGravity:false group default so bells don't fall on spawn either.
    const bells = this.physics.add.group({ allowGravity: false, immovable: true });
    for (const b of this.level.bells) bells.add(new PrayerBell(this, b.x, b.y));
    this.physics.add.overlap(this.yatri, bells, (_p, obj) =>
      this.collectBell(obj as PrayerBell),
    );

    // Hazards — spawned by kind from the level config.
    this.spawnHazards(groundTop);

    // Khukuri-cuttable obstacles on the path. These NEVER cost a life — they simply
    // block the way: walking into an uncut one gently bumps the player back (and shows a
    // one-time "Slash with F!" hint). The player clears them by slashing (F/J) or can
    // jump over them. This removes the old "stuck losing lives at a bush" frustration.
    for (const cu of this.level.cuttables) {
      const obs = new CuttableObstacle(this, cu.x, groundTop, cu.kind);
      this.cuttables.push(obs);
      this.physics.add.overlap(this.yatri, obs, () => {
        const body = obs.body as Phaser.Physics.Arcade.Body | null;
        if (obs.isCut() || !obs.active || !body?.enable) return;
        if (this.yatri.isAttacking()) return; // the swing will cut it this frame
        this.bumpBackFromObstacle(obs);
      });
    }

    // Checkpoints (plant the pennant).
    for (const cx of this.level.checkpoints) {
      const cp = new Checkpoint(this, cx, groundTop);
      this.checkpoints.push(cp);
      this.physics.add.overlap(this.yatri, cp, () => this.reachCheckpoint(cp));
    }

    this.cameras.main.startFollow(this.yatri, true, 0.15, 0.15);
    this.cameras.main.setDeadzone(60, 120);
    this.cameras.main.setRoundPixels(true);
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = {
      up: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      left: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      attack: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.F),
    };
    // A second attack key (J) for players who prefer it — OR'd into the attack signal.
    const attackAlt = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.J);
    this.attackAltKey = attackAlt;

    this.hud = new Hud(this);
    this.hud.setScore(this.score);
    this.hud.setLives(this.yatri.getLives());
    this.hud.setCombo(0);
    this.hud.showIntro(2600, `Level ${this.level.index} — ${this.level.name}`, this.level.subtitle);

    this.statusText = this.add
      .text(VIEW_WIDTH / 2, VIEW_HEIGHT * 0.4, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '22px',
        color: '#10233b',
        backgroundColor: 'rgba(255,255,255,0.92)',
        padding: { x: 18, y: 14 },
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(2500)
      .setVisible(false);

    // Telemetry: ONE service per browser session (stored in the registry) so the
    // anonymous sessionId stays stable across scene.restart(). game_started fires once.
    let service = this.registry.get('telemetry') as TelemetryService | undefined;
    const firstLoad = !service;
    if (!service) {
      const sinks: TelemetrySink[] = [new ConsoleSink()];
      // Send to the live backend when a public API URL is configured (Vite build-time).
      const env =
        (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
      const apiBase = env.VITE_API_BASE_URL;
      if (apiBase) {
        // Use /ingest (not /event) — a neutral path that browser ad/privacy blockers
        // don't target, so telemetry reaches the backend for reviewers with blockers.
        sinks.push(new HttpBatchSink(`${apiBase.replace(/\/$/, '')}/ingest`));
      }
      const faro = getFaro();
      if (faro) sinks.push(new FaroSink(faro));
      const sink: TelemetrySink = sinks.length === 1 ? sinks[0] : new MultiSink(sinks);
      service = new TelemetryService(sink);
      this.registry.set('telemetry', service);
    }
    this.telemetry = service;
    // The per-level telemetry label uses the region id (bounded, low-cardinality).
    this.telemetry.setLevel(this.level.id);

    // Original Nepali procedural audio: ONE instance per session (registry) so music
    // continues seamlessly across level restarts. Browsers need a user gesture to start,
    // so we also resume/start it on the first key or pointer input below.
    let audio = this.registry.get('audio') as NepaliAudio | undefined;
    if (!audio) {
      audio = new NepaliAudio();
      this.registry.set('audio', audio);
    }
    this.sound_ = audio;
    // Each region of Nepal has its own melody/tempo/timbre — switch to this level's.
    this.sound_.setRegion(this.level.id);
    // Music starts HERE — i.e. only once actual gameplay has begun (the player pressed
    // START on the menu, which is itself the user gesture browsers require). It does NOT
    // play on the title screen or on page load. A fallback on the first in-game input
    // covers the rare case where the AudioContext is still 'suspended' at scene start.
    const kickAudio = (): void => {
      this.sound_?.resume();
      this.sound_?.start();
    };
    kickAudio();
    this.input.keyboard?.once('keydown', kickAudio);
    this.input.once('pointerdown', kickAudio);
    this.input.keyboard?.on('keydown-R', () => {
      if (this.levelComplete || this.gameOver) return;
      this.telemetry.record({ type: 'game_restarted', fromReason: 'manual' });
      this.scene.restart({
        levelIndex: this.level.index,
        cumulativeScore: this.cumulativeScore,
        playerName: this.playerName,
      });
    });
    this.input.keyboard?.on('keydown-L', () => {
      if (this.levelComplete || this.gameOver) return;
      this.scene.start('Leaderboard', { playerName: this.playerName });
    });
    // M toggles mute at any time.
    this.input.keyboard?.on('keydown-M', () => {
      const muted = this.sound_?.toggleMute() ?? false;
      this.hud.setMuted(muted);
    });
    this.hud.setMuted(this.sound_?.isMuted() ?? false);

    // FPS sampler: emits ONE averaged client_perf event every ~2s (not per-frame).
    this.fpsSampler = new FpsSampler(FPS_SAMPLE_MS, (avgFps) => {
      this.telemetry.record({ type: 'client_perf', avgFps });
      this.hud.setFps(avgFps);
    });

    // Telemetry-ready lifecycle events.
    this.levelStartTime = this.time.now;
    this.nextGuruEncouragementAt = this.time.now + 18000;
    if (firstLoad) this.telemetry.record({ type: 'game_started' });
    this.telemetry.record({ type: 'level_started', attempt: this.attempt });

    // Guru Megh (Bedrock-powered cloud-sage). Greets on start; narrates death/completion.
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
    this.apiBase = env.VITE_API_BASE_URL ?? '';
    this.guru = new GuruMegh(this);
    // Guru Megh is optional guidance, but each region gets its own contextual welcome so
    // the model's purpose is clear throughout Terai → Hills → High Himalaya.
    this.guru.sayAsync(
      askOracle(this.apiBase, {
        useCase: 'welcome',
        sessionId: this.telemetry.getSessionId(),
        levelId: this.level.id,
        recentEvent: 'level_started',
        attempts: this.level.index,
      }),
      5000,
    );
  }

  update(_time: number, deltaMs: number): void {
    if (!this.yatri) return;

    this.fpsSampler.tick(deltaMs, this.game.loop.actualFps);

    if (this.hud.isIntroVisible() && this.isAnyMoveKeyDown()) this.hud.hideIntro();

    for (const w of this.wisps) w.patrol();
    for (const e of this.eagles) e.patrol();
    for (const r of this.rockfalls) r.fall(deltaMs);

    // Expire the combo if the player waited too long.
    if (this.combo > 0 && this.time.now > this.comboExpiresAt) {
      this.combo = 0;
      this.hud.setCombo(0);
    }

    // Calm progress encouragement during long stretches, in addition to checkpoints and
    // level transitions. The local throttle prevents chatter and keeps Bedrock spend low.
    if (
      !this.levelComplete &&
      !this.gameOver &&
      this.time.now >= this.nextGuruEncouragementAt
    ) {
      this.guruMoment('hint', 'journey_progress');
      this.nextGuruEncouragementAt = this.time.now + 22000;
    }

    if (!this.levelComplete && !this.gameOver) {
      this.yatri.updateFromInput(this.cursors, deltaMs, {
        left: this.wasd.left,
        right: this.wasd.right,
        up: this.wasd.up,
        attack: {
          isDown: Boolean(this.wasd.attack.isDown || this.attackAltKey?.isDown),
        },
      });
      this.resolveKhukuriCuts();
      this.hud.setTime(Math.round(this.time.now - this.levelStartTime));
      // Use the body's leading edge (same reference as the win trigger) so the bar reads
      // 100% exactly when the player reaches the END pennant — not a hair early.
      const leadX = (this.yatri.body as Phaser.Physics.Arcade.Body).right;
      this.hud.setProgress((leadX - 120) / (this.endX - 120));
    } else {
      this.yatri.setVelocityX(0);
    }

    // Fell out of the world. Falling into the void ALWAYS costs a life and always
    // respawns — invulnerability (from a recent hit) must not let the player "survive"
    // the void or get yanked back without penalty. We force the hit, then respawn once.
    if (!this.gameOver && !this.levelComplete && this.yatri.hasFallenBelow(WORLD_HEIGHT)) {
      const lost = this.yatri.takeFallDamage();
      if (lost) {
        this.hud.setLives(this.yatri.getLives());
        this.breakCombo();
        this.telemetry.record({ type: 'player_damaged', cause: 'fall', livesLeft: this.yatri.getLives() });
      }
      if (this.yatri.isDead()) {
        if (this.usePilgrimGrace('fall')) this.yatri.respawn();
        else {
          this.telemetry.record({ type: 'player_died', cause: 'fall' });
          this.endGame('fall');
        }
      } else {
        this.yatri.respawn();
      }
    }

    // The END pennant is a real finish trigger: use the body's leading edge so the
    // resized sprite cannot visually reach the flag while its centre remains short.
    const playerRight = (this.yatri.body as Phaser.Physics.Arcade.Body).right;
    if (!this.levelComplete && !this.gameOver && playerRight >= this.endX) {
      this.completeLevel();
    }

    for (const cloud of this.clouds) {
      cloud.x += 0.15;
      if (cloud.x > this.worldWidth + 120) cloud.x = -120;
    }
  }

  /** Merge arrow keys + WASD into one cursor-like object for the Yatri. */
  private isAnyMoveKeyDown(): boolean {
    return Boolean(
      this.cursors.left?.isDown ||
        this.cursors.right?.isDown ||
        this.cursors.up?.isDown ||
        this.cursors.space?.isDown ||
        this.wasd.left.isDown ||
        this.wasd.right.isDown ||
        this.wasd.up.isDown,
    );
  }

  // --- hazards ---

  /** Spawn hazards from the level config, one entity per `kind`. */
  private spawnHazards(groundTop: number): void {
    for (const h of this.level.hazards) {
      switch (h.kind) {
        case 'mist': {
          const wisp = new MistWisp(this, h.x, h.y, h.range, h.speed);
          this.wisps.push(wisp);
          this.physics.add.overlap(this.yatri, wisp, () => this.hitHazard('mist'));
          break;
        }
        case 'monkey': {
          // Reuse the MistWisp movement but tint it brown so it reads as a monkey.
          const monkey = new MistWisp(this, h.x, h.y, h.range, h.speed);
          monkey.setTint(0x8a5a2b);
          this.wisps.push(monkey);
          this.physics.add.overlap(this.yatri, monkey, () => this.hitHazard('monkey'));
          break;
        }
        case 'eagle': {
          const eagle = new Eagle(this, h.x, h.y, h.range, h.speed);
          this.eagles.push(eagle);
          this.physics.add.overlap(this.yatri, eagle, () => this.onEagleContact(eagle));
          break;
        }
        case 'rockfall': {
          // For rockfall the config `y` is the top spawn height and `speed` the fall speed.
          // Stop/reset the rock at the HIGHEST surface under its column (a platform top
          // if one sits beneath, else the ground) so it lands ON the surface instead of
          // tunnelling THROUGH solid ledges — which previously let it strike a player who
          // was standing safely on that platform.
          const landY = this.surfaceTopAt(h.x, groundTop);
          const rock = new Rockfall(this, h.x, h.y, h.speed, landY);
          this.rockfalls.push(rock);
          // Only a FALLING (visible) rock can hit — never the invisible one resting at the
          // top between cycles (which otherwise clipped the apex of a perfect jump).
          this.physics.add.overlap(this.yatri, rock, () => {
            if (rock.isActive()) this.hitHazard('rockfall');
          });
          break;
        }
      }
    }
  }

  // --- gameplay handlers ---

  /**
   * If the khukuri swing hitbox overlaps any un-cut obstacle this frame, cut it: award
   * points, feedback, and telemetry. Called each frame while playing.
   */
  private resolveKhukuriCuts(): void {
    if (!this.yatri.isAttacking()) return;
    const hit = this.yatri.getAttackHitbox();
    const playerBounds = this.yatri.getBounds();
    for (const obs of this.cuttables) {
      if (obs.isCut() || !obs.active) continue;
      const bounds = obs.getBounds();
      // Cut if the forward swing hitbox touches it OR the player is standing in/next to
      // it while swinging — so a swing reliably clears whatever is blocking you, never a
      // "I slashed but it didn't cut" moment.
      const forwardHit = hit ? Phaser.Geom.Intersects.RectangleToRectangle(hit, bounds) : false;
      const overlapHit = Phaser.Geom.Intersects.RectangleToRectangle(playerBounds, bounds);
      if (forwardHit || overlapHit) {
        if (obs.cut()) {
          this.score += SCORING.cutPoints;
          this.hud.setScore(this.score);
          this.floatText(obs.x, obs.y - obs.height, `+${SCORING.cutPoints}`, '#e8dcc0');
          this.cameras.main.shake(60, 0.003);
          this.sound_?.play('collect');
          this.telemetry.record({
            type: 'obstacle_cut',
            kind: obs.kind,
            points: SCORING.cutPoints,
            total: this.score,
          });
        }
      }
    }
  }

  private collectBell(bell: PrayerBell): void {
    if (!bell.collect()) return;
    this.bellsCollected += 1;
    this.score += SCORING.bellPoints;

    // A prayer bell is a BLESSING: it grants +1 life — the rare, felt reward that makes
    // exploring up to the platforms worthwhile. At the life cap it converts to a big
    // point bonus so the reward is never wasted.
    const gained = this.yatri.gainLife(SCORING.bellLifeBonus);
    if (gained > 0) {
      this.hud.setLives(this.yatri.getLives());
      this.floatText(bell.x, bell.y, 'Prayer Bell — Blessing! +1 \u2764', '#f3c11b');
    } else {
      this.score += SCORING.bellCapConvertPoints;
      this.floatText(
        bell.x,
        bell.y,
        `Prayer Bell! +${SCORING.bellPoints + SCORING.bellCapConvertPoints}`,
        '#f3c11b',
      );
    }
    this.hud.setScore(this.score);
    this.hud.setBells(this.bellsCollected);
    this.collectBurst(bell.x, bell.y, 0xf3c623);
    this.cameras.main.flash(120, 243, 193, 27, false);
    this.sound_?.play('bell');
    if (!this.saidFirstBell) {
      this.saidFirstBell = true;
      this.guruMoment('hint', 'found_prayer_bell');
    }
    this.telemetry.record({
      type: 'collectible_collected',
      kind: 'prayer_bell',
      points: SCORING.bellPoints,
      total: this.score,
    });
  }

  private collectBloom(bloom: RhododendronBloom): void {
    if (!bloom.collect()) return;

    // Advance the combo. The cap is the step at which the multiplier FIRST reaches
    // comboMax: 1 + (step-1)*comboStep = comboMax  →  step = (comboMax-1)/comboStep + 1.
    // Counting past that is wasted (the multiplier is already clamped), so we cap there.
    const comboCap = Math.round((SCORING.comboMax - 1) / SCORING.comboStep) + 1;
    const wasAtMax = this.combo >= comboCap;
    this.combo = Math.min(this.combo + 1, comboCap);
    this.comboExpiresAt = this.time.now + SCORING.comboWindowMs;
    const multiplier = Math.min(
      1 + (this.combo - 1) * SCORING.comboStep,
      SCORING.comboMax,
    );
    const points = Math.round(SCORING.scorePerBloom * multiplier);
    this.score += points;
    this.bloomsCollected += 1;

    this.hud.setScore(this.score);
    this.hud.setCombo(multiplier > 1 ? multiplier : 0);
    this.hud.setBlooms(this.bloomsCollected, SCORING.garlandSize);
    // Only celebrate the moment the combo FIRST hits max (rising edge) — not every bloom
    // thereafter — so Guru Megh doesn't repeat and Bedrock spend stays low.
    if (this.combo >= comboCap && !wasAtMax) this.guruMoment('hint', 'combo_streak');

    // Floating "+points" feedback + a juicy burst at the bloom so the pickup clearly
    // registers. The label shows points and the combo when active.
    const label = multiplier > 1 ? `+${points}  (x${multiplier.toFixed(1)})` : `+${points}`;
    this.floatText(bloom.x, bloom.y, label, multiplier > 1 ? '#f3c623' : '#ffffff');
    this.collectBurst(bloom.x, bloom.y, this.level.id === 'terai' ? 0xffa41e : 0xe0294a);
    this.sound_?.play('collect');

    // GARLAND (mala) milestone: every `garlandSize` blooms completes a garland that grants
    // +1 life (capped) — the concrete survival reason to chase every flower. At the life
    // cap it becomes a big point bonus so the milestone always pays off.
    if (this.bloomsCollected > 0 && this.bloomsCollected % SCORING.garlandSize === 0) {
      this.awardGarland();
    }

    this.telemetry.record({
      type: 'collectible_collected',
      kind: 'rhododendron',
      points,
      total: this.score,
    });
  }

  /** A completed rhododendron garland (every garlandSize blooms): +1 life + points. */
  private awardGarland(): void {
    this.score += SCORING.garlandBonusPoints;
    const gained = this.yatri.gainLife(1);
    if (gained > 0) {
      this.hud.setLives(this.yatri.getLives());
      this.statusBurst('Garland complete!  +1 \u2764  +' + SCORING.garlandBonusPoints);
    } else {
      this.statusBurst('Garland complete!  +' + (SCORING.garlandBonusPoints + 100) + ' (lives full)');
      this.score += 100;
    }
    this.hud.setScore(this.score);
    this.cameras.main.flash(140, 224, 41, 74, false);
    this.sound_?.play('complete');
  }

  /** A brief centred status pop for milestone rewards (auto-hides). */
  private statusBurst(msg: string): void {
    this.statusText.setText(msg).setVisible(true);
    this.time.delayedCall(1300, () => {
      if (!this.gameOver && !this.levelComplete) this.statusText.setVisible(false);
    });
  }

  private breakCombo(): void {
    if (this.combo > 0) {
      this.combo = 0;
      this.hud.setCombo(0);
    }
  }

  /**
   * Eagle contact. If the Yatrini is descending onto the eagle's head (a stomp), the
   * eagle is defeated and she bounces — this makes the high platform route WINNABLE while
   * still rewarding good timing. Any other contact (side/below) costs a life as before.
   */
  private onEagleContact(eagle: Eagle): void {
    if (this.gameOver || this.levelComplete || eagle.isDead()) return;
    const body = this.yatri.body as Phaser.Physics.Arcade.Body;
    const eagleBody = eagle.body as Phaser.Physics.Arcade.Body;
    // A stomp = the Yatrini is moving downward and her feet are near/above the eagle's top.
    const falling = body.velocity.y > 40;
    const feetAboveHead = body.bottom <= eagleBody.top + eagleBody.height * 0.6;
    const attacking = this.yatri.isAttacking();
    // Either a well-timed stomp OR a khukuri swing defeats the eagle. This keeps the
    // elevated route completable without requiring one exact jump timing.
    if (attacking || (falling && feetAboveHead)) {
      if (eagle.kill()) {
        this.eagles = this.eagles.filter((e) => e !== eagle);
        if (!attacking) this.yatri.bounceOffStomp();
        this.score += SCORING.bellPoints; // reward a clean eagle defeat
        this.hud.setScore(this.score);
        this.floatText(
          eagle.x,
          eagle.y - 20,
          attacking ? `Khukuri! +${SCORING.bellPoints}` : `Stomp! +${SCORING.bellPoints}`,
          '#f3c623',
        );
        this.cameras.main.shake(80, 0.004);
        this.sound_?.play('stomp');
        this.telemetry.record({
          type: 'player_stomp',
          points: SCORING.bellPoints,
          total: this.score,
        });
      }
      return;
    }
    this.hitHazard('eagle');
  }

  /** One forgiving recovery per level prevents a single mistake from ending a good run. */
  private usePilgrimGrace(cause: string): boolean {
    if (this.graceUsed) return false;
    this.graceUsed = true;
    this.yatri.restoreLifeForGrace();
    this.hud.setLives(this.yatri.getLives());
    this.breakCombo();
    this.floatText(
      this.yatri.x,
      this.yatri.y - 56,
      `Pilgrim's Grace — saved from ${cause}`,
      '#f3c623',
    );
    this.statusText
      .setText('Pilgrim\'s Grace saved you!\nThe journey continues from your pennant.')
      .setVisible(true);
    this.time.delayedCall(1500, () => {
      if (!this.gameOver && !this.levelComplete) this.statusText.setVisible(false);
    });
    return true;
  }

  /**
   * Walking into an un-cut obstacle: a gentle, harmless bump-back (NO life lost) plus a
   * one-time hint so the player learns to slash (F/J) or jump over it. This keeps the
   * trail obstacles as fair, learnable blockers rather than a source of lost lives.
   */
  private bumpBackFromObstacle(obs: CuttableObstacle): void {
    if (this.gameOver || this.levelComplete) return;
    const body = this.yatri.body as Phaser.Physics.Arcade.Body;
    // Push the player back toward the side they came from (away from the obstacle centre).
    const dir = this.yatri.x <= obs.x ? -1 : 1;
    body.setVelocityX(dir * 160);
    if (!this.cuttableHintShown) {
      this.cuttableHintShown = true;
      this.floatText(this.yatri.x, this.yatri.y - 50, 'Press F to slash!  (or jump over)', '#f3c623');
    }
  }

  private hitHazard(cause: string): void {    if (this.gameOver || this.levelComplete) return;
    if (this.yatri.isInvulnerable()) return;
    const lost = this.yatri.takeDamage();
    if (!lost) return;
    this.hud.setLives(this.yatri.getLives());
    this.breakCombo();
    this.cameras.main.shake(150, 0.006);
    this.telemetry.record({ type: 'player_damaged', cause, livesLeft: this.yatri.getLives() });
    if (this.yatri.isDead()) {
      if (this.usePilgrimGrace(cause)) this.yatri.respawn();
      else {
        this.telemetry.record({ type: 'player_died', cause });
        this.endGame(cause);
      }
    } else {
      this.yatri.respawn();
    }
  }

  private reachCheckpoint(cp: Checkpoint): void {
    if (cp.isPlanted()) return;
    if (!cp.plant()) return;
    this.yatri.setCheckpoint(
      cp.worldX,
      cp.groundTopY - (PLAYER.gridRows * PLAYER.px) / 2,
    );
    this.floatText(cp.worldX, cp.groundTopY - 140, 'Pennant planted!', '#f3c623');
    this.guruMoment('hint', 'checkpoint_reached');
    this.telemetry.record({ type: 'flag_planted', checkpoint: cp.worldX });
  }

  private onYatriEvent(e: YatriEvent): void {
    if (e.type === 'jump') {
      this.telemetry.record({ type: 'player_jump', x: e.x, y: e.y });
      this.sound_?.play('jump');
    } else if (e.type === 'attack') {
      this.sound_?.play('slash');
    } else if (e.type === 'damaged') {
      this.sound_?.play('damage');
    }
  }

  /** Fire a spontaneous Guru Megh line, throttled locally to avoid chatter. */
  private guruMoment(useCase: 'hint' | 'death' | 'completed', recentEvent: string): void {
    const now = this.time.now;
    if (now - this.lastGuruAt < 12000) return; // at most one spontaneous line / 12s
    this.lastGuruAt = now;
    this.guru.sayAsync(
      askOracle(this.apiBase, {
        useCase,
        sessionId: this.telemetry.getSessionId(),
        levelId: this.level.id,
        recentEvent,
        attempts: this.level.index,
      }),
      4500,
    );
  }

  private completeLevel(): void {
    this.levelComplete = true;
    this.yatri.setVelocity(0, 0);
    const timeMs = Math.round(this.time.now - this.levelStartTime);

    // Completion bonuses: fast finish + remaining lives + a per-level clear bonus.
    const timeBonus = Math.max(
      0,
      Math.round(
        SCORING.timeBonusMax *
          (1 - Math.min(timeMs, this.level.parTimeMs) / this.level.parTimeMs),
      ),
    );
    const livesBonus = this.yatri.getLives() * SCORING.livesBonus;
    const clearBonus = SCORING.levelClearBonus;
    const runScore = this.score + timeBonus + livesBonus + clearBonus;
    this.score = runScore;
    this.cumulativeScore += runScore;
    this.hud.setScore(runScore);

    // Persist best cumulative score.
    let newBest = false;
    if (this.cumulativeScore > this.bestScore) {
      this.bestScore = this.cumulativeScore;
      newBest = true;
      try {
        localStorage.setItem('cy_best_score', String(this.bestScore));
      } catch {
        /* ignore storage errors */
      }
    }

    const isFinale = this.level.index >= 3;

    // Telemetry: on levels 1–2 record the per-level completion (region-keyed, for the
    // dashboard). On the FINALE we do NOT fire a per-level event here — submitFinalScore()
    // records the single authoritative 'himal_rajya' leaderboard entry below. This avoids
    // two competing level_completed events for the same run (the double-score bug).
    if (!isFinale) {
      this.telemetry.record({ type: 'level_completed', score: runScore, timeMs });
    }

    this.victoryCelebration();

    // Guru Megh gives a special victory blessing (Bedrock), aware of the level reached.
    this.guru.sayAsync(
      askOracle(this.apiBase, {
        useCase: 'completed',
        sessionId: this.telemetry.getSessionId(),
        levelId: this.level.id,
        recentEvent: 'level_completed',
        attempts: this.level.index,
      }),
      8000,
    );

    const secs = (timeMs / 1000).toFixed(1);

    if (!isFinale) {
      const nextLevel = levelByIndex(this.level.index + 1);
      this.statusText
        .setText(
          `🏆  LEVEL ${this.level.index} WON — ${this.level.name}!  (${secs}s)\n\n` +
            `Run score: ${runScore}  (time +${timeBonus}, lives +${livesBonus})\n` +
            `Total journey: ${this.cumulativeScore}\n` +
            (newBest ? '⭐ NEW BEST!\n' : `Best: ${this.bestScore}\n`) +
            `\nPress N, Enter or Space for Level ${this.level.index + 1}: ${nextLevel.name}\n` +
            `Auto-continuing in 8 seconds…  ·  Press R to restart`,
        )
        .setVisible(true);
      this.armLevelChoice();
    } else {
      // FINALE — reached the summit. Submit the final score and open the leaderboard.
      this.telemetry.record({
        type: 'game_over',
        reason: 'completed',
        score: this.cumulativeScore,
        durationMs: this.telemetry.sinceStartMs(),
      });
      this.submitFinalScore(timeMs);
      this.statusText
        .setText(
          `🏆  LEVEL 3 WON — SUMMIT REACHED!  (${secs}s)\n\n` +
            `Final score: ${this.cumulativeScore}\n` +
            (newBest ? '⭐ NEW BEST!\n' : `Best: ${this.bestScore}\n`) +
            `\nOpening the leaderboard…`,
        )
        .setVisible(true);
      this.time.delayedCall(700, () => void this.openLeaderboard());
    }
  }

  private async openLeaderboard(): Promise<void> {
    await this.telemetry.flush(1500);
    if (!this.scene.isActive()) return;
    this.scene.start('Leaderboard', {
      score: this.cumulativeScore,
      playerName: this.playerName,
      justFinished: true,
    });
  }

  /**
   * Submit the final run to the backend leaderboard. The backend writes a leaderboard
   * entry from any `level_completed` event (see backend/src/handlers/event.ts), keyed by
   * the event's `levelId`. We set the telemetry level to the shared 'himal_rajya' board
   * key and record a final `level_completed` carrying the cumulative score. The player
   * name is collected/handled by the Leaderboard scene (the strict event contract has no
   * name field, so we don't extend it here).
   */
  private submitFinalScore(timeMs: number): void {
    this.telemetry.setLevel('himal_rajya');
    this.telemetry.record({
      type: 'level_completed',
      score: this.cumulativeScore,
      timeMs,
      name: this.playerName || undefined,
    });
    // Restore the region label for any late events (harmless; the finale is done).
    this.telemetry.setLevel(this.level.id);
  }

  private endGame(cause: string): void {
    if (this.gameOver) return;
    this.gameOver = true;
    this.yatri.setVelocity(0, 0);

    // Music lifecycle: on game over, let the theme play on for ~3s (a moment to breathe),
    // then STOP it. It stays stopped on the game-over screen and only starts again when
    // the player restarts (scene.restart → create() → kickAudio). Guard against the case
    // where the player restarts within those 3s (don't stop the freshly-restarted music).
    this.time.delayedCall(3000, () => {
      if (this.gameOver && this.scene.isActive()) this.sound_?.stop();
    });

    this.telemetry.record({
      type: 'game_over',
      reason: 'died',
      score: this.score,
      durationMs: this.telemetry.sinceStartMs(),
    });
    const DEATH_LABELS: Record<string, string> = {
      fall: 'lost in the mist below',
      eagle: 'caught by a mountain eagle',
      rockfall: 'struck by falling rock',
      monkey: 'ambushed on the jungle path',
      mist: 'touched by a Mist Wisp',
      // Khukuri-cuttable tangles (walking into them uncut) — correct, specific labels.
      thorn: 'caught in a thorn thicket',
      bamboo: 'blocked by a bamboo clump',
      nettle: 'stung by a nettle patch',
      khar: 'tangled in the tall khar grass',
      lahara: 'ensnared by a creeper vine',
    };
    const label = DEATH_LABELS[cause] ?? 'lost on the mountain path';
    this.guru.sayAsync(
      askOracle(this.apiBase, {
        useCase: 'death',
        sessionId: this.telemetry.getSessionId(),
        levelId: this.level.id,
        recentEvent: 'player_died',
        deathReason: cause,
        attempts: this.attempt,
      }),
      6000,
    );
    this.statusText
      .setText(
        `The journey pauses —\n${label}.\n\n` +
          `This level: ${this.score}\n` +
          `Journey total: ${this.cumulativeScore + this.score}\n` +
          `Best: ${this.bestScore}\n\n` +
          `Press R to begin a new journey (from the Terai)`,
      )
      .setVisible(true);
    this.armDeathRestart();
  }

  /** After death: R restarts a fresh journey from level 1. */
  private armDeathRestart(): void {
    this.input.keyboard?.once('keydown-R', () => {
      this.attempt += 1;
      this.telemetry.record({ type: 'game_restarted', fromReason: 'died' });
      this.scene.restart({ levelIndex: 1, cumulativeScore: 0, playerName: this.playerName });
    });
  }

  /** After a win, N/Enter/Space advances immediately; the timer prevents a stalled run. */
  private armLevelChoice(): void {
    const advance = (): void => this.advanceToNextLevel();
    this.input.keyboard?.once('keydown-N', advance);
    this.input.keyboard?.once('keydown-ENTER', advance);
    this.input.keyboard?.once('keydown-SPACE', advance);
    this.time.delayedCall(8000, advance);

    this.input.keyboard?.once('keydown-R', () => {
      if (this.levelTransitionStarted) return;
      this.levelTransitionStarted = true;
      this.telemetry.record({ type: 'game_restarted', fromReason: 'completed' });
      this.scene.restart({ levelIndex: 1, cumulativeScore: 0, playerName: this.playerName });
    });
  }

  private advanceToNextLevel(): void {
    if (!this.levelComplete || this.gameOver || this.levelTransitionStarted) return;
    this.levelTransitionStarted = true;
    this.telemetry.record({ type: 'game_restarted', fromReason: 'completed' });
    this.scene.restart({
      levelIndex: this.level.index + 1,
      cumulativeScore: this.cumulativeScore,
      playerName: this.playerName,
    });
  }

  /** A celebratory burst of rhododendron-red + gold particles at the summit. */
  private victoryCelebration(): void {
    this.cameras.main.flash(200, 243, 193, 27, false);
    this.sound_?.play('complete');
    const cx = this.cameras.main.midPoint.x;
    const cy = this.cameras.main.midPoint.y;
    const colors = [0xf3c623, 0xd23b2e, 0x2f9e5a, 0x1f5fbf, 0xffffff];
    for (let i = 0; i < 40; i++) {
      const dot = this.add
        .circle(cx, cy - 40, Phaser.Math.Between(3, 6), colors[i % colors.length])
        .setScrollFactor(0)
        .setDepth(2600);
      const ang = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const dist = Phaser.Math.Between(80, 260);
      this.tweens.add({
        targets: dot,
        x: cx + Math.cos(ang) * dist,
        y: cy + Math.sin(ang) * dist + 60,
        alpha: 0,
        scale: 0.4,
        duration: Phaser.Math.Between(700, 1300),
        ease: 'Quad.out',
        onComplete: () => dot.destroy(),
      });
    }
  }

  /** A small floating text that rises and fades — quick, readable feedback. */
  private floatText(x: number, y: number, msg: string, color: string): void {
    const t = this.add
      .text(x, y, msg, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '18px',
        color,
        fontStyle: 'bold',
        stroke: '#10233b',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(1500);
    // A little pop-in before rising, so the reward text has punch.
    t.setScale(0.5);
    this.tweens.add({ targets: t, scale: 1.1, duration: 120, yoyo: true });
    this.tweens.add({
      targets: t,
      y: y - 44,
      alpha: 0,
      duration: 820,
      delay: 120,
      ease: 'Quad.out',
      onComplete: () => t.destroy(),
    });
  }

  /**
   * A satisfying "collected!" burst at (x,y): an expanding ring + a few sparkle dots in
   * the given colour. Gives clear, juicy feedback that a pickup was grabbed.
   */
  private collectBurst(x: number, y: number, color: number): void {
    const ring = this.add.circle(x, y, 10, color, 0).setStrokeStyle(3, color, 0.9).setDepth(1490);
    this.tweens.add({
      targets: ring,
      scale: 3,
      alpha: 0,
      duration: 360,
      ease: 'Quad.out',
      onComplete: () => ring.destroy(),
    });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const dot = this.add.circle(x, y, 3, color, 1).setDepth(1491);
      this.tweens.add({
        targets: dot,
        x: x + Math.cos(a) * 26,
        y: y + Math.sin(a) * 26,
        alpha: 0,
        scale: 0.3,
        duration: 380,
        ease: 'Quad.out',
        onComplete: () => dot.destroy(),
      });
    }
  }

  // --- background builders (visual only) ---

  private createSky(): void {
    const g = this.add.graphics().setScrollFactor(0).setDepth(-100);
    // Vertical gradient via stacked bands (arcade-simple, original), from the palette.
    const bands: Array<[number, number]> = [
      [this.palette.skyTop, 0.0],
      [this.palette.skyUpper, 0.28],
      [this.palette.skyMid, 0.52],
      [this.palette.skyLow, 0.78],
      [this.palette.skyGlow, 0.9],
    ];
    for (let i = 0; i < bands.length; i++) {
      const [color, start] = bands[i];
      const end = i + 1 < bands.length ? bands[i + 1][1] : 1;
      g.fillStyle(color, 1);
      g.fillRect(0, VIEW_HEIGHT * start, VIEW_WIDTH, VIEW_HEIGHT * (end - start) + 1);
    }
    // The dawn sun with a soft halo, low over the horizon.
    const sun = this.add.graphics().setScrollFactor(0.05).setDepth(-99);
    sun.fillStyle(this.palette.skyGlow, 0.25);
    sun.fillCircle(VIEW_WIDTH * 0.72, VIEW_HEIGHT * 0.42, 70);
    sun.fillStyle(this.palette.skyGlow, 0.45);
    sun.fillCircle(VIEW_WIDTH * 0.72, VIEW_HEIGHT * 0.42, 46);
    sun.fillStyle(0xfff8e6, 1);
    sun.fillCircle(VIEW_WIDTH * 0.72, VIEW_HEIGHT * 0.42, 30);
  }

  /** Dispatch to the per-region backdrop so each level looks clearly different. */
  private createRegionBackdrop(): void {
    switch (this.level.id) {
      case 'terai':
        this.createTeraiBackdrop();
        break;
      case 'hills':
        this.createHillsBackdrop();
        break;
      case 'himal':
        this.createHimalBackdrop();
        break;
    }
  }

  // ===================== TERAI (jungle) backdrop =====================

  /** Level 1 — warm lowland jungle: sal-forest tree silhouettes + tall grass. No snow. */
  private createTeraiBackdrop(): void {
    // Distant hazy tree line (far layer).
    const far = this.add.graphics().setScrollFactor(0.12).setDepth(-95);
    const horizon = WORLD_HEIGHT * 0.6;
    far.fillStyle(0x8fbf6a, 0.6);
    for (let x = -40; x < this.worldWidth + 40; x += 46) {
      const h = 60 + Math.sin(x / 90) * 20;
      far.fillCircle(x, horizon, h * 0.7);
    }

    // Mid sal-forest tree silhouettes (trunk + rounded canopy), warm greens.
    const mid = this.add.graphics().setScrollFactor(0.3).setDepth(-82);
    const baseY = WORLD_HEIGHT * 0.72;
    const tree = (tx: number, scale: number, canopy: number, trunk: number) => {
      const th = 90 * scale;
      const cw = 46 * scale;
      mid.fillStyle(trunk, 1);
      mid.fillRect(tx - 4 * scale, baseY - th, 8 * scale, th);
      mid.fillStyle(canopy, 1);
      mid.fillCircle(tx, baseY - th, cw);
      mid.fillCircle(tx - cw * 0.6, baseY - th + 10 * scale, cw * 0.7);
      mid.fillCircle(tx + cw * 0.6, baseY - th + 8 * scale, cw * 0.72);
      mid.fillCircle(tx, baseY - th - cw * 0.5, cw * 0.7);
    };
    for (let x = 120, i = 0; x < this.worldWidth; x += 260, i++) {
      const scale = 0.9 + ((i * 37) % 5) * 0.08;
      const canopy = i % 2 === 0 ? 0x3f7d34 : 0x2f6a2a;
      tree(x, scale, canopy, 0x5a3d24);
    }

    // Tall grass fringe near the ground (near layer, brighter warm green).
    const grass = this.add.graphics().setScrollFactor(0.55).setDepth(-70);
    const gy = WORLD_HEIGHT - GROUND_HEIGHT;
    for (let x = 0; x < this.worldWidth; x += 12) {
      const blade = 26 + Math.sin(x / 24) * 10;
      grass.fillStyle(0x6bbf3e, 0.9);
      grass.fillTriangle(x, gy, x + 3, gy - blade, x + 6, gy);
      grass.fillStyle(0x4f9e2f, 0.8);
      grass.fillTriangle(x + 6, gy, x + 9, gy - blade * 0.8, x + 12, gy);
    }
    // A few marigold specks in the grass for warm colour accents.
    for (let x = 90; x < this.worldWidth; x += 210) {
      grass.fillStyle(this.palette.accent, 0.95);
      grass.fillCircle(x, gy - 10, 4);
    }
  }

  // ===================== HILLS backdrop (preserved from the original) =====================

  /** Level 2 — the classic valley: terraced hills, fishtail Himalaya, pagoda, stupa. */
  private createHillsBackdrop(): void {
    this.createHimalaya();
    this.createHillsHaze();
    this.createHills();
    this.createPagoda();
    this.createPrayerFlags();
  }

  /**
   * A soft warm haze band sitting between the cold grey peaks and the green valley. This
   * is the classic mid-hills look — distant ridges fading into golden morning mist — and
   * it stops the grey Himalaya from dominating, giving the level its own warm identity.
   */
  private createHillsHaze(): void {
    const haze = this.add.graphics().setScrollFactor(0.12).setDepth(-88);
    const bandTop = WORLD_HEIGHT * 0.44;
    const bandH = WORLD_HEIGHT * 0.26;
    // Smooth gradient from warm peach (near the peaks) to a soft green (toward the valley).
    const steps = 10;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const y = bandTop + t * bandH;
      // Interpolate peach → soft green.
      const r = Math.round(0xff + t * (0xcf - 0xff));
      const gch = Math.round(0xe3 + t * (0xe0 - 0xe3));
      const b = Math.round(0xb0 + t * (0xa8 - 0xb0));
      const color = (Math.max(0, r) << 16) | (gch << 8) | Math.max(0, b);
      haze.fillStyle(color, 0.16);
      haze.fillRect(0, y, this.worldWidth, bandH / steps + 1);
    }
    // A couple of soft, hazy mid-distance ridge silhouettes (rolling green hills) that
    // fade into the mist — reinforcing the layered middle-hills depth.
    const ridge = this.add.graphics().setScrollFactor(0.22).setDepth(-86);
    const drawRidge = (yBase: number, amp: number, color: number, alpha: number) => {
      ridge.fillStyle(color, alpha);
      ridge.beginPath();
      ridge.moveTo(0, yBase);
      for (let x = 0; x <= this.worldWidth; x += 40) {
        ridge.lineTo(x, yBase - Math.sin(x / 220) * amp - Math.sin(x / 90) * (amp * 0.3));
      }
      ridge.lineTo(this.worldWidth, WORLD_HEIGHT);
      ridge.lineTo(0, WORLD_HEIGHT);
      ridge.closePath();
      ridge.fillPath();
    };
    drawRidge(WORLD_HEIGHT * 0.56, 26, 0x8fb68a, 0.5);
    drawRidge(WORLD_HEIGHT * 0.62, 34, 0x74a26f, 0.6);
  }

  private createHimalaya(): void {
    // TWO layers for depth: far (paler, slower) and mid (rockier, with lit/shadow faces).
    const far = this.add.graphics().setScrollFactor(0.08).setDepth(-95);
    const mid = this.add.graphics().setScrollFactor(0.16).setDepth(-90);
    const baseY = WORLD_HEIGHT * 0.62;

    // Rock/snow shades for the hills region (kept close to the original look).
    const peakFar = 0xb9c6d8;
    const peakMid = 0x93a6bd;
    const peakRock = 0x74869d;
    const peakShade = 0x5c6d84;
    const snow = 0xf7fbff;
    const snowShade = 0xdfe9f5;

    // A single peak with a shaded right face, a snow cap split into lit/shadow facets,
    // and a couple of dark ridgeline creases — reads distinctly as a Himalayan peak.
    const peak = (
      g: Phaser.GameObjects.Graphics,
      px: number,
      w: number,
      h: number,
      rock: number,
      rockShade: number,
      snowC: number,
      snowShadeC: number,
    ) => {
      const apexY = baseY - h;
      const lx = px - w / 2;
      const rx = px + w / 2;
      // Lit (left) face.
      g.fillStyle(rock, 1);
      g.beginPath();
      g.moveTo(px, apexY);
      g.lineTo(px, baseY);
      g.lineTo(lx, baseY);
      g.closePath();
      g.fillPath();
      // Shadow (right) face.
      g.fillStyle(rockShade, 1);
      g.beginPath();
      g.moveTo(px, apexY);
      g.lineTo(rx, baseY);
      g.lineTo(px, baseY);
      g.closePath();
      g.fillPath();
      // Snow cap (upper third), split lit/shadow along the centre ridge.
      const capY = apexY + h * 0.34;
      const capL = px - w * 0.17;
      const capR = px + w * 0.17;
      g.fillStyle(snowC, 1);
      g.beginPath();
      g.moveTo(px, apexY);
      g.lineTo(px, capY);
      g.lineTo(capL, capY);
      g.closePath();
      g.fillPath();
      g.fillStyle(snowShadeC, 1);
      g.beginPath();
      g.moveTo(px, apexY);
      g.lineTo(capR, capY);
      g.lineTo(px, capY);
      g.closePath();
      g.fillPath();
      // Snow "fingers" drooping down the gullies (classic Himalaya look).
      g.fillStyle(snowC, 0.9);
      g.beginPath();
      g.moveTo(px, capY);
      g.lineTo(px - w * 0.06, capY + h * 0.16);
      g.lineTo(px + w * 0.02, capY + h * 0.1);
      g.closePath();
      g.fillPath();
    };

    // Far range (pale, low, hazy).
    for (const p of [
      { x: 220, w: 380, h: 250 },
      { x: 720, w: 440, h: 290 },
      { x: 1250, w: 400, h: 260 },
      { x: 1780, w: 470, h: 300 },
      { x: 2350, w: 420, h: 270 },
      { x: 2950, w: 450, h: 300 },
      { x: 3450, w: 400, h: 260 },
    ]) {
      peak(far, p.x, p.w, p.h, peakFar, peakMid, snow, snowShade);
    }
    // Mid range (taller, rockier giants).
    for (const p of [
      { x: 420, w: 460, h: 380 },
      { x: 1000, w: 540, h: 450 }, // a dominant giant (Everest-like)
      { x: 1620, w: 470, h: 400 },
      { x: 2200, w: 560, h: 460 },
      { x: 2800, w: 480, h: 410 },
      { x: 3350, w: 500, h: 430 },
    ]) {
      peak(mid, p.x, p.w, p.h, peakRock, peakShade, snow, snowShade);
    }

    // --- Machapuchare "Fishtail": Nepal's iconic TWIN-summit peak (the Matterhorn of
    //     Nepal). Two sharp snow points close together resembling a fish's tail. ---
    const fx = 1000;
    const fbaseY = baseY;
    const fh = 470;
    const apex = fbaseY - fh;
    // Rock body.
    mid.fillStyle(peakRock, 1);
    mid.beginPath();
    mid.moveTo(fx, apex);
    mid.lineTo(fx + 300, fbaseY);
    mid.lineTo(fx - 300, fbaseY);
    mid.closePath();
    mid.fillPath();
    mid.fillStyle(peakShade, 1);
    mid.beginPath();
    mid.moveTo(fx, apex);
    mid.lineTo(fx + 300, fbaseY);
    mid.lineTo(fx, fbaseY);
    mid.closePath();
    mid.fillPath();
    // The twin snow summits (the "fishtail"): two points with a notch between them.
    const twin = (tipX: number, tipY: number, halfW: number, drop: number, snowC: number) => {
      mid.fillStyle(snowC, 1);
      mid.beginPath();
      mid.moveTo(tipX, tipY);
      mid.lineTo(tipX + halfW, tipY + drop);
      mid.lineTo(tipX - halfW, tipY + drop);
      mid.closePath();
      mid.fillPath();
    };
    twin(fx - 26, apex + 6, 34, 150, snow); // left summit
    twin(fx + 30, apex - 8, 30, 150, snowShade); // right summit (slightly higher)
    // Snow apron below the twin points.
    mid.fillStyle(snow, 0.95);
    mid.beginPath();
    mid.moveTo(fx - 60, apex + 156);
    mid.lineTo(fx + 60, apex + 148);
    mid.lineTo(fx + 40, apex + 220);
    mid.lineTo(fx - 40, apex + 224);
    mid.closePath();
    mid.fillPath();
  }

  private createHills(): void {
    const g = this.add.graphics().setScrollFactor(0.4).setDepth(-80);
    const hillFar = 0x8fc47f;
    const hillMid = 0x5fa64f;
    const hillNear = 0x3f8a37;
    const terraceLip = 0xc3e59e;
    const terraceLine = 0x2a5530;
    const paddyWater = 0xbfe8d8; // flooded-paddy sheen that catches the morning light
    // Stepped RICE TERRACES: each hill is a stack of gently-undulating shelves. Every
    // shelf has a lit grassy top, a thin paddy-water glint, and a darker riser below —
    // the carved, flooded-paddy look of the middle hills.
    const terracedHill = (topY: number, height: number, base: number, lip: number, riser: number) => {
      const steps = Math.floor(height / 13);
      for (let s = 0; s < steps; s++) {
        const y = topY + s * 13;
        g.fillStyle(base, 1);
        g.fillRect(0, y, this.worldWidth, 13);
        for (let x = 0; x < this.worldWidth; x += 8) {
          const wob = Math.sin((x + s * 40) / 130) * 3;
          g.fillStyle(lip, 0.9);
          g.fillRect(x, y + wob, 8, 2); // grassy lit lip
          g.fillStyle(paddyWater, 0.35);
          g.fillRect(x, y + wob + 2, 8, 2); // thin water sheen on the shelf
          g.fillStyle(riser, 0.55);
          g.fillRect(x, y + wob + 4, 8, 3); // shadowed riser
        }
      }
    };
    terracedHill(WORLD_HEIGHT * 0.5, 60, hillFar, terraceLip, terraceLine);
    terracedHill(WORLD_HEIGHT * 0.6, 78, hillMid, terraceLip, terraceLine);
    terracedHill(WORLD_HEIGHT * 0.73, 100, hillNear, terraceLip, terraceLine);
  }

  private createPagoda(): void {
    const g = this.add.graphics().setScrollFactor(0.32).setDepth(-82);
    const pagodaBody = 0xb98a5a;
    const pagodaShade = 0x8f6a45;
    const pagodaRoof = 0x7a3b2e;
    const glow = 0xf3c623;
    const text = 0x10233b;

    // --- A multi-tier PAGODA temple (Kathmandu-valley style, abstract) ---
    const drawPagoda = (bx: number, by: number) => {
      g.fillStyle(pagodaBody, 1);
      g.fillRect(bx - 22, by - 60, 44, 60);
      g.fillStyle(pagodaShade, 1);
      g.fillRect(bx + 6, by - 60, 16, 60);
      const roof = (cy: number, halfW: number) => {
        g.fillStyle(pagodaRoof, 1);
        g.beginPath();
        g.moveTo(bx - halfW, cy);
        g.lineTo(bx + halfW, cy);
        g.lineTo(bx + halfW - 12, cy - 15);
        g.lineTo(bx - halfW + 12, cy - 15);
        g.closePath();
        g.fillPath();
        // Upturned eave tips.
        g.fillRect(bx - halfW - 3, cy - 3, 4, 3);
        g.fillRect(bx + halfW - 1, cy - 3, 4, 3);
      };
      roof(by - 60, 34);
      roof(by - 82, 28);
      roof(by - 102, 20);
      g.fillStyle(glow, 1);
      g.fillRect(bx - 2, by - 118, 4, 16); // gajur finial
    };

    // --- A STUPA with the iconic Buddha eyes (Swayambhu/Boudha style, abstract) ---
    const drawStupa = (bx: number, by: number) => {
      // White dome.
      g.fillStyle(0xf3f3ef, 1);
      g.fillEllipse(bx, by, 84, 54);
      g.fillRect(bx - 42, by - 8, 84, 24);
      g.fillStyle(0xdedbd2, 1); // shadow side
      g.fillEllipse(bx + 14, by + 2, 46, 44);
      // Square harmika (the box that carries the eyes).
      g.fillStyle(0xf0e6cf, 1);
      g.fillRect(bx - 16, by - 42, 32, 26);
      g.fillStyle(0xd9cdb0, 1);
      g.fillRect(bx + 4, by - 42, 12, 26);
      // The all-seeing Buddha EYES (blue) + gold nose (the classic curl).
      g.fillStyle(0x1f5fbf, 1);
      g.fillRect(bx - 12, by - 34, 7, 5);
      g.fillRect(bx + 5, by - 34, 7, 5);
      g.fillStyle(text, 1);
      g.fillRect(bx - 10, by - 33, 3, 3);
      g.fillRect(bx + 7, by - 33, 3, 3);
      g.fillStyle(glow, 1);
      g.fillRect(bx - 2, by - 28, 4, 6); // nose curl
      // 13-tier golden spire → gajur.
      g.fillStyle(0xe8b93a, 1);
      for (let i = 0; i < 7; i++) {
        const wsp = 22 - i * 2.4;
        g.fillRect(bx - wsp / 2, by - 42 - 6 - i * 6, wsp, 5);
      }
      g.fillStyle(glow, 1);
      g.fillRect(bx - 3, by - 42 - 6 - 7 * 6, 6, 10);
    };

    drawPagoda(1350, WORLD_HEIGHT * 0.62);
    drawStupa(2500, WORLD_HEIGHT * 0.6);

    // --- A spinning PRAYER WHEEL (mani wheel): golden cylinder with vertical ribs that
    //     rotates — a constant sight along Nepali pilgrim paths. ---
    this.createPrayerWheel(650, WORLD_HEIGHT - 78);
    this.createPrayerWheel(1900, WORLD_HEIGHT - 78);
  }

  private createPrayerWheel(x: number, y: number): void {
    // Post + canopy.
    const post = this.add.graphics().setScrollFactor(0.6).setDepth(-6);
    post.fillStyle(0x7a5a34, 1);
    post.fillRect(x - 2, y - 4, 4, 34);
    post.fillStyle(0xb23b2e, 1);
    post.fillTriangle(x - 16, y - 18, x + 16, y - 18, x, y - 30); // little red canopy
    // The rotating wheel body: a golden ribbed cylinder in a container we spin.
    const wheel = this.add.container(x, y - 2).setScrollFactor(0.6).setDepth(-6);
    const g = this.add.graphics();
    g.fillStyle(0xe8b93a, 1);
    g.fillRoundedRect(-11, -14, 22, 28, 5);
    g.fillStyle(0xc9971f, 1);
    for (let i = -9; i <= 9; i += 6) g.fillRect(i, -13, 2, 26); // vertical ribs
    g.fillStyle(0xd23b2e, 1);
    g.fillRect(-11, -3, 22, 6); // red band with mantra
    g.fillStyle(0xf3ecdc, 1);
    for (let i = -8; i <= 8; i += 4) g.fillRect(i, -1, 2, 2); // mantra ticks
    wheel.add(g);
    // Spin it (visually rotate via a repeating tween on the container's scaleX to fake
    // cylinder rotation cheaply, plus a slow angle wobble).
    this.tweens.add({ targets: wheel, scaleX: -1, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
  }

  private createPrayerFlags(): void {
    // Strings of traditional prayer flags (blue/white/red/green/yellow) draped between poles.
    const g = this.add.graphics().setScrollFactor(0.55).setDepth(-70);
    const colors = [0x2b6cff, 0xffffff, 0xe23b3b, 0x2fae5a, 0xf3c623];
    const cord = 0x6b5a3f;
    const strings = [350, 950, 1550, 2150, 2750, 3300];
    const baseY = WORLD_HEIGHT - 170;
    for (const sx of strings) {
      const span = 240;
      // Draped catenary-like curve using sampled points.
      const points: Array<[number, number]> = [];
      const segs = 14;
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const px = sx + t * span;
        const sag = Math.sin(t * Math.PI) * 26; // dips in the middle
        points.push([px, baseY + sag]);
      }
      g.lineStyle(2, cord, 0.85);
      g.beginPath();
      g.moveTo(points[0][0], points[0][1]);
      for (const [px, py] of points) g.lineTo(px, py);
      g.strokePath();
      // Hang a little flag at each interior point.
      for (let i = 1; i < segs; i++) {
        const [px, py] = points[i];
        g.fillStyle(colors[i % colors.length], 0.95);
        g.fillRect(px - 1, py, 11, 15);
      }
    }
  }

  // ===================== HIMAL (high snow) backdrop =====================

  /** Level 3 — big snow peaks up close, a glacier, and high prayer flags. No green. */
  private createHimalBackdrop(): void {
    const baseY = WORLD_HEIGHT * 0.66;
    const snow = 0xf3f8ff;
    const snowShade = 0xdcecfb;
    const rock = 0x8fa1b4;
    const rockShade = 0x6f8296;

    // Big, close snow peaks (mid layer) — taller and steeper than the hills range.
    const mid = this.add.graphics().setScrollFactor(0.14).setDepth(-90);
    const bigPeak = (px: number, w: number, h: number) => {
      const apexY = baseY - h;
      // Rock faces (lit + shadow).
      mid.fillStyle(rock, 1);
      mid.beginPath();
      mid.moveTo(px, apexY);
      mid.lineTo(px, baseY);
      mid.lineTo(px - w / 2, baseY);
      mid.closePath();
      mid.fillPath();
      mid.fillStyle(rockShade, 1);
      mid.beginPath();
      mid.moveTo(px, apexY);
      mid.lineTo(px + w / 2, baseY);
      mid.lineTo(px, baseY);
      mid.closePath();
      mid.fillPath();
      // Large snow cap (upper half — much snowier than the hills).
      const capY = apexY + h * 0.5;
      mid.fillStyle(snow, 1);
      mid.beginPath();
      mid.moveTo(px, apexY);
      mid.lineTo(px + w * 0.24, capY);
      mid.lineTo(px, capY);
      mid.closePath();
      mid.fillPath();
      mid.fillStyle(snowShade, 1);
      mid.beginPath();
      mid.moveTo(px, apexY);
      mid.lineTo(px - w * 0.24, capY);
      mid.lineTo(px, capY);
      mid.closePath();
      mid.fillPath();
      // Snow gullies streaking down the rock.
      mid.fillStyle(snow, 0.85);
      mid.fillTriangle(px, capY, px - w * 0.08, capY + h * 0.24, px + w * 0.03, capY + h * 0.16);
    };
    for (let x = 200, i = 0; x < this.worldWidth + 400; x += 620, i++) {
      bigPeak(x, 560 + (i % 2) * 120, 420 + (i % 3) * 60);
    }

    // A near GLACIER shelf of pale blue ice just above the ground.
    const glacier = this.add.graphics().setScrollFactor(0.5).setDepth(-72);
    const gy = WORLD_HEIGHT - GROUND_HEIGHT - 40;
    glacier.fillStyle(0xbfe0f5, 0.9);
    glacier.beginPath();
    glacier.moveTo(0, gy + 40);
    for (let x = 0; x <= this.worldWidth; x += 60) {
      glacier.lineTo(x, gy + Math.sin(x / 200) * 12);
    }
    glacier.lineTo(this.worldWidth, gy + 40);
    glacier.closePath();
    glacier.fillPath();
    // Ice crevasse hints (cool-blue cracks).
    glacier.fillStyle(0x9fd8ff, 0.7);
    for (let x = 120; x < this.worldWidth; x += 260) {
      glacier.fillRect(x, gy, 2, 30);
    }

    // High prayer flags strung across the thin-air pass (kept, they belong up here).
    const flags = this.add.graphics().setScrollFactor(0.55).setDepth(-70);
    const colors = [0x2b6cff, 0xffffff, 0xe23b3b, 0x2fae5a, 0xf3c623];
    const cord = 0x6b5a3f;
    const strings = [400, 1100, 1900, 2700, 3300];
    const flagBaseY = 120;
    for (const sx of strings) {
      const span = 260;
      const segs = 14;
      const points: Array<[number, number]> = [];
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        points.push([sx + t * span, flagBaseY + Math.sin(t * Math.PI) * 22]);
      }
      flags.lineStyle(2, cord, 0.85);
      flags.beginPath();
      flags.moveTo(points[0][0], points[0][1]);
      for (const [px, py] of points) flags.lineTo(px, py);
      flags.strokePath();
      for (let i = 1; i < segs; i++) {
        const [px, py] = points[i];
        flags.fillStyle(colors[i % colors.length], 0.95);
        flags.fillRect(px - 1, py, 11, 15);
      }
    }
  }

  private createClouds(): void {
    const positions = [
      { x: 200, y: 80 },
      { x: 700, y: 55 },
      { x: 1200, y: 100 },
      { x: 1800, y: 70 },
      { x: 2400, y: 95 },
      { x: 3000, y: 60 },
    ];
    for (const pos of positions) {
      const container = this.add.container(pos.x, pos.y);
      const puff = this.add.graphics();
      puff.fillStyle(0xffffff, 0.9);
      puff.fillCircle(0, 0, 24);
      puff.fillCircle(26, 6, 20);
      puff.fillCircle(-24, 8, 18);
      puff.fillCircle(4, -12, 16);
      container.add(puff);
      container.setScrollFactor(0.25).setDepth(-85);
      this.clouds.push(container);
    }
  }

  // --- gameplay builders (physics) ---

  /** Return the top of the highest traversable surface directly under world-x. */
  private surfaceTopAt(x: number, groundTop: number): number {
    let surfaceTop = groundTop;
    for (const platform of this.level.platforms) {
      const left = platform.x - platform.w / 2;
      const right = platform.x + platform.w / 2;
      if (x >= left && x <= right) {
        // Platform bodies are 22px tall and centered at groundTop + dy.
        surfaceTop = Math.min(surfaceTop, groundTop + platform.dy - 11);
      }
    }
    return surfaceTop;
  }

  private createGroundAndPlatforms(): Phaser.Physics.Arcade.StaticGroup {
    const platforms = this.physics.add.staticGroup();
    const groundTop = WORLD_HEIGHT - GROUND_HEIGHT;

    // A 1x1 transparent texture for invisible physics bodies (no missing-texture box).
    const SENSOR = '__transparent_sensor__';
    if (!this.textures.exists(SENSOR)) {
      const tg = this.add.graphics();
      tg.fillStyle(0x000000, 0);
      tg.fillRect(0, 0, 1, 1);
      tg.generateTexture(SENSOR, 1, 1);
      tg.destroy();
    }

    const groundG = this.add.graphics().setDepth(-10);
    groundG.fillStyle(this.palette.soil, 1);
    groundG.fillRect(0, groundTop, this.worldWidth, GROUND_HEIGHT);
    groundG.fillStyle(this.palette.groundGrass, 1);
    groundG.fillRect(0, groundTop, this.worldWidth, 10);
    groundG.fillStyle(this.palette.ground, 1);
    groundG.fillRect(0, groundTop + 10, this.worldWidth, 4);
    // Scatter little grass tufts + rhododendron shrubs along the ground.
    for (let x = 40; x < this.worldWidth; x += 90) {
      groundG.fillStyle(this.palette.groundGrass, 1);
      groundG.fillTriangle(x, groundTop, x + 4, groundTop - 7, x + 8, groundTop);
      if (x % 270 === 40 % 270) {
        groundG.fillStyle(0x2f7d4f, 1);
        groundG.fillCircle(x + 20, groundTop - 4, 5);
        groundG.fillStyle(this.palette.accent, 1);
        groundG.fillCircle(x + 20, groundTop - 8, 3);
      }
    }

    const ground = platforms.create(
      this.worldWidth / 2,
      groundTop + GROUND_HEIGHT / 2,
      SENSOR,
    ) as Phaser.Physics.Arcade.Sprite;
    ground.setVisible(false);
    // Set the DISPLAY size (stretches the 1x1 texture) then refreshBody() so the static
    // physics body matches. Using setSize+updateFromGameObject with a 1x1 texture left
    // the body at 1px, which made the Yatri fall straight through the floor.
    ground.setDisplaySize(this.worldWidth, GROUND_HEIGHT);
    ground.refreshBody();

    for (const l of this.level.platforms) {
      const y = groundTop + l.dy;
      const pg = this.add.graphics().setDepth(-10);
      // Terraced-ledge look: grassy/snowy top on an earthen block, per palette.
      pg.fillStyle(this.palette.platformBody, 1);
      pg.fillRoundedRect(l.x - l.w / 2, y - 12, l.w, 26, 4);
      pg.fillStyle(this.palette.platformTop, 1);
      pg.fillRoundedRect(l.x - l.w / 2, y - 12, l.w, 8, 4);

      const ledge = platforms.create(
        l.x,
        y,
        SENSOR,
      ) as Phaser.Physics.Arcade.Sprite;
      ledge.setVisible(false);
      ledge.setDisplaySize(l.w, 22);
      ledge.refreshBody();
    }
    return platforms;
  }

  private createMarker(x: number, groundTop: number, color: number, label: string): void {
    const g = this.add.graphics().setDepth(-5);
    g.fillStyle(0x9a8f7a, 1);
    g.fillRect(x, groundTop - 80, 4, 80);
    g.fillStyle(color, 1);
    g.fillTriangle(x + 4, groundTop - 80, x + 4, groundTop - 52, x + 40, groundTop - 66);
    this.add
      .text(x + 2, groundTop + 4, label, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '14px',
        color: '#10233b',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0)
      .setDepth(-5);
  }

  private createRouteGuidance(groundTop: number): void {
    const style = {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '13px',
      color: '#10233b',
      fontStyle: 'bold' as const,
      backgroundColor: 'rgba(255,255,255,0.72)',
      padding: { x: 7, y: 4 },
    };
    this.add
      .text(205, groundTop - 22, 'LOWER TRAIL  →', style)
      .setOrigin(0.5, 1)
      .setDepth(-4);

    const first = this.level.platforms[0];
    if (first) {
      const platformTop = groundTop + first.dy - 11;
      this.add
        .text(first.x - 44, platformTop - 10, 'HIGH TRAIL  ↑', style)
        .setOrigin(0.5, 1)
        .setDepth(-4);
    }
  }

  private createEndPennant(x: number, groundTop: number): void {
    // The END goal: a planted Nepal-flag-shaped double pennant with a glow.
    const flagPole = 0x9a8f7a;
    const flagBlue = 0x003893;
    const flagCrimson = 0xdc143c;
    const g = this.add.graphics().setDepth(-5);
    const beacon = this.add
      .circle(x + 22, groundTop - 70, 34, this.palette.accent, 0.16)
      .setDepth(-6);
    this.tweens.add({
      targets: beacon,
      alpha: 0.04,
      scale: 1.35,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });
    g.fillStyle(flagPole, 1);
    g.fillRect(x, groundTop - 120, 4, 120);
    const drawPennant = (topY: number, height: number) => {
      const width = 48;
      g.fillStyle(flagBlue, 1);
      g.beginPath();
      g.moveTo(x + 4, topY);
      g.lineTo(x + 4 + width + 5, topY + height * 0.5);
      g.lineTo(x + 4, topY + height);
      g.closePath();
      g.fillPath();
      g.fillStyle(flagCrimson, 1);
      g.beginPath();
      g.moveTo(x + 7, topY + 4);
      g.lineTo(x + 4 + width, topY + height * 0.5);
      g.lineTo(x + 7, topY + height - 4);
      g.closePath();
      g.fillPath();
      g.fillStyle(0xffffff, 0.9);
      g.fillCircle(x + 14, topY + height * 0.5, 1.8);
    };
    drawPennant(groundTop - 118, 38);
    drawPennant(groundTop - 82, 44);
    this.add
      .text(x + 2, groundTop + 4, 'END', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '14px',
        color: '#10233b',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0)
      .setDepth(-5);
  }
}
