import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseCadSketchGraph, type CadSketchGraph, type CadSketchGraphRelation } from '@/domain/cad/cadSketchGraph';
import { cadSketchRelationEntityIds, cadSketchRelationPointIds, mapCadSketchRelationScalars } from '@/domain/cad/cadSketchGraphReferences';
import { cadSketchRelationDefinition, cadSketchRelationKey } from '@/domain/cad/sketch-relations/cadSketchRelationRegistry';
import { cadSketchRelationDescription, cadSketchRelationName, cadSketchRelationOperandLabels, createCadSketchRelationLabels } from '../../cadSketchRelationNames';
import { cadSketchRelationGlyphEntries, cadSketchRelationGlyphKind } from '../../cadSketchRelationGlyphLayout';

// Replays the outputs the per-kind switches gave before the shared definitions replaced them. The fixture holds every distinct sketch
// with relations that the Vitest suite parsed at the source commit, and the solver corpus, each read back through the parser with numeric
// coordinates set to 0, so it fixes every derived value per relation: references, scalar paths, names, labels and glyphs, which relations
// the constraint tool took for the same one, and the parse error, if any, for operands swapped for missing, repeated or other points and
// entities. It is frozen: scripts/record-sketch-relation-baseline.ts recorded it at the commit its manifest names, never from this code,
// and the manifest gives its inputs, normalization and steps.

type Path = readonly (string | number)[];
type Outcome = unknown;
type RelationRecord = readonly [entityIds: Outcome, pointIds: Outcome, scalars: Outcome, name: Outcome, operandLabels: Outcome, description: Outcome, glyphKind: Outcome];
type GlyphRecord = readonly [relationIds: readonly string[], operand: string, kind: string, name: string | 0, label: string | 0, index: number, count: number];
interface GraphRecord {
  readonly graph: CadSketchGraph;
  readonly relations: readonly RelationRecord[];
  readonly glyphs: readonly GlyphRecord[] | { readonly throws: string };
  readonly same: readonly (readonly [number, number])[];
  readonly variants: readonly (readonly [index: number, ...same: (boolean | null)[]])[];
}
interface Baseline { readonly format: 1; readonly records: readonly GraphRecord[]; readonly mutations: readonly (readonly [graph: number, relation: number, path: Path, value: string, error: 0 | string])[] }
const fixtures = `${process.cwd()}/src/features/cad/sketch-relations/__tests__/fixtures`, bytes = readFileSync(`${fixtures}/relation-baseline.json.gz`);
const baseline = JSON.parse(gunzipSync(bytes).toString('utf8')) as Baseline;
const manifest = JSON.parse(readFileSync(`${fixtures}/relation-baseline.manifest.json`, 'utf8')) as {
  readonly source: { readonly commit: string };
  readonly counts: { readonly graphs: number; readonly relations: number; readonly kinds: number; readonly mutations: number; readonly refused: number };
  readonly sha256: { readonly gzip: string };
};
// The recorded sketches, parsed once on first use, so a sketch the parser now refuses fails each test that reads it.
let parsed: readonly CadSketchGraph[] | undefined;
const accepted = () => parsed ??= baseline.records.map(record => parseCadSketchGraph(record.graph));

// As the recording recorded them: a thrown error as its code and message, any other value as itself.
const outcome = (run: () => unknown) => { try { return run(); } catch (error) { return { throws: error instanceof Error ? `${(error as { code?: string }).code ?? error.name}: ${error.message}` : String(error) }; } };
// The kinds the constraint tool checked for an existing relation before adding one.
const DEDUPE_KINDS = new Set(['coincident', 'horizontal', 'vertical', 'parallel', 'perpendicular', 'point-on-line', 'point-on-curve', 'tangent-joint', 'equal-length', 'equal-radius', 'midpoint', 'symmetric']);
// The same variants the recording compared each such relation with: its group stored in reverse, and its second operand replaced.
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
function setAt(value: unknown, path: Path, next: string): unknown {
  if (!path.length) return next;
  const [head, ...rest] = path;
  if (Array.isArray(value)) return value.map((item, index) => index === head ? setAt(item, rest, next) : item);
  return { ...(value as object), [head]: setAt((value as Record<string, unknown>)[head as string], rest, next) };
}

