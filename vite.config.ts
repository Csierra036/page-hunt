import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { pageHuntApi } from './server/plugin';

export default defineConfig({
  plugins: [pageHuntApi()],
  // Render (and similar hosts) proxy requests with their own hostname.
  preview: { allowedHosts: ['.onrender.com'] },
  build: {
    rollupOptions: {
      // The game and the developer-owned test page used by the "DOM real" mode.
      input: { main: resolve(__dirname, 'index.html'), demo: resolve(__dirname, 'demo/index.html') },
    },
  },
  test: { include: ['tests/unit/**/*.test.ts'] },
});
