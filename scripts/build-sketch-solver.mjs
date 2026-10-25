#!/usr/bin/env node
// Builds the Rust sketch solver to WebAssembly and records its hash. `--check` runs the Rust
// tests, rebuilds and fails unless the committed module and manifest match byte for byte.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const crate = resolve(import.meta.dirname, '../packages/sketch-solver');
const built = join(crate, 'target/wasm32-unknown-unknown/release/sketch_solver.wasm');
const committed = join(crate, 'wasm/sketch_solver.wasm'), manifestPath = join(crate, 'wasm/manifest.json');
const check = process.argv.includes('--check');
const toolchain = /channel\s*=\s*"([^"]+)"/.exec(readFileSync(join(crate, 'rust-toolchain.toml'), 'utf8'))?.[1];
if (!toolchain) throw new Error('rust-toolchain.toml has no pinned channel.');

const cargoHome = join(homedir(), '.cargo', 'bin');
const env = { ...process.env, PATH: existsSync(cargoHome) ? `${cargoHome}${delimiter}${process.env.PATH}` : process.env.PATH,
  // Panic locations embed source paths; Windows spells them `src\x.rs`, so match other hosts.
  RUSTFLAGS: `--remap-path-prefix=${crate}=sketch-solver --remap-path-prefix=src\\=src/` };
if (check) execFileSync('cargo', ['test', '--release', '--locked'], { cwd: crate, env: { ...env, RUSTFLAGS: '' }, stdio: 'inherit' });
execFileSync('cargo', ['build', '--release', '--locked', '--target', 'wasm32-unknown-unknown'], { cwd: crate, env, stdio: 'inherit' });

const bytes = readFileSync(built), sha256 = createHash('sha256').update(bytes).digest('hex');
const manifest = `${JSON.stringify({ file: 'sketch_solver.wasm', bytes: bytes.length, sha256, toolchain }, null, 2)}\n`;
if (check) {
  const problems = [];
  if (!existsSync(committed) || !readFileSync(committed).equals(bytes)) problems.push('wasm/sketch_solver.wasm differs from a fresh build.');
  if (!existsSync(manifestPath) || readFileSync(manifestPath, 'utf8') !== manifest) problems.push('wasm/manifest.json differs from a fresh build.');
  if (problems.length) {
    console.error(`${problems.join('\n')}\nFresh build: ${bytes.length} bytes, sha256 ${sha256}. Run npm run solver:build and commit the result.`);
    process.exit(1);
  }
  console.log(`Sketch solver module matches its source (${bytes.length} bytes, sha256 ${sha256}).`);
} else {
  writeFileSync(committed, bytes);
  writeFileSync(manifestPath, manifest);
  console.log(`Wrote packages/sketch-solver/wasm/sketch_solver.wasm (${bytes.length} bytes, sha256 ${sha256}).`);
}
