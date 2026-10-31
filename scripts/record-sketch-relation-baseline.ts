// Records the relation baseline fixture that src/features/cad/sketch-relations/__tests__/cadSketchRelationBaseline.test.ts replays: what
// the per-kind switches gave for every relation before the shared definitions replaced them. Run it only in a snapshot of the source
// commit the fixture's manifest names, never on the current code, whose outputs the fixture exists to check. The manifest next to the
// fixture gives the inputs, normalization and steps.
//
// Usage, from the snapshot's root:
//   node scripts/run-bundled.mjs scripts/record-sketch-relation-baseline.ts --capture <dir> [--out <file>]
//   node scripts/run-bundled.mjs scripts/record-sketch-relation-baseline.ts --graphs <fixture.json.gz> [--out <file>]
// --capture reads the graphs scripts/record-sketch-relation-baseline.capture.patch wrote while the Vitest suite ran, with the solver
// corpus; --graphs re-records the graphs of an existing fixture, which are normalized already. The fixture is written to --out, by
// default over the committed one, and its counts and hashes are printed for the manifest.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { parseCadSketchGraph, type CadSketchGraph, type CadSketchGraphRelation } from '../src/domain/cad/cadSketchGraph';
import { cadSketchRelationEntityIds, cadSketchRelationPointIds, mapCadSketchRelationScalars } from '../src/domain/cad/cadSketchGraphReferences';
import { cadSketchRelationDescription, cadSketchRelationName, cadSketchRelationOperandLabels, createCadSketchRelationLabels } from '../src/features/cad/cadSketchRelationNames';
import { cadSketchRelationGlyphEntries, cadSketchRelationGlyphKind } from '../src/features/cad/cadSketchRelationGlyphLayout';
import { decodeCorpusJson } from '../src/features/cad/sketch-solver/__tests__/planeGcsCorpus';

const args = process.argv.slice(2), option = (name: string) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const capture = option('--capture'), from = option('--graphs');
const out = option('--out') ?? fileURLToPath(new URL('../src/features/cad/sketch-relations/__tests__/fixtures/relation-baseline.json.gz', import.meta.url));
if (!capture === !from) throw new Error('Give exactly one of --capture <dir> and --graphs <fixture.json.gz>.');

const samePoints = (ids: readonly string[], pair: readonly [string, string]) => ids.length === 2 && ids.includes(pair[0]) && ids.includes(pair[1]);
// Verbatim copy of cadSketchConstraintTool.ts sameRelation at the source commit, the check the tool made for an existing relation.
function sameRelation(a: CadSketchGraphRelation, b: CadSketchGraphRelation): boolean {
  if ('pointId' in a && 'pointId' in b && a.pointId !== b.pointId) return false;
  if ('lineId' in a && 'lineId' in b && a.lineId !== b.lineId) return false;
  if ('curveId' in a && 'curveId' in b && a.curveId !== b.curveId) return false;
  if (a.kind === 'tangent-joint' && b.kind === 'tangent-joint') return a.endpoints.every(endpoint => b.endpoints.some(other => other.entityId === endpoint.entityId && other.pointId === endpoint.pointId));
  if ('pointIds' in b) return 'pointIds' in a && samePoints(a.pointIds, b.pointIds as readonly [string, string]);
  if ('lineIds' in b) return 'lineIds' in a && samePoints(a.lineIds, b.lineIds as readonly [string, string]);
  if ('curveIds' in b) return 'curveIds' in a && samePoints(a.curveIds, b.curveIds as readonly [string, string]);
  return 'pointId' in b;
}
// The kinds the constraint tool checked for an existing relation before adding one.
const DEDUPE_KINDS = new Set(['coincident', 'horizontal', 'vertical', 'parallel', 'perpendicular', 'point-on-line', 'point-on-curve', 'tangent-joint', 'equal-length', 'equal-radius', 'midpoint', 'symmetric']);
const outcome = (run: () => unknown) => { try { return { ok: run() }; } catch (error) { return { throws: error instanceof Error ? `${(error as { code?: string }).code ?? error.name}: ${error.message}` : String(error) }; } };
const topology = (graph: unknown) => createHash('sha256').update(JSON.stringify(graph)).digest('hex');
/** Numeric coordinates read by nothing recorded here are stored as 0; expressions are kept. */
const compact = (graph: CadSketchGraph) => ({ ...graph, points: graph.points.map(point => ({ id: point.id, position: point.position.map(value => typeof value === 'number' ? 0 : value) })) });

