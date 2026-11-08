import { defineConfig } from 'vite';
import { reticle } from '@reticlehq/vite-plugin';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { projectId } = JSON.parse(readFileSync('.reticle.json', 'utf8'));

export default defineConfig({
  root: resolve('backend/simulator'),
  base: '/simulator/',
  plugins: [reticle({ projectId, root: resolve('.'), captureNetworkBodies: true })],
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true, cors: false,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000', changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (request, incoming) => {
            // Solo los orígenes locales del simulador se traducen al backend.
            if (['http://127.0.0.1:5173', 'http://localhost:5173'].includes(incoming.headers.origin || '')) {
              request.setHeader('origin', 'http://127.0.0.1:8000');
            }
          });
        }
      }
    }
  }
});
