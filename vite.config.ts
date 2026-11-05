import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';

export default defineConfig({
  plugins: [
    react(),
    svgr(),
  ],
  worker: {
    format: 'es',
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  clearScreen: false,
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 10000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@xyflow/react') || id.includes('dagre')) {
            return 'inheritance';
          }
          if (id.includes('monaco-editor')) {
            return 'monaco';
          }
        },
      },
    },
  },
});