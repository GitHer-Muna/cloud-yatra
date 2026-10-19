import { describe, expect, it, vi } from 'vitest';
import type { Faro } from '@grafana/faro-web-sdk';
import type { TelemetryEvent } from './events';
import { FaroSink } from './sinks';

function event(type: TelemetryEvent['type'], attrs: Record<string, unknown>): TelemetryEvent {
  return {
    schemaVersion: 1,
    type,
    sessionId: 'session-12345678',
    levelId: 'himal',
    ts: 1,
    tMs: 2,
    playerId: null,
    correlationId: null,
    attrs: attrs as TelemetryEvent['attrs'],
  };
}

describe('FaroSink', () => {
  it('uses the gameplay domain for custom events', () => {
    const faro = { api: { pushEvent: vi.fn(), pushMeasurement: vi.fn() } } as unknown as Faro;
    const sink = new FaroSink(faro);

    sink.emit(event('journey_progress', { progressPct: 40, bucket: 4, score: 120 }));

    expect(faro.api.pushEvent).toHaveBeenCalledWith(
      'journey_progress',
      expect.objectContaining({ level: 'himal', progressPct: '40', bucket: '4' }),
      'gameplay',
    );
  });

  it('forwards FPS and heartbeat state as bounded measurements', () => {
    const faro = { api: { pushEvent: vi.fn(), pushMeasurement: vi.fn() } } as unknown as Faro;
    const sink = new FaroSink(faro);

    sink.emit(event('client_perf', { avgFps: 58 }));
    sink.emit(
      event('session_heartbeat', {
        uptimeMs: 15000,
        score: 240,
        progressPct: 40,
        lives: 2,
        combo: 3,
      }),
    );

    expect(faro.api.pushMeasurement).toHaveBeenNthCalledWith(
      1,
      { type: 'game_client_perf', values: { fps: 58 } },
      { context: { level: 'himal' } },
    );
    expect(faro.api.pushMeasurement).toHaveBeenNthCalledWith(
      2,
      {
        type: 'game_state',
        values: { uptimeMs: 15000, score: 240, progressPct: 40, lives: 2, combo: 3 },
      },
      { context: { level: 'himal' } },
    );
  });
});
