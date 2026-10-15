/** Explicit isolated acceptance adapter. Used ONLY by vitest.config.ts here. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OpenCascadeInstance } from 'replicad-opencascadejs';

const directory = process.env.CAD_NATIVE_CANDIDATE_ROOT;
if (!directory) throw new Error('Candidate validation requires CAD_NATIVE_CANDIDATE_ROOT.');
const factory = (await import(pathToFileURL(resolve(directory, 'replicad_single.js')).href)).default as
  (options: Record<string, unknown>) => Promise<OpenCascadeInstance>;
const wasmBinary = await readFile(resolve(directory, 'replicad_single.wasm'));
export default async function initializeCandidate(options: Record<string, unknown> = {}) {
  return factory({ ...options, wasmBinary });
}
