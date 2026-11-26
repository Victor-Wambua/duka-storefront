/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Emits sw.js with the list of built files to precache, so the shell and catalogue work offline. */
function serviceWorker(): Plugin {
  return {
    name: 'duka-service-worker',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const urls = ['./', ...files, 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon.svg'];
      const version = createHash('sha256').update(files.join('|')).digest('hex').slice(0, 10);
      const src = readFileSync(new URL('./sw/sw.js', import.meta.url), 'utf8')
        .replaceAll('__PRECACHE__', JSON.stringify(urls))
        .replaceAll('__VERSION__', version);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
    },
  };
}

export default defineConfig({
  base: process.env.BASE_PATH ?? '/duka-storefront/',
  plugins: [react(), serviceWorker()],
  build: { target: 'es2022', sourcemap: false },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    css: false,
  },
});
