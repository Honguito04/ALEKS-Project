import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { reticle } from '@reticlehq/vite-plugin';
export default defineConfig({
  root: 'extension', publicDir: 'public', plugins: [reticle(), react()],
  build: { outDir: '../dist', emptyOutDir: true, rollupOptions: {
    input: { panel: resolve('extension/panel.html'), options: resolve('extension/options.html'), background: resolve('extension/src/background.ts') },
    output: { entryFileNames: '[name].js' }
  } }
});
