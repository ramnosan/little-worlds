import { defineConfig } from 'vite';

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/little-worlds/' : '/',
  // Playwright traces contain HTML; writing them must not reload the app under test.
  server: {
    watch: { ignored: ['**/artifacts/**', '**/test-results/**', '**/playwright-report/**'] },
  },
  build: { rollupOptions: { output: { manualChunks: { three: ['three'] } } } },
}));
