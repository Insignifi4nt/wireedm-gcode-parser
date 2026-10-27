// Runs a TypeScript script bundled by Vite, as the application is built, instead of through tsx,
// whose transform keeps every function's name with a wrapper call that inflates measured times.
// Dependencies stay external. The bundle is written beside its entry, so the entry's
// `import.meta.url` paths resolve as they do from source, and removed after the run.
// Usage: node scripts/run-bundled.mjs scripts/benchmark-cad.ts [script arguments]
import { rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

const [entryArgument, ...scriptArguments] = process.argv.slice(2);
if (!entryArgument?.endsWith('.ts')) {
  console.error('Usage: node scripts/run-bundled.mjs <script.ts> [script arguments]');
  process.exit(1);
}
const root = fileURLToPath(new URL('..', import.meta.url));
const entry = resolve(entryArgument), outDir = dirname(entry);
const fileName = `.${basename(entry, '.ts')}.${process.pid}.bundled.mjs`;
await build({
  configFile: false, root, logLevel: 'warn',
  resolve: { alias: { '@': resolve(root, 'src') } },
  build: {
    ssr: entry, outDir, emptyOutDir: false, write: true, minify: false, sourcemap: false, copyPublicDir: false,
    rollupOptions: { output: { entryFileNames: fileName, format: 'es', codeSplitting: false } }
  }
});
const bundle = resolve(outDir, fileName);
process.argv = [process.argv[0], entry, ...scriptArguments];
try { await import(pathToFileURL(bundle).href); }
finally { await rm(bundle, { force: true }); }
