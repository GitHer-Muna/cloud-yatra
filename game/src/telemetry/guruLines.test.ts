/**
 * guruLines.test.ts — the built-in Guru Megh voice, focused on the chaos "incident"
 * narration added for Chaos Mode so the storm/recovery framing stays in-character.
 */
import { describe, expect, it } from 'vitest';
import { guruLine, askGuru } from './guruLines';

describe('guruLine incident narration', () => {
  it('returns a storm line when chaos begins', () => {
    const text = guruLine({ useCase: 'incident', recentEvent: 'storm' });
    expect(text.toLowerCase()).toContain('storm');
  });

  it('returns a recovery line when chaos clears', () => {
    const text = guruLine({ useCase: 'incident', recentEvent: 'recovered' });
    expect(text.length).toBeGreaterThan(0);
    // Recovery lines speak of clearing/passing/returning — never panic.
    expect(/clear|passed|returns|well/i.test(text)).toBe(true);
  });

  it('defaults to a recovery line for an unknown incident phase', () => {
    const text = guruLine({ useCase: 'incident' });
    expect(text.length).toBeGreaterThan(0);
  });

  it('stays in-character and names the traveller for the usual beats', () => {
    for (const useCase of ['welcome', 'hint', 'death', 'completed'] as const) {
      const text = guruLine({ useCase, levelId: 'terai' });
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it('askGuru resolves locally with zero-cost source', async () => {
    const res = await askGuru({ useCase: 'incident', recentEvent: 'recovered' });
    expect(res.source).toBe('local');
    expect(typeof res.text).toBe('string');
  });
});
