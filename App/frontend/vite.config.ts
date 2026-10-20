import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The Express backend (backend/, PORT 3000 by default) serves everything under /api.
// With VITE_USE_MOCKS=true the mock service worker answers /api first and the proxy is unused.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
