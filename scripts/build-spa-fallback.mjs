import { copyFile } from 'node:fs/promises';

// GitHub Pages serves this document for deep routes. Emitted asset URLs already
// use Vite's absolute deployment base, so no URL rewrite or redirect is needed.
await copyFile(new URL('../dist/index.html', import.meta.url), new URL('../dist/404.html', import.meta.url));
