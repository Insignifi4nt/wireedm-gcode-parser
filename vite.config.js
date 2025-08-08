import { defineConfig } from 'vite';
import legacy from '@vitejs/plugin-legacy';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: './index.html'
      }
    },
    target: 'es2015',
    minify: 'terser'
  },
  server: {
    port: 3000,
    open: true,
    host: 'localhost'
  },
  preview: {
    port: 4173,
    open: true
  },
  plugins: [
    legacy({
      targets: ['defaults', 'not IE 11']
    })
  ],
  esbuild: {
    target: 'es2015'
  }
});