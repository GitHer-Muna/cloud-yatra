/**
 * NepaliAudio.ts — 100% ORIGINAL, procedurally-synthesised audio for Cloud Yatra.
 *
 * There are NO audio files anywhere in this project (see CREDITS.md): every sound is
 * generated live in the browser with the Web Audio API. The music is an ORIGINAL,
 * anthem-style theme for the fictional kingdom "Himal Rajya" — a proud, march-like
 * melody (NOT Nepal's real national anthem, which we must never copy) over Nepali-folk
 * instrumentation:
 *   - A MADAL-like hand-drum groove (a low "dhaa" + a high "tin"), the backbone of
 *     Nepali folk rhythm.
 *   - The anthem melody drawn from a PENTATONIC scale (the mode most Nepali folk tunes
 *     use), phrased like a bansuri (bamboo flute) line.
 *   - A soft drone (tanpura-like) underneath for warmth.
 *
 * SFX (jump, collect, slash, stomp, damage, complete, bell) are short synth blips in the
 * same scale so everything feels of a piece.
 *
 * DESIGN NOTES:
 *   - Notes are scheduled ahead on the AudioContext clock, so timing is rock-solid and
 *     independent of the game frame rate.
 *   - Browsers require a user gesture before audio can start; call `resume()` from a
 *     click/keypress (the scenes do this) and `start()` to begin the loop.
 *   - `setMuted()` toggles a master gain without stopping the scheduler (cheap).
 */

type SfxName = 'jump' | 'collect' | 'slash' | 'stomp' | 'damage' | 'complete' | 'bell';

/** The three regions of Nepal; each gets its own musical character. */
export type AudioRegion = 'terai' | 'hills' | 'himal';

// A D-major pentatonic scale (D E F# A B) across two octaves — a bright, folk-friendly
// set of pitches (the mode most Nepali folk melodies use). Frequencies in Hz.
const SCALE_HZ = [
  146.83, 164.81, 185.0, 220.0, 246.94, // D3 E3 F#3 A3 B3
  293.66, 329.63, 369.99, 440.0, 493.88, // D4 E4 F#4 A4 B4
  587.33, // D5
];

/**
 * Each region gets a DISTINCT musical character so the three geographic zones of Nepal
 * feel different as you climb — all from the same pentatonic scale so they stay of a
 * piece (no jarring key change), but with different phrasing, tempo, timbre and rhythm:
 *
 *   - TERAI (lowland jungle): relaxed and warm. A lower, rounded flute phrase over a
 *     steady madal groove — the unhurried feel of the plains.
 *   - HILLS (terraced valley): the bright, lilting "signature" folk tune — a touch
 *     quicker, mid-register, the most tune-forward of the three.
 *   - HIMAL (high Himalaya): sparse and airy. Slower, higher/thinner phrasing with more
 *     rests and a quieter drum — the stillness and thin air of altitude.
 *
 * `melody` holds indices into SCALE_HZ; `-1` is a REST (silence on that step). `rest`
 * lists extra grid steps to silence for space. `octave` shifts the flute up/down.
 */
interface RegionMusic {
  bpm: number;
  melody: number[];
  fluteType: OscillatorType;
  octave: number; // multiply flute freq (0.5 = down an octave, 2 = up)
  restSteps: number[]; // 16-grid steps where the flute is silent (breathing room)
  drumGain: number; // relative madal loudness for this region
  droneType: OscillatorType;
}

/**
 * THE THEME OF HIMAL RAJYA — an ORIGINAL, anthem-style patriotic melody.
 *
 * IMPORTANT (originality + cultural respect rules): this is NOT Nepal's real national
 * anthem ("Sayaun Thunga Phool Ka"), which is an official state composition we must never
 * copy or re-arrange. Instead this is a brand-new, original march-like theme written for
 * the fictional cloud-kingdom "Himal Rajya". It is phrased to FEEL ceremonial/national —
 * a proud, stepwise climb that resolves firmly to the tonic (the classic anthem cadence)
 * — while staying in the same D pentatonic scale as the rest of the game's audio so it
 * sits naturally with the SFX. All three regions share this ONE recognisable theme (so
 * it reads as the kingdom's anthem throughout the climb) and differ only in tempo,
 * timbre and octave. 100% original — see CREDITS.md.
 *
 * Scale index reference: 0=D3 1=E3 2=F#3 3=A3 4=B3 5=D4 6=E4 7=F#4 8=A4 9=B4 10=D5.
 */
