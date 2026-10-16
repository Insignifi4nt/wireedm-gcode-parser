// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { parseCadSketchGraph, type CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { parseCadSketchSolveInput, parseCadSketchSolverReply } from './cadSketchSolverProtocol';

const source = () => parseCadSketchGraph({ points: [{ id: 'a', position: [' 0 ', '0'] }, { id: 'b', position: [10, 0] }],
  entities: [{ id: 'line', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }],
  relations: [{ id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: ' span ' }] });
const documentWith = (graph: CadSketchGraph) => ({ ...createCadDocument('Precision', 'precision'), schemaVersion: 2, parameters: { span: 10 },
  features: [{ id: 'sketch', kind: 'sketch', name: 'Sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph }] });
const replyWith = (graph: CadSketchGraph) => ({ id: 1, kind: 'result', result: { kind: 'solved', graph,
  diagnostics: { status: 'success', degreesOfFreedom: 1, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: [] } } });

describe('shared sketch precision at document and worker boundaries', () => {
  it('accepts a within-budget free numeric result through both boundaries without changing drivers or source', () => {
    const graph = source(), before = JSON.stringify(graph), input = parseCadSketchSolveInput({ graph, parameters: { span: 10 } });
    const candidate = parseCadSketchGraph({ ...graph, points: graph.points.map(point => point.id === 'b' ? { ...point, position: [10 + 5e-11, 0] } : point) });
    const accepted = parseCadDocument(documentWith(candidate)), reply = parseCadSketchSolverReply(replyWith(candidate), input);
    expect(accepted.features[0]).toMatchObject({ graph: candidate });
    expect(reply).toMatchObject({ result: { kind: 'solved', graph: candidate } });
    expect(JSON.stringify(graph)).toBe(before);
    expect(candidate.points[0].position).toEqual([' 0 ', '0']);
    expect(candidate.relations[0]).toMatchObject({ value: ' span ' });
  });

  it('rejects beyond-budget or exact-driver-changing replies independently of native Success', () => {
    const graph = source(), input = parseCadSketchSolveInput({ graph, parameters: { span: 10 } });
    const outside = parseCadSketchGraph({ ...graph, points: graph.points.map(point => point.id === 'b' ? { ...point, position: [10 + 2e-10, 0] } : point) });
    expect(() => parseCadDocument(documentWith(outside))).toThrowError(expect.objectContaining({ code: 'invalid-sketch-graph-geometry' }));
    expect(() => parseCadSketchSolverReply(replyWith(outside), input)).toThrow('constraints');
    const changedDriver = parseCadSketchGraph({ ...graph, points: graph.points.map(point => point.id === 'a' ? { ...point, position: ['0', '0'] } : point) });
    expect(() => parseCadSketchSolverReply(replyWith(changedDriver), input)).toThrow('request');
    const separated = parseCadSketchGraph({ ...graph, points: [{ id: 'a', position: [' 0 ', '0'] }, { id: 'b', position: [5e-11, 0] }],
      entities: [], relations: [{ id: 'join', kind: 'coincident', pointIds: ['a', 'b'] }] });
    expect(() => parseCadDocument(documentWith(separated))).toThrowError(expect.objectContaining({ code: 'invalid-sketch-graph-geometry' }));
    expect(() => parseCadSketchSolverReply(replyWith(separated), parseCadSketchSolveInput({ graph: separated, parameters: { span: 10 } }))).toThrow('constraints');
  });
});
