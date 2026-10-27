// Second pass of `npm run solver:corpus`: asks PlaneGCS alone for the outcome of every input the
// first pass recorded, checks that native compiles each as PlaneGCS does, and writes the corpus
// (`--update`) or checks that it holds every input with the same outcome (`--check`). Records no
// longer recorded are kept: each one still compares native with PlaneGCS on its own.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import type { CadSketchSolveInput } from '../../cadSketchSolverTypes';
import { parseCadSketchSolveInput } from '../../cadSketchSolverProtocol';
import { compileCadSketchPlaneGcs, createCadSketchSolverRuntime } from '../../cadSketchSolverRuntime';
import { initializeCadSketchSolverModule } from '../../cadSketchSolverModule';
import { compileCadSketchEquations } from '../compileCadSketchEquations';
import { planeGcsEquations, planeGcsValues } from './planeGcsEquations';
import {
  PLANEGCS_CORPUS_FORMAT, corpusInput, corpusModelHash, corpusOutcome, decodeCorpusJson, encodeCorpusJson, planeGcsCorpusDirectory, readPlaneGcsCorpus,
  type PlaneGcsCorpusManifest, type PlaneGcsCorpusOutcome, type PlaneGcsCorpusRecord
} from '../../__tests__/planeGcsCorpus';

const require = createRequire(import.meta.url);
const planeGcsPackage = require.resolve('@salusoft89/planegcs/package.json');

/** The native model's hash when native compiles the input as PlaneGCS does; throws when they differ. */
function compiledModel(input: CadSketchSolveInput): string | null {
  let planeGcs: ReturnType<typeof compileCadSketchPlaneGcs> | undefined, nativeError: unknown;
  try { planeGcs = compileCadSketchPlaneGcs(input); } catch { /* compared below */ }
  let model: ReturnType<typeof compileCadSketchEquations> | undefined;
  try { model = compileCadSketchEquations(input); } catch (error) { nativeError = error; }
  if (!model) { if (planeGcs) throw new Error(`native compilation failed where PlaneGCS compiles: ${String(nativeError)}`); return null; }
  if (!planeGcs) throw new Error('native compilation accepted input that PlaneGCS rejects');
  if (JSON.stringify(planeGcsEquations(planeGcs, model)) !== JSON.stringify(model.equations)) throw new Error('equations differ from PlaneGCS restated');
  if (JSON.stringify(planeGcsValues(planeGcs, model)) !== JSON.stringify(model.values)) throw new Error('parameter values differ from PlaneGCS');
  return corpusModelHash(model);
}

it('records PlaneGCS\'s outcome for every captured sketch solve input', async () => {
  const mode = process.env.PLANEGCS_CORPUS_MODE, shards = process.env.PLANEGCS_CORPUS_SHARDS!;
  if (mode !== 'update' && mode !== 'check') throw new Error('PLANEGCS_CORPUS_MODE must be update or check.');
  const captured = new Map<string, { input: CadSketchSolveInput; provenance: Set<string> }>(), graphs = new Map<string, string>();
  for (const file of readdirSync(shards).filter(name => name.endsWith('.jsonl')).sort()) {
    for (const line of readFileSync(join(shards, file), 'utf8').split('\n').filter(Boolean)) {
      const { provenance, input } = decodeCorpusJson(line) as { provenance: string; input: CadSketchSolveInput };
      const stored = corpusInput(input);
      // The stored form must solve as captured: parsing it again changes nothing.
      if (corpusInput(parseCadSketchSolveInput(input)).hash !== stored.hash) throw new Error(`Input from ${provenance} does not parse to itself.`);
      graphs.set(stored.graphHash, stored.graph);
      const entry = captured.get(stored.hash) ?? { input, provenance: new Set<string>() };
      entry.provenance.add(provenance);
      captured.set(stored.hash, entry);
    }
  }
  expect(captured.size).toBeGreaterThan(0);
  const planeGcs = createCadSketchSolverRuntime(() => initializeCadSketchSolverModule(pathToFileURL(require.resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm')).href));
  const problems: string[] = [], built = new Map<string, string>();
  for (const [hash, { input, provenance }] of [...captured].sort(([a], [b]) => a < b ? -1 : 1)) {
    const names = [...provenance].sort();
    let model: string | null;
    try { model = compiledModel(input); } catch (error) { problems.push(`${names[0]}: ${error instanceof Error ? error.message : String(error)}`); continue; }
    let outcome: PlaneGcsCorpusOutcome;
    try { outcome = corpusOutcome(await planeGcs.solve(input)); } catch (error) { outcome = { kind: 'threw', message: error instanceof Error ? error.message : String(error) }; }
    const { graphHash } = corpusInput(input);
    const record: PlaneGcsCorpusRecord = { hash, provenance: names, graph: graphHash, parameters: input.parameters, ...input.drag ? { drag: input.drag } : {}, model, outcome };
    built.set(hash, encodeCorpusJson(record));
  }
  expect(problems).toEqual([]);

  const existing = existsSync(new URL('records.jsonl', planeGcsCorpusDirectory)) ? readPlaneGcsCorpus() : undefined;
  const kept = new Map(existing?.records.map(({ record }) => [record.hash, encodeCorpusJson(record)]) ?? []);
  const keptGraphs = new Map(existing?.records.map(({ record, input }) => [record.graph, encodeCorpusJson(input.graph)]) ?? []);
  if (mode === 'check') {
    const missing = [...built.keys()].filter(hash => !kept.has(hash)), changed = [...built].filter(([hash, line]) => kept.has(hash) && kept.get(hash) !== line).map(([hash]) => hash);
    expect({ missing, changed }, 'run npm run solver:corpus -- --update').toEqual({ missing: [], changed: [] });
    return;
  }
  const records = new Map([...kept, ...built]), allGraphs = new Map([...keptGraphs, ...graphs]);
  const used = new Set([...records.values()].map(line => (decodeCorpusJson(line) as PlaneGcsCorpusRecord).graph));
  const table = Object.fromEntries([...allGraphs].filter(([hash]) => used.has(hash)).sort(([a], [b]) => a < b ? -1 : 1).map(([hash, graph]) => [hash, decodeCorpusJson(graph)]));
  mkdirSync(planeGcsCorpusDirectory, { recursive: true });
  writeFileSync(new URL('records.jsonl', planeGcsCorpusDirectory), [...records].sort(([a], [b]) => a < b ? -1 : 1).map(([, line]) => `${line}\n`).join(''));
  writeFileSync(new URL('graphs.json.gz', planeGcsCorpusDirectory), gzipSync(encodeCorpusJson(table), { level: 9 }));
  const manifest: PlaneGcsCorpusManifest = { format: PLANEGCS_CORPUS_FORMAT, records: records.size, graphs: Object.keys(table).length,
    planeGcs: (JSON.parse(readFileSync(planeGcsPackage, 'utf8')) as { version: string }).version,
    nativeModuleSha256: createHash('sha256').update(readFileSync(new URL('../../../../../../packages/sketch-solver/wasm/sketch_solver.wasm', import.meta.url))).digest('hex') };
  writeFileSync(new URL('manifest.json', planeGcsCorpusDirectory), `${JSON.stringify(manifest, null, 2)}\n`);
  readPlaneGcsCorpus();
});