// The shared anthem phrase: a dignified rise to the octave (D5) and a proud resolution
// back down to the tonic — continuous (few rests), the way an anthem is sung.
const ANTHEM_THEME = [5, 5, 6, 7, 8, 8, 7, 6, 7, 9, 10, 9, 8, 6, 5, 5];

const REGION_MUSIC: Record<AudioRegion, RegionMusic> = {
  // Terai (lowlands): the anthem stated warmly, an octave down, at a stately march pace.
  terai: {
    bpm: 84,
    melody: ANTHEM_THEME,
    fluteType: 'triangle',
    octave: 0.5,
    restSteps: [],
    drumGain: 1.0,
    droneType: 'sine',
  },
  // Hills (valley): the anthem at full voice, mid-register — the proudest statement.
  hills: {
    bpm: 92,
    melody: ANTHEM_THEME,
    fluteType: 'triangle',
    octave: 1,
    restSteps: [],
    drumGain: 0.95,
    droneType: 'sine',
  },
  // Himal (summit): the same anthem, higher and more spacious — stately in the thin air.
  himal: {
    bpm: 76,
    melody: ANTHEM_THEME,
    fluteType: 'sine',
    octave: 1,
    restSteps: [7, 15],
    drumGain: 0.6,
    droneType: 'triangle',
  },
};

export class NepaliAudio {
  private ctx?: AudioContext;
  private master?: GainNode;
  private musicGain?: GainNode;
  private muted = false;
  private started = false;
  private schedulerTimer?: number;
  private nextNoteTime = 0;
  private step = 0;
  private region: AudioRegion = 'hills';
  private get music(): RegionMusic {
    return REGION_MUSIC[this.region];
  }
  private droneOsc?: OscillatorNode;

  /**
   * Switch the musical region. Each region has its own melody, tempo, timbre and rhythm
   * so the three zones of Nepal sound distinct as the player climbs. Safe to call at any
   * time (including before start()); if music is already playing it re-tunes the drone
   * immediately and the new phrasing takes effect on the next scheduled steps.
   */
  setRegion(region: AudioRegion): void {
    if (region === this.region) return;
    this.region = region;
    // Re-voice the drone to the new region's timbre if it is running.
    if (this.started && this.ctx && this.musicGain && this.droneOsc) {
      this.droneOsc.type = this.music.droneType;
    }
  }

  /** Lazily create the AudioContext (must follow a user gesture on most browsers). */
  private ensureCtx(): AudioContext | undefined {
    if (this.ctx) return this.ctx;
    try {
      const w = window as unknown as {
        AudioContext?: typeof AudioContext;
        webkitAudioContext?: typeof AudioContext;
      };
      const Ctor = w.AudioContext || w.webkitAudioContext;
      if (!Ctor) return undefined;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.5;
      this.musicGain.connect(this.master);
    } catch {
      return undefined;
    }
    return this.ctx;
  }

