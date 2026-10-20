import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({ build: {
  outDir: 'dist', emptyOutDir: false,
  lib: { entry: resolve('extension/src/content.ts'), name: 'MathAssistantContent', formats: ['iife'], fileName: () => 'content.js' }
} });
