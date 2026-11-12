/**
 * guruLines.ts — Cloud Yatra's built-in, zero-network Guru Megh voice.
 *
 * Guru Megh is intentionally a bounded guide, not a chatbot. Keeping these lines in the
 * browser preserves the zero-per-play-cost deployment while still
 * making guidance moments feel contextual and original.
 */
export type GuruUseCase = 'welcome' | 'hint' | 'death' | 'completed' | 'celebrate' | 'incident';

export interface GuruAsk {
  useCase: GuruUseCase;
  levelId?: string | null;
  recentEvent?: string;
  deathReason?: string | null;
}

export interface GuruResponse {
  text: string;
  source: 'local';
  latencyMs: number;
}

const WELCOME: Record<string, string[]> = {
  terai: [
    'Namaste, Yatri! I am Guru Megh, the cloud-sage. The Terai is warm and green; follow the pennants north toward the END flag.',
    'Swagatam, traveller. Gather the sayapatri blooms, watch the sal forest, and keep moving. I will cheer you on.',
  ],
  hills: [
    'Welcome to the Pahad, Yatri. Rice terraces climb these hills like stairs to the sky. Your feet are sure, so onward!',
    'The middle hills greet you with prayer flags and temple bells. Bistarai, bistarai: step by step, the summit nears.',
  ],
  himal: [
    'The high Himal at last! Sagarmatha watches over this land. The air is thin, but your spirit is strong.',
    'Snow and bright peaks surround you now. This is the final climb, and Guru Megh believes in you.',
  ],
};

const HINTS: Record<string, string[]> = {
  terai: [
    'Watch the drifting mist, slash the tangles with your khukuri, and keep walking toward the next pennant.',
    'Gather the marigolds, called sayapatri here. Every twelve blooms make a garland, as at Tihar.',
    'Did you know? The one-horned rhino roams these Terai grasslands. Tread lightly, Yatri.',
  ],
  hills: [
    'Plant the pennants as you climb and keep your eyes on the END flag.',
    'Mind the eagles and falling stones. Patience, then courage.',
    'Lali gurans, the red rhododendron, is the national flower of Nepal. These hills blaze with it in spring.',
  ],
  himal: [
    'Breathe, step, breathe again. The prayer flags at the summit are waiting.',
    'Collect the blue poppies and let each one warm your resolve. Almost there!',
    'Dal bhat power, twenty-four hour! The porters say it, and it carries them to the top.',
  ],
};

const DEATHS = [
  'A stumble is not the end of a yatra, traveller. Rise and begin again; Guru Megh is here.',
  'The mountain humbles us so we may climb wiser. Return to the trail with courage.',
  'Aattinu hunna, Yatri: do not lose heart. Even the high peaks were climbed one step at a time.',
];

const COMPLETIONS = [
  'Shabash, Yatri! One region crossed with grace. Rest a breath, then take the next trail north.',
  'Beautifully done, traveller. Carry this courage forward into the next region.',
];

const CELEBRATIONS: Record<string, string[]> = {
  garland_completed: ['A full mala of blooms! May its blessing shield you onward, brave traveller.'],
  found_prayer_bell: ['A prayer bell rings for you! The mountain itself blesses your path.'],
  combo_streak: ['What a dazzling streak! Keep that rhythm, traveller.'],
  checkpoint_reached: ['The pennant flies! Should you stumble, you will rise again right here.'],
  eagle_defeated: ['A clean strike! The high road is open. What courage!'],
};

const GENERAL_CHEERS = [
  'Shabash, Yatri! Every small triumph lights the trail ahead.',
  'Ramro! Beautifully done, traveller. Guru Megh rejoices with you. Onward!',
];

// Chaos Mode narration: a cloud-sage framing of a backend "storm" (injected latency and
// errors) and its clearing. `recentEvent` selects the phase: 'storm' when it begins,
// 'recovered' when the skies clear.
const INCIDENTS: Record<string, string[]> = {
  storm: [
    'A storm gathers over the cloud-kingdom, Yatri. The messengers run slow. Walk on; it will pass.',
    'The mountain winds are wild just now; our cloud-paths falter. Keep your rhythm and hold steady.',
  ],
  recovered: [
    'The storm has passed, traveller. The cloud-paths run clear again, and the messengers fly swift.',
    'Blue sky returns over Himal Rajya. All is well once more. Onward with a calm heart, Yatri.',
  ],
};

function pick(lines: string[]): string {
  return lines[Math.floor(Math.random() * lines.length)] ?? lines[0] ?? 'Keep going, Yatri.';
}

export function guruLine(ask: GuruAsk): string {
  const region = ask.levelId ?? 'terai';
  switch (ask.useCase) {
    case 'welcome':
      return pick(WELCOME[region] ?? WELCOME.terai);
    case 'hint':
      return pick(HINTS[region] ?? HINTS.terai);
    case 'death':
      return pick(DEATHS);
    case 'completed':
      return pick(COMPLETIONS);
    case 'celebrate':
      return pick(CELEBRATIONS[ask.recentEvent ?? ''] ?? GENERAL_CHEERS);
    case 'incident':
      return pick(INCIDENTS[ask.recentEvent ?? 'recovered'] ?? INCIDENTS.recovered);
  }
}

export async function askGuru(ask: GuruAsk): Promise<GuruResponse> {
  const startedAt = Date.now();
  return { text: guruLine(ask), source: 'local', latencyMs: Date.now() - startedAt };
}