  /** Resume the context after a user gesture (safe to call repeatedly). */
  resume(): void {
    const ctx = this.ensureCtx();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** Toggle mute; returns the new muted state. */
  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.02);
    }
  }

  /** Begin the looping background music (idempotent). */
  start(): void {
    const ctx = this.ensureCtx();
    if (!ctx || this.started) return;
    this.started = true;
    this.nextNoteTime = ctx.currentTime + 0.1;
    this.step = 0;
    this.startDrone();
    this.scheduler();
  }

  /** Stop music + free the drone. Music can be restarted later via start(). */
  stop(): void {
    if (this.schedulerTimer !== undefined) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = undefined;
    }
    if (this.droneOsc) {
      try {
        this.droneOsc.stop();
      } catch {
        /* already stopped */
      }
      this.droneOsc = undefined;
    }
    this.started = false;
  }

  // --- background music scheduling ---

  /** A soft continuous drone (tanpura-like) on the low tonic for warmth. */
  private startDrone(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain) return;
    const osc = ctx.createOscillator();
    osc.type = this.music.droneType;
    osc.frequency.value = SCALE_HZ[0] / 2; // low tonic
    const g = ctx.createGain();
    g.gain.value = 0.06;
    osc.connect(g);
    g.connect(this.musicGain);
    osc.start();
    this.droneOsc = osc;
  }

  /**
   * Look ahead ~0.2s and schedule any notes that fall in that window. Runs on a cheap
   * interval; all actual timing is on the audio clock so it never drifts with FPS.
   */
  private scheduler(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.schedulerTimer = window.setInterval(() => {
      if (!this.ctx) return;
      const beat = 60 / this.music.bpm; // seconds per beat (region tempo, read live)
      const stepDur = beat / 2; // eighth-note grid
      while (this.nextNoteTime < this.ctx.currentTime + 0.2) {
        this.scheduleStep(this.step, this.nextNoteTime, stepDur);
        this.nextNoteTime += stepDur;
        this.step = (this.step + 1) % 16;
      }
    }, 60);
  }

  /** One eighth-note grid step: madal drum groove + a melody note on most steps. */
  private scheduleStep(step: number, t: number, stepDur: number): void {
    const m = this.music;
    // Madal groove — scaled per region (quieter, sparser high in the Himal).
    if (step % 4 === 0) this.drum(t, 'low', m.drumGain);
    else if (step % 2 === 0) this.drum(t, 'high', m.drumGain);
    if ((step === 6 || step === 10 || step === 14) && this.region !== 'himal') {
      this.drum(t, 'high', m.drumGain);
    }

    // Region melody: -1 is a rest; explicit restSteps also stay silent for breathing room.
    if (m.restSteps.includes(step % 16)) return;
    const idx = m.melody[step % m.melody.length];
    if (idx < 0) return; // rest note
    this.flute(SCALE_HZ[idx] * m.octave, t, stepDur * 0.95, m.fluteType);
  }

  /** A membrane-drum hit (short pitched thump with a fast decay). `level` scales loudness. */
  private drum(t: number, tone: 'low' | 'high', level = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const f0 = tone === 'low' ? 130 : 260;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.5, t + 0.12);
    const peak = (tone === 'low' ? 0.5 : 0.3) * level;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    osc.connect(g);
    g.connect(this.musicGain);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  /** A soft flute-like tone (region timbre + gentle attack/decay). */
  private flute(freq: number, t: number, dur: number, type: OscillatorType = 'triangle'): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    // A tiny grace bend up into the note for a breathy, folky feel.
    osc.frequency.setValueAtTime(freq * 0.98, t);
    osc.frequency.linearRampToValueAtTime(freq, t + 0.04);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.musicGain);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // --- SFX ---

  /** Play a short sound effect. Safe to call before start() (auto-inits the context). */
  play(name: SfxName): void {
    const ctx = this.ensureCtx();
    if (!ctx || !this.master || this.muted) return;
    const t = ctx.currentTime;
    switch (name) {
      case 'jump':
        this.blip('square', SCALE_HZ[5], SCALE_HZ[8], t, 0.16, 0.16);
        break;
      case 'collect':
        this.blip('triangle', SCALE_HZ[6], SCALE_HZ[9], t, 0.12, 0.2);
        break;
      case 'bell':
        this.blip('sine', SCALE_HZ[8], SCALE_HZ[10], t, 0.35, 0.22);
        this.blip('sine', SCALE_HZ[10], SCALE_HZ[10], t + 0.08, 0.4, 0.16);
        break;
      case 'slash':
        this.swish(t);
        break;
      case 'stomp':
        this.blip('square', SCALE_HZ[9], SCALE_HZ[4], t, 0.18, 0.24);
        this.drumHitMaster(t, 220);
        break;
      case 'damage':
        this.blip('sawtooth', SCALE_HZ[4], SCALE_HZ[0], t, 0.3, 0.28);
        break;
      case 'complete':
        [5, 6, 8, 9, 10].forEach((i, k) =>
          this.blip('triangle', SCALE_HZ[i], SCALE_HZ[i], t + k * 0.11, 0.22, 0.22),
        );
        break;
    }
  }

  /** A pitched blip that glides from f0→f1 with a fast envelope. */
  private blip(
    type: OscillatorType,
    f0: number,
    f1: number,
    t: number,
    dur: number,
    peak: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  /** A short filtered-noise "swish" for the khukuri slash. */
  private swish(t: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const dur = 0.18;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const env = 1 - i / data.length;
      data[i] = (Math.random() * 2 - 1) * env * env;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2600, t);
    bp.frequency.exponentialRampToValueAtTime(700, t + dur);
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.value = 0.35;
    src.connect(bp);
    bp.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur);
  }

  /** A drum thump routed to master (gives the stomp weight). */
  private drumHitMaster(t: number, f0: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.5, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.16);
  }
}
