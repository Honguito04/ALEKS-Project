import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

export function bridgeOrigin(value = process.env.BRIDGE_WEB_ORIGIN || '', allowLocal = process.env.BRIDGE_ALLOW_LOCAL === 'true') {
  if (!value) return '';
  const invalid = () => new Error('BRIDGE_WEB_ORIGIN debe ser un origen HTTPS exacto, sin ruta, credenciales, parámetros ni comodines. Para pruebas locales usa http://127.0.0.1:8000 y BRIDGE_ALLOW_LOCAL=true.');
  if (value !== value.trim() || !/^https?:\/\/[^\s/?#\\]+\/?$/.test(value)) throw invalid();
  let url: URL;
  try { url = new URL(value); } catch { throw invalid(); }
  if (url.username || url.password || value.includes('@') || url.hostname.includes('*')) throw invalid();
  if (url.protocol !== 'https:' && !(allowLocal && url.origin === 'http://127.0.0.1:8000')) throw invalid();
  return url.origin;
}

export default defineConfig(() => {
  const origin = bridgeOrigin();
  return {
  root: 'extension', publicDir: 'public', plugins: [react(), {
    name: 'configured-web-bridge',
    writeBundle() {
      if (!origin) return;
      const manifestPath = resolve('dist/manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      manifest.externally_connectable = { matches: [`${origin}/*`] };
      manifest.optional_host_permissions = [...new Set([...manifest.optional_host_permissions, `${origin}/*`])];
      manifest.content_security_policy.extension_pages += ` ${origin}`;
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    }
  }],
  define: { __BRIDGE_WEB_ORIGIN__: JSON.stringify(origin) },
  build: { outDir: '../dist', emptyOutDir: true, rollupOptions: {
    input: { panel: resolve('extension/panel.html'), options: resolve('extension/options.html'), background: resolve('extension/src/background.ts') },
    output: { entryFileNames: '[name].js' }
  } }
  };
});
