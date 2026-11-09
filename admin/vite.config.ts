import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/admin/',
  plugins: [preact()],
  build: { outDir: '../public/admin', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5173, strictPort: true,
    proxy: { '/api': 'http://localhost:3000', '/assets': 'http://localhost:3000', '/blobs': 'http://localhost:3000' } },
});
