import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * UI du Superviseur.
 * - `bun run dev` : Vite sur 5173, /api proxé vers le daemon (5180).
 * - `bun run build` : build statique dans ui/dist, servi par le daemon.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:5180',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