// Each such relation's group stored in reverse, and its second operand, or single point, replaced by the first other one of the graph.
function swapped(relation: CadSketchGraphRelation): CadSketchGraphRelation | null {
  const r = relation as Record<string, unknown>;
  for (const field of ['pointIds', 'lineIds', 'curveIds', 'endpoints']) if (Array.isArray(r[field])) return { ...relation, [field]: [...(r[field] as unknown[])].reverse() } as CadSketchGraphRelation;
  return null;
}
function replaced(graph: CadSketchGraph, relation: CadSketchGraphRelation): CadSketchGraphRelation | null {
  const r = relation as Record<string, unknown>, points = graph.points.map(point => point.id), entities = graph.entities.map(entity => entity.id);
  const other = (pool: readonly string[], not: readonly string[]) => pool.find(id => !not.includes(id));
  for (const field of ['pointIds', 'lineIds', 'curveIds']) if (Array.isArray(r[field])) {
    const ids = r[field] as string[], next = other(field === 'pointIds' ? points : entities, ids);
    return next ? { ...relation, [field]: [ids[0], next] } as CadSketchGraphRelation : null;
  }
  if (typeof r.pointId === 'string') { const next = other(points, [r.pointId]); return next ? { ...relation, pointId: next } as CadSketchGraphRelation : null; }
  return null;
}

type Path = readonly (string | number)[];
// Every id a relation names: `…Id` strings, `…Ids` items and the ids nested in its other objects, such as rays and endpoints.
function idPaths(value: unknown, path: Path = []): Path[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => typeof item === 'string' ? [[...path, index]] : idPaths(item, [...path, index]));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, item]) => key === 'id' || key === 'kind' ? [] : typeof item === 'string' && key.endsWith('Id') ? [[...path, key]]
    : Array.isArray(item) && key.endsWith('Ids') ? item.map((_, index) => [...path, key, index]) : typeof item === 'object' ? idPaths(item, [...path, key]) : []);
}
function setAt(value: unknown, path: Path, next: string): unknown {
  if (!path.length) return next;
  const [head, ...rest] = path;
  if (Array.isArray(value)) return value.map((item, index) => index === head ? setAt(item, rest, next) : item);
  return { ...(value as object), [head]: setAt((value as Record<string, unknown>)[head as string], rest, next) };
}
const getAt = (value: unknown, path: Path): unknown => path.reduce<unknown>((at, key) => (at as Record<string | number, unknown>)[key], value);

// Inputs: each graph read back through the parser with numeric coordinates set to 0, kept once, with between 1 and 300 relations.
const graphs = new Map<string, CadSketchGraph>(), read = { inputs: 0, refused: 0, outside: 0, repeated: 0 };
const add = (value: unknown) => {
  read.inputs++;
  let graph: CadSketchGraph;
  try { graph = parseCadSketchGraph(compact(parseCadSketchGraph(value))); } catch { read.refused++; return; }
  if (!graph.relations.length || graph.relations.length > 300) { read.outside++; return; }
  const hash = topology(graph);
  if (graphs.has(hash)) read.repeated++;
  else graphs.set(hash, graph);
};
if (capture) {
  for (const file of readdirSync(capture).filter(name => name.endsWith('.jsonl')).sort()) {
    for (const line of readFileSync(`${capture}/${file}`, 'utf8').split('\n')) if (line) add(JSON.parse(line.slice(line.indexOf('\t') + 1)));
  }
  const corpus = decodeCorpusJson(gunzipSync(readFileSync(new URL('../src/features/cad/sketch-solver/__tests__/fixtures/planegcs-corpus/graphs.json.gz', import.meta.url))).toString('utf8')) as Record<string, unknown>;
  for (const key of Object.keys(corpus).sort()) add(corpus[key]);
} else {
  for (const record of (JSON.parse(gunzipSync(readFileSync(from!)).toString('utf8')) as { records: { graph: unknown }[] }).records) add(record.graph);
}
const ordered = [...graphs.values()].sort((a, b) => a.relations.length - b.relations.length || topology(a).localeCompare(topology(b)));

