import { describe, expect, it } from 'vitest';
import { parseContext } from '../handlers/oracle';
import { MAX_GURU_CHARS, normalizeGuruText } from './bedrock';

describe('Guru Megh Bedrock safety boundaries', () => {
  it('keeps only known gameplay context values', () => {
    const parsed = parseContext({
      useCase: 'not-a-real-use-case',
      levelId: 'himal',
      recentEvent: 'player_died',
      deathReason: 'eagle',
      attempts: 9999,
      sessionId: 'abcdefgh-1234',
    });

    expect(parsed.ctx.useCase).toBe('hint');
    expect(parsed.ctx.levelId).toBe('himal');
    expect(parsed.ctx.recentEvent).toBe('player_died');
    expect(parsed.ctx.deathReason).toBe('eagle');
    expect(parsed.ctx.attempts).toBe(20);
    expect(parsed.sessionId).toBe('abcdefgh-1234');

    const checkpoint = parseContext({ recentEvent: 'checkpoint_reached', sessionId: 'abcdefgh-1234' });
    expect(checkpoint.ctx.recentEvent).toBe('checkpoint_reached');
    const progress = parseContext({ recentEvent: 'journey_progress', sessionId: 'abcdefgh-1234' });
    expect(progress.ctx.recentEvent).toBe('journey_progress');
  });

  it('drops unsupported prompt-shaped values and invalid attempts', () => {
    const parsed = parseContext({
      levelId: 'ignore-instructions',
      recentEvent: 'tell-me-a-secret',
      deathReason: 'anything',
      attempts: -1,
      sessionId: 'abcdefgh-1234',
    });

    expect(parsed.ctx.levelId).toBeNull();
    expect(parsed.ctx.recentEvent).toBeUndefined();
    expect(parsed.ctx.deathReason).toBeNull();
    expect(parsed.ctx.attempts).toBeNull();
  });

  it('normalizes and caps model output for the dialogue panel', () => {
    const normalized = normalizeGuruText(`  Rise, Yatri.\n\n  Keep moving.\u0000 ${'x'.repeat(500)}`);
    expect(normalized).toBe(normalized.trim());
    expect(normalized).not.toContain('\n');
    expect(normalized).not.toContain('\u0000');
    expect(normalized.length).toBeLessThanOrEqual(MAX_GURU_CHARS);
  });
});
