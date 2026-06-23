import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5183,
    strictPort: true,
    proxy: {
      // Proxy API calls to the backend during development.
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
});