describe('sketch relation definitions against the recorded per-kind outputs', () => {
  it('parse every recorded sketch, which together hold every relation kind, from the fixture its manifest describes', () => {
    const relations = accepted().flatMap(graph => graph.relations);
    expect(baseline.format).toBe(1);
    expect(new Set(relations.map(relation => relation.kind)).size).toBe(25);
    expect(relations.length).toBeGreaterThan(10_000);
    // A fixture recorded again must come with its manifest, from the same source commit.
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.sha256.gzip);
    expect(manifest.source.commit).toBe('0cb6a292eb9d3378443bb4993c260d6c0c218fbe');
    expect({ graphs: baseline.records.length, relations: relations.length, kinds: 25, mutations: baseline.mutations.length,
      refused: baseline.mutations.filter(mutation => mutation[4] !== 0).length }).toEqual(manifest.counts);
  });

  it('derive the same references, scalars, names, labels and glyph kinds for every relation', () => {
    let compared = 0;
    accepted().forEach((graph, graphIndex) => {
      const labels = createCadSketchRelationLabels(graph);
      graph.relations.forEach((relation, index) => {
        const [entityIds, pointIds, scalars, name, operandLabels, description, glyphKind] = baseline.records[graphIndex].relations[index];
        const where = `graph ${graphIndex} relation ${relation.id} (${relation.kind})`;
        expect(outcome(() => [...cadSketchRelationEntityIds(relation)]), where).toEqual(entityIds);
        expect(outcome(() => [...cadSketchRelationPointIds(graph, relation)]), where).toEqual(pointIds);
        expect(outcome(() => {
          const seen: [string, unknown][] = [];
          const mapped = mapCadSketchRelationScalars(relation, (scalar, key) => { seen.push([key, scalar]); return `<${key}=${scalar}>`; });
          if (mapped === relation) return null;
          expect(Object.keys(mapped), where).toEqual(Object.keys(relation));
          return seen;
        }), where).toEqual(scalars);
        const newName = outcome(() => cadSketchRelationName(graph, relation, labels.centres)), newLabels = outcome(() => cadSketchRelationOperandLabels(graph, relation, labels));
        expect(newName, where).toEqual(name);
        expect(newLabels, where).toEqual(operandLabels);
        expect(outcome(() => cadSketchRelationDescription(graph, relation, labels)), where).toEqual(description === 0 ? `${name}: ${(operandLabels as string[]).join(' and ')}` : description);
        expect(outcome(() => cadSketchRelationGlyphKind(graph, relation, labels.centres)), where).toEqual(glyphKind);
        compared++;
      });
    });
    expect(compared).toBe(baseline.records.reduce((sum, record) => sum + record.relations.length, 0));
  }, 120_000);

  it('list the same glyphs for every sketch', () => {
    accepted().forEach((graph, graphIndex) => {
      const record = baseline.records[graphIndex], labels = createCadSketchRelationLabels(graph);
      const names = new Map(graph.relations.map(relation => [relation.id, cadSketchRelationName(graph, relation, labels.centres)]));
      const descriptions = new Map(graph.relations.map(relation => [relation.id, cadSketchRelationDescription(graph, relation, labels)]));
      const expected = 'throws' in record.glyphs ? record.glyphs : record.glyphs.map(([relationIds, operand, kind, name, label, index, count]) => ({
        key: `${relationIds.join('+')}@${operand}`, relationIds, operand, kind,
        name: name === 0 ? names.get(relationIds[0]) : name, label: label === 0 ? descriptions.get(relationIds[0]) : label, index, count
      }));
      const actual = outcome(() => cadSketchRelationGlyphEntries(graph).map(({ key, relationIds, operand, kind, name, label, index, count }) => ({ key, relationIds: [...relationIds], operand, kind, name, label, index, count })));
      expect(actual, `graph ${graphIndex}`).toEqual(expected);
    });
  }, 120_000);

  it('give one key to exactly the relations the constraint tool took for the same one', () => {
    accepted().forEach((graph, graphIndex) => {
      const record = baseline.records[graphIndex], same = new Set(record.same.map(([i, j]) => `${i} ${j}`)), groups = new Map<string, number[]>();
      graph.relations.forEach((relation, index) => { if (DEDUPE_KINDS.has(relation.kind)) groups.set(relation.kind, [...groups.get(relation.kind) ?? [], index]); });
      for (const members of groups.values()) {
        const capped = members.slice(0, 400), keys = capped.map(index => cadSketchRelationKey(graph.relations[index]));
        capped.forEach((i, a) => capped.forEach((j, b) => {
          if (i !== j) expect(keys[a] === keys[b], `graph ${graphIndex}: ${graph.relations[i].id} and ${graph.relations[j].id}`).toBe(same.has(`${i} ${j}`));
        }));
      }
      for (const [index, ...recorded] of record.variants) {
        const relation = graph.relations[index], key = cadSketchRelationKey(relation), swap = swapped(relation), other = replaced(graph, relation);
        const matches = (variant: CadSketchGraphRelation | null) => variant && key === cadSketchRelationKey(variant);
        expect([matches(swap), matches(swap), matches(other), matches(other)], `graph ${graphIndex} relation ${relation.id}`).toEqual(recorded);
      }
    });
  }, 120_000);

  // The recorded errors are the behaviour at the source commit, not invariants. Some swaps put an edge's id in a point slot or a point's
  // id in an edge slot, refused there because each slot took points or edges but not both. A slot that takes a point or a curve will
  // change those answers on purpose, and should then set those entries apart by name rather than record them from its own code.
  it('refuse the same operand swaps with the same parse errors', () => {
    let refused = 0;
    for (const [graphIndex, relationIndex, path, value, error] of baseline.mutations) {
      const graph = baseline.records[graphIndex].graph;
      const mutated = { ...graph, relations: graph.relations.map((item, index) => index === relationIndex ? setAt(item, path, value) : item) };
      const result = outcome(() => { parseCadSketchGraph(mutated); return 0; }) as 0 | { throws: string };
      expect(result === 0 ? 0 : result.throws, `graph ${graphIndex} relation ${relationIndex} ${path.join('.')} = ${value}`).toBe(error);
      if (error !== 0) refused++;
    }
    expect(refused).toBeGreaterThan(10_000);
  }, 300_000);

  it('give back each stored relation from its own operands and scalars', () => {
    for (const relation of accepted().flatMap(graph => graph.relations)) {
      const definition = cadSketchRelationDefinition(relation);
      expect(definition.withOperands(relation, definition.operands(relation)), relation.id).toEqual(relation);
      if (definition.scalars) expect(definition.scalars.write(relation, definition.scalars.read(relation)), relation.id).toEqual(relation);
    }
  });
});
