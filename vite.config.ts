import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({
  root: 'extension', publicDir: 'public', plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true, rollupOptions: {
    input: { panel: resolve('extension/panel.html'), options: resolve('extension/options.html'), background: resolve('extension/src/background.ts') },
    output: { entryFileNames: '[name].js' }
  } }
});
