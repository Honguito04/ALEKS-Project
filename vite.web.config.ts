import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { reticle } from '@reticlehq/vite-plugin';

export default defineConfig(({ command }) => ({
  root: 'web', base: '/app/', plugins: [react(), ...(command === 'serve' && process.env.RETICLE_ENABLED === 'true'
    ? [reticle({ projectId: 'asistente-matematico-c20e1b26', root: process.cwd(), captureNetworkBodies: false })] : [])],
  build: { outDir: '../web-dist', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5174, strictPort: true,
    proxy: { '/web-api': { target: 'http://127.0.0.1:8000', changeOrigin: true,
      configure(proxy) {
        proxy.on('proxyReq', (request, incoming) => {
          if (['http://127.0.0.1:5174', 'http://localhost:5174'].includes(incoming.headers.origin || '')) {
            request.setHeader('origin', 'http://127.0.0.1:8000');
          }
        });
      },
    } } },
}));
