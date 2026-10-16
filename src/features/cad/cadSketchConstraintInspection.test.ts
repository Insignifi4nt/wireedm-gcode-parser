// @vitest-environment node
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { inspectCadSketchConstraints, pageCadSketchConstraints, summarizeCadSketchConstraintAnalysis } from './cadSketchConstraintInspection';
import { createCadSketchSolverRuntime } from './sketch-solver/cadSketchSolverRuntime';
import { initializeCadSketchSolverModule } from './sketch-solver/cadSketchSolverModule';

const require = createRequire(import.meta.url);
const solver = createCadSketchSolverRuntime(() => initializeCadSketchSolverModule(pathToFileURL(require.resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm')).href));
const source = () => parseCadDocument({ ...createCadDocument('Line', 'line'), schemaVersion: 2, parameters: { span: 20 }, features: [{
  id: 'sketch', name: 'Sketch', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
    points: [{ id: 'a', position: [' 0 ', '0'] }, { id: 'b', position: [20, 0] }],
    entities: [{ id: 'edge', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }],
    relations: [{ id: 'horizontal', kind: 'horizontal', pointIds: ['a', 'b'] }, { id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: ' span ' }]
  }
}] });

describe('accepted sketch constraint inspection', () => {
  it('reports native graph freedom and exact relation drivers without publishing a solved graph', async () => {
    const document = source(), exact = JSON.stringify(document);
    const inspection = await inspectCadSketchConstraints(document, 'sketch', async () => solver);
    expect(inspection).toMatchObject({ sketchId: 'sketch', pointCount: 2, entityCount: 1, relationCount: 2, legacyProfileCount: 0,
      analysis: { kind: 'solved', diagnostics: { status: 'success', degreesOfFreedom: 0 } } });
    expect(inspection.graph).toBe(document.features[0].kind === 'sketch' ? document.features[0].graph : null);
    expect(JSON.stringify(document)).toBe(exact);
    const relations = pageCadSketchConstraints(inspection, { section: 'relations', offset: 1, limit: 1 });
    expect(relations).toMatchObject({ total: 2, nextOffset: null, items: [{ source: { id: 'length', value: ' span ' },
      value: { scalar: ' span ', valueMm: 20, role: 'expression-driver' },
      points: [{ id: 'a', position: [{ scalar: ' 0 ', role: 'expression-driver' }, { scalar: '0', role: 'expression-driver' }] },
        { id: 'b', position: [{ scalar: 20, role: 'solver-variable' }, { scalar: 0, role: 'solver-variable' }] }] }] });
    expect(pageCadSketchConstraints(inspection, { section: 'points', offset: 1, limit: 1 })).toMatchObject({ total: 2, nextOffset: null,
      items: [{ id: 'b', entityIds: ['edge'], entityCount: 1, omittedEntityCount: 0 }] });
    expect(pageCadSketchConstraints(inspection, { section: 'entities' })).toMatchObject({ total: 1, nextOffset: null,
      items: [{ source: { id: 'edge', startPointId: 'a', endPointId: 'b' }, points: [{ id: 'a' }, { id: 'b' }] }] });
    expect(pageCadSketchConstraints(inspection, { offset: 2 })).toEqual({ items: [], total: 2, nextOffset: null });
  });

  it('reports redundant native relation identities without repairing accepted source', async () => {
    const original = source(), sketch = original.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Missing fixture graph');
    const document = parseCadDocument({ ...original, features: [{ ...sketch, graph: { ...sketch.graph, relations: [...sketch.graph.relations,
      { id: 'duplicate', kind: 'distance', pointIds: ['a', 'b'], value: ' span ' }] } }] }), exact = JSON.stringify(document);
    const inspection = await inspectCadSketchConstraints(document, 'sketch', async () => solver);
    expect(inspection).toMatchObject({ relationCount: 3, analysis: { kind: 'rejected', reason: 'redundant',
      diagnostics: { status: 'success', redundantIds: ['duplicate'] } } });
    expect(inspection.graph).toBe(document.features[0].kind === 'sketch' ? document.features[0].graph : null);
    expect(pageCadSketchConstraints(inspection, { offset: 2 })).toMatchObject({ items: [{ source: { id: 'duplicate' },
      diagnostics: { conflicting: false, redundant: true, partiallyRedundant: false } }] });
    expect(JSON.stringify(document)).toBe(exact);
  });

  it('reports legacy dimension counts without starting native analysis or inventing graph freedom', async () => {
    const document = parseCadDocument({ ...createCadDocument(), features: [{ id: 'sketch', kind: 'sketch', name: 'Legacy', suppressed: false,
      plane: 'XY', offset: 0, profiles: [{ id: 'circle', name: 'Circle', construction: false,
        constraints: [{ id: 'diameter', kind: 'dimension', quantity: 'diameter' }], geometry: { kind: 'circle', x: 0, y: 0, radius: 5 } }] }] });
    const getSolver = vi.fn(async () => solver);
    const inspection = await inspectCadSketchConstraints(document, 'sketch', getSolver);
    expect(inspection).toMatchObject({ graph: null, pointCount: 0, entityCount: 0, relationCount: 0,
      legacyProfileCount: 1, legacyDimensionCount: 1, degreesOfFreedomScope: 'graph', analysis: { kind: 'legacy',
        diagnostics: { status: null, degreesOfFreedom: null } } });
    expect(getSolver).not.toHaveBeenCalled();
    expect(pageCadSketchConstraints(inspection, {})).toEqual({ items: [], total: 0, nextOffset: null });
  });

  it('keeps native graph freedom separate from coexisting legacy primitive dimensions', async () => {
    const document = parseCadDocument({ ...createCadDocument(), schemaVersion: 2, features: [{ id: 'sketch', kind: 'sketch', name: 'Mixed source', suppressed: false,
      plane: 'XY', offset: 0, profiles: [{ id: 'circle', name: 'Circle', construction: false,
        constraints: [{ id: 'diameter', kind: 'dimension', quantity: 'diameter' }], geometry: { kind: 'circle', x: 100, y: 0, radius: 5 } }],
      graph: { points: [{ id: 'free', position: [1, 2] }], entities: [], relations: [] } }] });
    const exact = JSON.stringify(document), inspection = await inspectCadSketchConstraints(document, 'sketch', async () => solver);
    expect(inspection).toMatchObject({ pointCount: 1, legacyProfileCount: 1, legacyDimensionCount: 1, degreesOfFreedomScope: 'graph',
      analysis: { kind: 'solved', diagnostics: { status: 'success', degreesOfFreedom: 2 } } });
    expect(JSON.stringify(document)).toBe(exact);
  });

  it('keeps native failure retryable and propagates cancellation instead of reporting unavailable', async () => {
    const document = source(), exact = JSON.stringify(document);
    const failed = await inspectCadSketchConstraints(document, 'sketch', async () => { throw new Error('Worker initialization failed'); });
    expect(failed.analysis).toMatchObject({ kind: 'unavailable', message: 'Worker initialization failed', diagnostics: {
      status: null, degreesOfFreedom: null, conflictingIds: [], redundantIds: [] } });
    expect(pageCadSketchConstraints(failed, { limit: 1 })).toMatchObject({ items: [{ diagnostics: null }] });
    const abort = new AbortController();
    await expect(inspectCadSketchConstraints(document, 'sketch', async () => { abort.abort(); return solver; }, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(JSON.stringify(document)).toBe(exact);
    expect((await inspectCadSketchConstraints(document, 'sketch', async () => solver)).analysis.kind).toBe('solved');
  });

  it('bounds native diagnostic summaries and keeps unknown freedom distinct from zero', async () => {
    const ids = Array.from({ length: 300 }, (_, index) => `relation-${index}-${'a'.repeat(75)}`);
    const inspection = await inspectCadSketchConstraints(source(), 'sketch', async () => ({ solve: async () => ({
      kind: 'rejected', reason: 'conflicting', message: '孔'.repeat(20_000), diagnostics: { status: 'failed', degreesOfFreedom: -1,
        conflictingIds: ids, redundantIds: ids, partiallyRedundantIds: ids,
        issues: ids.map(id => ({ source: { kind: 'relation', id }, code: 'relation-residual', message: '孔'.repeat(2000) })) }
    }) }));
    expect(inspection.analysis.diagnostics.degreesOfFreedom).toBeNull();
    const summary = summarizeCadSketchConstraintAnalysis(inspection.analysis);
    expect(summary).toMatchObject({ kind: 'rejected', status: 'failed', degreesOfFreedom: null,
      conflicting: { ids: ids.slice(0, 8), count: 300, omittedCount: 292 }, issueCount: 300, omittedIssueCount: 298 });
    expect(new TextEncoder().encode(JSON.stringify(summary)).byteLength).toBeLessThan(8 * 1024);
    expect(inspection.analysis.diagnostics.conflictingIds).toEqual(ids);
  });
});
