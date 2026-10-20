/**
 * apply-migrations.ts — test helper that applies the real D1 migrations to the in-memory
 * test database before each suite, using the migrations bundled into the env by
 * vitest.config.ts (TEST_MIGRATIONS) and the pool's applyD1Migrations helper.
 */
import { applyD1Migrations, env } from 'cloudflare:test';

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    TEST_MIGRATIONS: D1Migration[];
  }
}

export async function migrate(): Promise<void> {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
}
