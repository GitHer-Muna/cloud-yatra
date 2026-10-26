import { defineConfig } from 'vite';

// Vite config for the Cloud Yatra game client.
// - server.host: true lets GitHub Codespaces forward the dev port to your browser.
// - base: './' makes the production build use relative paths so it works on static
//   hosts (Cloudflare Pages) regardless of sub-path.
export default defineConfig({
  base: './',
  server: {
    host: true,
    port: 5173,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Phaser is a single ~1.2 MB engine that can't be meaningfully sub-split; it's isolated
    // in its own long-cached vendor chunk below. Raise the warning limit just above it so
    // the build log stays clean — app code (the chunk that actually changes) stays well
    // under the default 500 KB and is reported honestly.
    chunkSizeWarningLimit: 1300,
    rollupOptions: {
      output: {
        // Split the large Phaser engine into its own chunk. It changes far less often than
        // our game code, so browsers can cache it across deploys, and it separates the
        // slow-changing vendor engine from our fast-changing app code.
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
  },
});
