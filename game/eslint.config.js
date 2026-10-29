// Flat ESLint config for the Cloud Yatra game (ESLint 9 + typescript-eslint).
//
// Goal: catch real bugs and enforce consistency without fighting the existing, deliberately
// clean codebase. We use the recommended TypeScript rules, allow the few pragmatic patterns
// this project uses on purpose (void-returning fire-and-forget calls, intentional unused
// catch bindings), and lint only source — build output, deps, and tests' own globals are
// handled separately.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Never lint generated or vendored output.
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
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
      // Allow intentionally-unused args/vars when prefixed with _ (common for callbacks),
      // and never error on an empty catch binding (the codebase uses `catch {}` on purpose
      // for best-effort, non-throwing side effects like clipboard writes).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // Phaser + DOM interop sometimes needs a pragmatic cast; keep this a warning, not a
      // hard error, so it surfaces without blocking the build on necessary interop.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Fire-and-forget telemetry/network calls are intentionally not awaited (guarded,
      // offline-safe). `void expr` already documents intent at the call sites.
      '@typescript-eslint/no-floating-promises': 'off',
      // Flag stray console use. The telemetry layer has a couple of DELIBERATE console
      // calls (a dev ConsoleSink + a dropped-event warning) that carry inline
      // `eslint-disable-next-line no-console`; this rule makes those directives meaningful
      // and catches any accidental console.log left elsewhere.
      'no-console': 'warn',
    },
  },
);
