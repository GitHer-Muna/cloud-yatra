import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker, { __resetStatsCache } from '../src/index';
import { __resetPublicApi } from '../src/publicApi';
import { migrate } from './apply-migrations';

async function call(method: string, path: string, ip = '1.1.1.1'): Promise<Response> {
  const req = new Request('https://api.test' + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: method === 'POST' ? '{}' : undefined,
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

beforeEach(async () => {
  await migrate();
  __resetStatsCache();
  __resetPublicApi();
  await env.DB.prepare('DELETE FROM scores').run();
});

describe('/public read-only API', () => {
  it('serves stats, pulse and chaos routes with cache headers', async () => {
    for (const p of ['stats', 'pulse', 'chaos/status', 'chaos/events']) {
      const res = await call('GET', `/open/${p}`);
      expect(res.status, p).toBe(200);
      expect(res.headers.get('Cache-Control')).toContain('max-age=30');
    }
  });

  it('leaderboard has no player names', async () => {
    await call('POST', '/score');
    await env.DB.prepare(
      `INSERT INTO scores (name_key, name, score, created_at, updated_at) VALUES ('asha','Asha',500,1,1)`,
    ).run();
    const res = await call('GET', '/open/leaderboard');
    const text = await res.text();
    expect(text).not.toContain('Asha');
    expect(JSON.parse(text).entries[0]).toMatchObject({ rank: 1, score: 500 });
  });

  it('rejects writes and unknown paths', async () => {
    for (const m of ['POST', 'PUT', 'DELETE']) {
      expect((await call(m, '/open/stats')).status).toBe(405);
    }
    expect((await call('GET', '/open/nope')).status).toBe(404);
  });

  it('rate limits a single client', async () => {
    let last = 200;
    for (let i = 0; i < 62; i++) last = (await call('GET', '/open/pulse', '9.9.9.9')).status;
    expect(last).toBe(429);
    expect((await call('GET', '/open/pulse', '8.8.8.8')).status).toBe(200);
  });
});
