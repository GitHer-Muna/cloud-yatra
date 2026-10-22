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
    'Namaste, Yatri. I am Guru Megh, the cloud-sage. Follow the pennants through the warm Terai jungle toward the END flag.',
    'Welcome, traveller. Gather the blooms, watch the trail, and keep moving—I will cheer you onward.',
  ],
  hills: [
    'You have climbed into the middle hills, Yatri. The terraces are steep, but your feet are sure—onward to the next pennant.',
    'The hills welcome you, brave traveller. Keep climbing; the summit is nearer than you think.',
  ],
  himal: [
    'The high Himalaya at last! The air is thin, but your spirit is strong. Carry your courage to the summit.',
    'Snow and bright peaks surround you now. This is the final climb—Guru Megh believes in you.',
  ],
};

const HINTS: Record<string, string[]> = {
  terai: [
    'Watch the drifting mist, slash the tangles with your khukuri, and keep walking toward the next pennant.',
    'Gather the marigold blooms for a garland and keep your eyes on the trail ahead.',
  ],
  hills: [
    'Plant the pennants as you climb and keep your eyes on the END flag.',
    'Mind the eagles and falling stones. Patience, then courage.',
  ],
  himal: [
    'Breathe, step, breathe again. The prayer flags at the summit are waiting.',
    'Collect the blue poppies and let each one warm your resolve. Almost there!',
  ],
};

const DEATHS = [
  'A stumble is not the end of a journey, traveller. Rise and begin again; Guru Megh is here.',
  'The mountain humbles us so we may climb wiser. Return to the trail with courage.',
];

const COMPLETIONS = [
  'One region crossed with grace, Yatri! Rest a breath, then follow the next trail toward the summit.',
  'Beautifully done, traveller. Carry this courage forward into the next region.',
];

const CELEBRATIONS: Record<string, string[]> = {
  garland_completed: ['A full garland of blooms! May its blessing shield you onward, brave traveller.'],
  found_prayer_bell: ['A prayer bell rings for you! The mountain itself blesses your path.'],
  combo_streak: ['What a dazzling streak! Keep that rhythm, traveller.'],
  checkpoint_reached: ['The pennant flies! Should you stumble, you will rise again right here.'],
  eagle_defeated: ['A clean strike! The high road is open—what courage!'],
};

const GENERAL_CHEERS = [
  'Wonderful, Yatri! Every small triumph lights the trail ahead.',
  'Beautifully done, traveller. Guru Megh rejoices with you—onward!',
];

// Chaos Mode narration: a cloud-sage framing of a backend "storm" (injected latency and
// errors) and its clearing. `recentEvent` selects the phase: 'storm' when it begins,
// 'recovered' when the skies clear.
const INCIDENTS: Record<string, string[]> = {
  storm: [
    'A storm gathers over the cloud-kingdom, Yatri—the messengers run slow. Walk on; it will pass.',
    'The mountain winds are wild just now; our cloud-paths falter. Keep your rhythm—hold steady.',
  ],
  recovered: [
    'The storm has passed, traveller. The cloud-paths run clear again, and the messengers fly swift.',
    'Blue sky returns over Himal Rajya. All is well once more—onward with a calm heart, Yatri.',
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