const records = ordered.map(graph => {
  const labels = createCadSketchRelationLabels(graph);
  // A thrown error is recorded as { throws }; any other value as itself.
  const value = (run: () => unknown) => { const result = outcome(run); return 'ok' in result ? result.ok : result; };
  const names = new Map<string, unknown>(), descriptions = new Map<string, unknown>();
  // For each relation: entity ids, point ids, scalar paths, name, operand labels, description (0 when it is the name and labels) and glyph kind.
  const relations = graph.relations.map(relation => {
    const name = value(() => cadSketchRelationName(graph, relation, labels.centres)), operandLabels = value(() => cadSketchRelationOperandLabels(graph, relation, labels));
    const description = value(() => cadSketchRelationDescription(graph, relation, labels));
    names.set(relation.id, name); descriptions.set(relation.id, description);
    const derived = typeof name === 'string' && Array.isArray(operandLabels) ? `${name}: ${operandLabels.join(' and ')}` : null;
    return [value(() => cadSketchRelationEntityIds(relation)), value(() => cadSketchRelationPointIds(graph, relation)),
      value(() => {
        const seen: [string, unknown][] = [];
        const mapped = mapCadSketchRelationScalars(relation, (scalar, key) => { seen.push([key, scalar]); return `<${key}=${scalar}>`; });
        if (mapped === relation) return null;
        if (Object.keys(mapped).join() !== Object.keys(relation).join()) throw new Error('Scalar mapping reordered the relation.');
        return seen;
      }), name, operandLabels, description === derived ? 0 : description, value(() => cadSketchRelationGlyphKind(graph, relation, labels.centres))];
  });
  // For each glyph: relation ids, operand, kind, name and label (0 when they are its one relation's) and its place among its operand's.
  const glyphs = value(() => cadSketchRelationGlyphEntries(graph).map(entry => {
    if (entry.key !== `${entry.relationIds.join('+')}@${entry.operand}`) throw new Error('Unexpected glyph key.');
    const own = entry.relationIds.length === 1;
    return [entry.relationIds, entry.operand, entry.kind, own && entry.name === names.get(entry.relationIds[0]) ? 0 : entry.name,
      own && entry.label === descriptions.get(entry.relationIds[0]) ? 0 : entry.label, entry.index, entry.count];
  }));
  // The pairs of the first 400 relations of each such kind the tool took for the same one, and how each compared with its two variants.
  const same: [number, number][] = [], variants: (number | boolean | null)[][] = [];
  const groups = new Map<string, number[]>();
  graph.relations.forEach((relation, index) => { if (DEDUPE_KINDS.has(relation.kind)) groups.set(relation.kind, [...groups.get(relation.kind) ?? [], index]); });
  for (const members of groups.values()) {
    const capped = members.slice(0, 400);
    for (const i of capped) for (const j of capped) if (i !== j && sameRelation(graph.relations[i], graph.relations[j])) same.push([i, j]);
  }
  graph.relations.forEach((relation, index) => {
    if (!DEDUPE_KINDS.has(relation.kind)) return;
    const swap = swapped(relation), other = replaced(graph, relation);
    variants.push([index, swap && sameRelation(relation, swap), swap && sameRelation(swap, relation), other && sameRelation(relation, other), other && sameRelation(other, relation)]);
  });
  return { graph, relations, glyphs, same, variants };
});

// Parse refusals: every id of up to 40 relations of each kind, from the first graphs with at most 200 points, swapped for a missing id,
// the graph's first two points, its first two entities of each kind, or another id the relation names.
const sampled = new Map<string, number>(), mutations: unknown[][] = [];
ordered.forEach((graph, graphIndex) => {
  if (graph.points.length > 200) return;
  graph.relations.forEach((relation, relationIndex) => {
    const count = sampled.get(relation.kind) ?? 0;
    if (count >= 40) return;
    sampled.set(relation.kind, count + 1);
    const candidates = (current: string) => [...new Set(['zzmissing', ...graph.points.slice(0, 2).map(point => point.id),
      ...(['line', 'arc', 'circle'] as const).flatMap(kind => graph.entities.filter(entity => entity.kind === kind).slice(0, 2).map(entity => entity.id)),
      ...idPaths(relation).map(path => getAt(relation, path) as string)])].filter(id => id !== current);
    for (const path of idPaths(relation)) for (const value of candidates(getAt(relation, path) as string)) {
      const mutated = { ...graph, relations: graph.relations.map((item, index) => index === relationIndex ? setAt(item, path, value) : item) };
      const result = outcome(() => { parseCadSketchGraph(mutated); return 'ok'; });
      mutations.push([graphIndex, relationIndex, path, value, 'ok' in result ? 0 : result.throws]);
    }
  });
});

const text = JSON.stringify({ format: 1, records, mutations }), bytes = gzipSync(text, { level: 9 });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, bytes);
const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
console.log(JSON.stringify({
  read, graphs: records.length, relations: records.reduce((sum, record) => sum + record.relations.length, 0),
  kinds: new Set(ordered.flatMap(graph => graph.relations.map(relation => relation.kind))).size,
  mutations: mutations.length, refused: mutations.filter(item => item[4] !== 0).length, sampled: Object.fromEntries(sampled),
  jsonBytes: Buffer.byteLength(text), gzipBytes: bytes.length, jsonSha256: sha256(text), gzipSha256: sha256(bytes)
}, null, 2));
