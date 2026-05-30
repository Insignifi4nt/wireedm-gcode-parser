import { defineConfig } from 'vite';

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
  base: '/wireedm-gcode-parser/'
});
