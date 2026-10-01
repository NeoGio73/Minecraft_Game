import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// base './' is required: D2L Brightspace serves uploaded course files from a
// deep subfolder such as /content/enforced/<orgunit>-<code>/orgocraft/, so
// every asset reference must be relative to index.html.
export default defineConfig({
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    assetsDir: 'assets',
    // One bundle (three + chemistry + content) is the intended shape (08 §8.1); no manualChunks.
    chunkSizeWarningLimit: 1500,
  },
  server: { port: 5173, strictPort: false },
});
