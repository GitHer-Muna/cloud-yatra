/**
 * oracleClient.ts — asks the backend Guru Megh (Bedrock) for a short in-character line.
 *
 * Privacy-safe: sends only a bounded context (useCase, levelId, recentEvent, deathReason,
 * attempts) + the anonymous sessionId. Never blocks gameplay: returns a local fallback
 * on any error/timeout so the dialogue always shows something.
 */

export interface OracleAsk {
  useCase: 'welcome' | 'death' | 'completed' | 'hint' | 'celebrate';
  sessionId: string;
  levelId?: string | null;
  recentEvent?: string;
  deathReason?: string | null;
  attempts?: number | null;
}

/**
 * Local Guru Megh voice — used whenever no backend is configured (and as the resilient
 * fallback on any error/timeout). Guru Megh is the CLOUD-SAGE GUIDE of Himal Rajya: a
 * kind mentor who walks the whole journey with Yatri, naming the region, pointing the
 * way, and — above all — encouraging. Lines are grouped by situation and by region so
 * the sage feels present and motivating across Terai → Hills → Himal, not repetitive.
 *
 * Each pool is a small set we pick from at random so repeated moments stay fresh without
 * any network cost.
 */
type Region = 'terai' | 'hills' | 'himal';

// Spoken on entering each region — establishes WHO Guru Megh is and encourages onward.
const WELCOME_BY_REGION: Record<Region, string[]> = {
  terai: [
    'Namaste, Yatri. I am Guru Megh, the cloud-sage — I will walk this whole journey with you. We begin in the warm Terai jungle. Follow the pennants toward the END flag; I am with you.',
    'Welcome, traveller. I am Guru Megh, your guide in the clouds. The Terai is lush but watchful — keep moving, collect the blooms, and I will cheer you onward.',
  ],
  hills: [
    'You have climbed into the middle hills, Yatri. I am still here, Guru Megh, watching over you. The terraces are steep but your feet are sure — onward to the next pennant.',
    'The hills welcome you, brave traveller. I, Guru Megh, am proud already. Breathe the cool air and keep climbing — the summit is nearer than you think.',
  ],
  himal: [
    'The high Himalaya at last, Yatri! I am Guru Megh, and I have not left your side. The air is thin and the snow bright — one final ascent. I believe in you.',
    'You stand among the great peaks now, traveller. Guru Megh walks beside you still. This is the last climb — carry your courage to the summit.',
  ],
};

// Encouragement / guidance during play — the sage keeps motivating throughout.
const HINT_BY_REGION: Record<Region, string[]> = {
  terai: [
    'Steady, Yatri. Watch the drifting mist, slash the tangles with your khukuri, and keep walking toward the next pennant. You are doing well.',
    'The jungle tests you gently. Gather the marigold blooms for a garland and press on — I am proud of every step.',
    'A monkey paces the trail ahead; time your passing. Keep heart, traveller — the path is yours.',
  ],
  hills: [
    'Climb on, Yatri. Each terrace you pass is a small victory. Plant the pennants and keep your eyes on the END flag.',
    'The rhododendrons bloom red for you here — gather them and let their blessing lift you. Onward, brave one.',
    'Mind the eagles on the high route and the falling stones. Patience, then courage. I am with you.',
  ],
  himal: [
    'The summit calls, Yatri. Do not fear the thin air — your spirit is strong. Keep climbing; I am right beside you.',
    'Snow and ice cannot stop a true traveller. Collect the blue poppies and let each one warm your resolve. Almost there!',
    'So close now. Breathe, step, breathe again. The prayer flags at the top are waiting to fly for you.',
  ],
};

// A warm word after a fall — never scolding, always lifting Yatri back up.
const DEATH_LINES: string[] = [
  'Even the river falls before it flows onward. Rise, Yatri — your pennant marks the way back. I still believe in you.',
  'A stumble is not the end of a journey, traveller. Breathe, stand, and begin again. I am here, and I am patient.',
  'The mountain humbles us so we may climb wiser. Take heart and return to the trail — I will guide you still.',
];

// Spoken on finishing a region (not the final summit) — proud, motivating onward.
const COMPLETED_LINES: string[] = [
  'One region crossed with grace, Yatri! I am proud of you. Rest a breath, then follow the next trail toward the summit.',
  'Beautifully done, traveller. Guru Megh smiles upon you. The next region awaits — carry this courage forward.',
  'You honour the journey. One step closer to the roof of Himal Rajya — onward, and I am with you.',
];

