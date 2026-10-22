/**
 * vitest.config.ts — runs backend tests inside the real workerd runtime via
 * @cloudflare/vitest-pool-workers, with the D1 migrations applied to an in-memory DB.
 */
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';
import path from 'node:path';

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, 'migrations'));
  return {
    test: {
      poolOptions: {
        workers: {
          singleWorker: true,
          miniflare: {
            compatibilityDate: '2024-11-01',
            compatibilityFlags: ['nodejs_compat'],
            d1Databases: { DB: 'cloud-yatra-test' },
            bindings: {
              TEST_MIGRATIONS: migrations,
              ALLOWED_ORIGINS: '*',
              ENVIRONMENT: 'test',
              SERVICE_NAME: 'cloud-yatra-api',
              CHAOS_ADMIN_TOKEN: 'test-admin-token',
            },
          },
          wrangler: { configPath: './wrangler.toml' },
        },
      },
    },
  };
});
