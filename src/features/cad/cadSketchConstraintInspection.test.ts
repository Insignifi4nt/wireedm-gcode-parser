// @vitest-environment node
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { inspectCadSketchConstraints, pageCadSketchConstraints, summarizeCadSketchConstraintAnalysis } from './cadSketchConstraintInspection';
import { createCadSketchSolverRuntime } from './sketch-solver/cadSketchSolverRuntime';
import { initializeCadSketchSolverModule } from './sketch-solver/cadSketchSolverModule';
import { createCadSketchCornerTreatment } from '@/domain/cad/cadSketchCornerTreatment';
import { parseCadSketchGraph } from '@/domain/cad/cadSketchGraph';

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
  it('reports signed axis values and exact ordered center/reference operands without modifying accepted source', async () => {
    const document = parseCadDocument({ ...createCadDocument('Bore', 'axis-bore'), schemaVersion: 2,
      parameters: { left: -30, rise: 20 }, features: [{ id: 'sketch', name: 'Bore', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
        points: [{ id: 'reference', position: [' 10 ', '7'] }, { id: 'center', position: [-20, 27] }],
        entities: [{ id: 'bore', kind: 'circle', construction: true, centerPointId: 'center', radius: ' 2 ' }], relations: [
          { id: 'left', kind: 'axis-distance', pointIds: ['reference', 'center'], axis: 'x', value: ' left ' },
          { id: 'height', kind: 'axis-distance', pointIds: ['center', 'reference'], axis: 'y', value: ' -rise ' }
        ]
      } }] }), before = JSON.stringify(document);
    const inspection = await inspectCadSketchConstraints(document, 'sketch', async () => solver);
    expect(inspection.analysis).toMatchObject({ kind: 'solved', diagnostics: { degreesOfFreedom: 0, issues: [] } });
    expect(pageCadSketchConstraints(inspection, { section: 'relations' }).items).toMatchObject([
      { source: { id: 'left', kind: 'axis-distance', axis: 'x', pointIds: ['reference', 'center'], value: ' left ' },
        value: { scalar: ' left ', valueMm: -30, role: 'expression-driver' }, points: [{ id: 'reference' }, { id: 'center' }] },
      { source: { id: 'height', kind: 'axis-distance', axis: 'y', pointIds: ['center', 'reference'], value: ' -rise ' },
        value: { scalar: ' -rise ', valueMm: -20, role: 'expression-driver' }, points: [{ id: 'center' }, { id: 'reference' }] }
    ]);
    expect(JSON.stringify(document)).toBe(before);
  });

  it('reports exact angle ray intent and degree drivers without a misleading millimeter value', async () => {
    const document = parseCadDocument({ ...createCadDocument('Angle', 'angle'), schemaVersion: 2, parameters: { angle: 90 }, features: [{
      id: 'sketch', kind: 'sketch', name: 'Corner', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
        points: [{ id: 'v', position: ['0', '0'] }, { id: 'a', position: ['10', '0'] }, { id: 'b', position: [0, 10] }],
        entities: [{ id: 'reference', kind: 'line', construction: true, startPointId: 'a', endPointId: 'v' },
          { id: 'moving', kind: 'line', construction: false, startPointId: 'v', endPointId: 'b' }],
        relations: [{ id: 'dimension', kind: 'line-angle', rays: [{ lineId: 'reference', towardPointId: 'a' }, { lineId: 'moving', towardPointId: 'b' }], sense: 'ccw', value: ' angle ' }]
      }
    }] }), before = JSON.stringify(document);
    const inspection = await inspectCadSketchConstraints(document, 'sketch', async () => solver);
    const page = pageCadSketchConstraints(inspection, { section: 'relations' });
    expect(page.items[0]).toMatchObject({ source: { id: 'dimension', sense: 'ccw', value: ' angle ' }, entityIds: ['reference', 'moving'],
      value: { scalar: ' angle ', valueDegrees: 90, unit: 'deg', role: 'expression-driver' } });
    expect(page.items[0]).not.toHaveProperty('value.valueMm');
    expect(JSON.stringify(document)).toBe(before);
  });

  it('exposes equal-radius exact curve identities and deduplicated operands without a driving scalar', async () => {
    const document = parseCadDocument({ ...createCadDocument('Curves', 'equality'), schemaVersion: 2, parameters: { size: 20 }, features: [{
      id: 'sketch', kind: 'sketch', name: 'Curves', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
        points: [{ id: 'center', position: ['0', '0'] }, { id: 'start', position: [10, '0'] }, { id: 'end', position: ['0', 10] }],
        entities: [{ id: 'circle', kind: 'circle', construction: true, centerPointId: 'center', radius: 10 },
          { id: 'arc', kind: 'arc', construction: false, centerPointId: 'center', startPointId: 'start', endPointId: 'end', direction: 'cw' }],
        relations: [{ id: 'dimension', kind: 'radial-size', entityId: 'circle', quantity: 'diameter', value: ' size ' },
          { id: 'same', kind: 'equal-radius', curveIds: ['arc', 'circle'] }]
      }
    }] }), before = JSON.stringify(document);
    const inspection = await inspectCadSketchConstraints(document, 'sketch', async () => solver);
    expect(inspection.analysis).toMatchObject({ kind: 'solved', diagnostics: { degreesOfFreedom: 0 } });
    const row = pageCadSketchConstraints(inspection, { section: 'relations', offset: 1 }).items[0];
    expect(row).toMatchObject({ source: { id: 'same', kind: 'equal-radius', curveIds: ['arc', 'circle'] },
      entityIds: ['arc', 'circle'], points: [{ id: 'center' }, { id: 'start' }, { id: 'end' }] });
    expect(row).not.toHaveProperty('value'); expect(JSON.stringify(document)).toBe(before);
  });

  it.each(['radius', 'diameter'] as const)('exposes a radial %s source in displayed units with the actual curve reference', async quantity => {
    const size = quantity === 'diameter' ? 20 : 10;
    const document = parseCadDocument({ ...createCadDocument('Circle', 'radial'), schemaVersion: 2, parameters: { size }, features: [{
      id: 'sketch', kind: 'sketch', name: 'Circle', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
        points: [{ id: 'center', position: [' 0 ', '0'] }], entities: [{ id: 'circle', kind: 'circle', construction: true, centerPointId: 'center', radius: 10 }],
        relations: [{ id: 'dimension', kind: 'radial-size', entityId: 'circle', quantity, value: ' size ' }]
      }
    }] }), before = JSON.stringify(document);
    const inspection = await inspectCadSketchConstraints(document, 'sketch', async () => solver);
    expect(inspection.analysis).toMatchObject({ kind: 'solved', diagnostics: { degreesOfFreedom: 0 } });
    expect(pageCadSketchConstraints(inspection, { section: 'relations' }).items).toMatchObject([{
      source: { id: 'dimension', kind: 'radial-size', quantity, value: ' size ' }, entityIds: ['circle'], points: [{ id: 'center' }],
      value: { scalar: ' size ', valueMm: size, role: 'expression-driver' }
    }]);
    expect(JSON.stringify(document)).toBe(before);
  });

  it.each(['parallel', 'perpendicular', 'collinear'] as const)('exposes %s line identities and exact deduplicated point operands without inventing a scalar', async kind => {
    const document = parseCadDocument({ ...createCadDocument('Pair', 'pair'), schemaVersion: 2, features: [{ id: 'sketch', kind: 'sketch', name: 'Pair',
      suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
        points: [{ id: 'a', position: [' 0 ', '0'] }, { id: 'b', position: ['10', '0'] }, { id: 'c', position: kind === 'perpendicular' ? [0, 8] : [8, 0] }],
        entities: [{ id: 'reference', kind: 'line', construction: true, startPointId: 'a', endPointId: 'b' },
          { id: 'moving', kind: 'line', construction: false, startPointId: 'a', endPointId: 'c' }],
        relations: [{ id: 'direction', kind, lineIds: ['reference', 'moving'] }]
      } }] }), exact = JSON.stringify(document);
    const inspection = await inspectCadSketchConstraints(document, 'sketch', async () => solver);
    expect(inspection.analysis).toMatchObject({ kind: 'solved', diagnostics: { degreesOfFreedom: 1 } });
    const row = pageCadSketchConstraints(inspection, { section: 'relations' }).items[0];
    expect(row).toMatchObject({ source: { id: 'direction', kind, lineIds: ['reference', 'moving'] },
      entityIds: ['reference', 'moving'], meaning: kind === 'parallel' ? 'Keeps two line directions parallel.' : kind === 'perpendicular' ? 'Keeps two line directions at a right angle.'
        : 'Keeps two lines on the same infinite supporting line without joining endpoints or fixing lengths.',
      points: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
    expect(row).not.toHaveProperty('value'); expect(row).not.toHaveProperty('values');
    expect(JSON.stringify(document)).toBe(exact);
  });

  it.each(['fillet', 'chamfer'] as const)('exposes %s supports, generated geometry and exact driving quantities to agents', async kind => {
    const base = source(), feature = base.features[0];
    if (feature.kind !== 'sketch') throw new Error('Missing sketch fixture.');
    const graph = parseCadSketchGraph({ points: [{ id: 'v', position: [' 0 ', '0'] }, { id: 'a', position: ['20', '0'] }, { id: 'b', position: ['0', '16'] }],
      entities: [{ id: 'a-line', kind: 'line', construction: false, startPointId: 'v', endPointId: 'a' },
        { id: 'b-line', kind: 'line', construction: false, startPointId: 'v', endPointId: 'b' }], relations: [] });
    let id = 0;
    const treated = createCadSketchCornerTreatment({ graph, parameters: { size: 2 }, pointId: 'v', createId: () => `new-${++id}`,
      treatment: kind === 'fillet' ? { kind, radius: ' size ' } : { kind, setbacks: [' size ', 'size + 1'] } });
    const document = parseCadDocument({ ...base, parameters: { size: 2 }, features: [{ ...feature, graph: treated.graph }] });
    const exact = JSON.stringify(document), inspection = await inspectCadSketchConstraints(document, 'sketch', async () => solver);
    expect(inspection.analysis.kind).toBe('solved');
    const row = pageCadSketchConstraints(inspection, {}).items[0];
    if (!('entityIds' in row) || !('points' in row)) throw new Error('Expected an entity-owned corner relation.');
    expect(row.entityIds).toEqual(['a-line', 'b-line', treated.entityId]);
    expect(new Set(row.points.map(point => point.id))).toEqual(new Set(treated.graph.points.map(point => point.id)));
    if (kind === 'fillet') expect(row).toMatchObject({ value: { scalar: ' size ', valueMm: 2, role: 'expression-driver' } });
    else expect(row).toMatchObject({ values: [{ scalar: ' size ', valueMm: 2, role: 'expression-driver' }, { scalar: 'size + 1', valueMm: 3, role: 'expression-driver' }] });
    expect(JSON.stringify(document)).toBe(exact);
  });

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