// Joyful CHEERS for the bright little victories along the way. Keyed by the moment that
// triggered them (recentEvent) so each celebration fits what the traveller just achieved,
// with a warm general pool as a fallback. Guru Megh is at his most delighted here.
const CELEBRATE_BY_EVENT: Record<string, string[]> = {
  garland_completed: [
    'A full garland of blooms, Yatri! I can hardly contain my joy — wear it with pride, and may its blessing shield you onward!',
    'Hurray! A complete mala! The flowers you gathered now guard your life. Magnificent work, my brave traveller!',
  ],
  found_prayer_bell: [
    'A prayer bell rings for you, Yatri! Hear it — the mountain itself blesses your path. Wonderful!',
    'Listen! The sacred bell! Fortune smiles on you today, traveller. Carry its blessing high!',
  ],
  combo_streak: [
    'What a dazzling streak, Yatri! Bloom after bloom — your hands move like a dancer. I am cheering for you!',
    'Incredible! The flowers leap into your garland! Keep that rhythm, traveller — it is a joy to behold!',
  ],
  checkpoint_reached: [
    'The pennant flies, Yatri! Your flag snaps proud in the mountain wind — this ground is yours now. Splendid!',
    'Planted and true! Should you stumble, you will rise again right here. Well done, brave traveller — onward!',
  ],
  eagle_defeated: [
    'A clean strike, Yatri! The eagle yields the sky to you. What courage — I am thrilled!',
    'Ha! You bested the mountain eagle! The high road is open. Bravo, traveller!',
  ],
};
const CELEBRATE_GENERAL: string[] = [
  'Wonderful, Yatri! Every small triumph lights the trail ahead. I am cheering you on!',
  'Yes! That is the spirit of a true pilgrim. Guru Megh rejoices with you — onward!',
  'Beautifully done, traveller! Moments like this are why the mountain smiles. Keep going!',
];

function pick(pool: string[]): string {
  return pool[Math.floor(Math.random() * pool.length)] ?? pool[0];
}

function localVoice(ask: OracleAsk): string {
  const region = (ask.levelId as Region) ?? 'terai';
  switch (ask.useCase) {
    case 'welcome':
      return pick(WELCOME_BY_REGION[region] ?? WELCOME_BY_REGION.terai);
    case 'hint':
      return pick(HINT_BY_REGION[region] ?? HINT_BY_REGION.terai);
    case 'death':
      return pick(DEATH_LINES);
    case 'completed':
      return pick(COMPLETED_LINES);
    case 'celebrate': {
      const pool = CELEBRATE_BY_EVENT[ask.recentEvent ?? ''] ?? CELEBRATE_GENERAL;
      return pick(pool);
    }
    default:
      return pick(HINT_BY_REGION.terai);
  }
}

export type OracleSource = 'bedrock' | 'fallback';

export interface OracleResponse {
  text: string;
  source: OracleSource;
  latencyMs: number;
}

function fallbackResponse(text: string, startedAt: number, source: OracleSource = 'fallback'): OracleResponse {
  return { text, source, latencyMs: Math.max(0, Date.now() - startedAt) };
}

export async function askOracle(
  base: string,
  ask: OracleAsk,
  timeoutMs = 6000,
): Promise<OracleResponse> {
  const startedAt = Date.now();
  const fallback = localVoice(ask);
  if (!base) return fallbackResponse(fallback, startedAt);


  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // /oracle is a normal API path (not blocked); still keep it resilient.
    const res = await fetch(`${base.replace(/\/$/, '')}/oracle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ask),
      signal: controller.signal,
    });
    if (!res.ok) return fallbackResponse(fallback, startedAt);
    const data = (await res.json()) as { text?: string; source?: OracleSource };
    const text = data.text?.trim();
    if (!text) return fallbackResponse(fallback, startedAt);
    const source: OracleSource = data.source === 'bedrock' ? 'bedrock' : 'fallback';
    return {
      text,
      source,
      latencyMs: Math.max(0, Date.now() - startedAt),
    };
  } catch {
    return fallbackResponse(fallback, startedAt);
  } finally {
    clearTimeout(timer);
  }
}
