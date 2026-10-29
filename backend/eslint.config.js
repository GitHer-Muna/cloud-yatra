// Flat ESLint config for the Cloud Yatra backend (Cloudflare Worker, ESLint 9 +
// typescript-eslint). Mirrors the game's config: recommended TypeScript rules, with the
// project's deliberate patterns allowed. Lints src/ only; the Worker's console use is
// intentional (structured logging goes through the logger, but a few guarded spots use
// console) so no-console is a warning, not an error.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'dist/**', '.wrangler/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'warn',
    },
  },
  {
    // The logger IS the Worker's log transport: writing structured JSON to console is how
    // Cloudflare Workers Logs ingests it. Console use here is intentional and required.
    files: ['src/logger.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // Tests use `any` freely for fixtures/stubs and are not shipped. Relax there.
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
