import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web', base: '/app/', plugins: [react()],
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
});
