import { defineConfig } from 'vite';

// Vite config for the Cloud Yatra game client.
// - server.host: true lets GitHub Codespaces forward the dev port to your browser.
// - base: './' makes the production build use relative paths so it works on static
//   hosts (S3/CloudFront) regardless of sub-path.
export default defineConfig({
  base: './',
  server: {
    host: true,
    port: 5173,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
