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
  },
  server: { port: 5173, strictPort: false },
});
