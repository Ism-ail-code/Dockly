import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: path.join(root, 'src', 'renderer'),
  base: './',
  resolve: {
    alias: {
      '@': path.join(root, 'src', 'renderer'),
      '@shared': path.join(root, 'src', 'shared'),
    },
  },
  build: {
    outDir: path.join(root, 'dist', 'renderer'),
    emptyOutDir: true,
    target: 'chrome138',
    rollupOptions: {
      input: {
        main: path.join(root, 'src', 'renderer', 'index.html'),
        dock: path.join(root, 'src', 'renderer', 'dock.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
