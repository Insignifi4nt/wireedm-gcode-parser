import { describe, expect, it } from 'vitest';
import { parseCadSketchGraph } from '../cadSketchGraph';
import { createCadSketchMeasurementReader } from '../cadSketchMeasurements';

const graph = parseCadSketchGraph({ points: [
  { id: 'a', position: [' shift ', '10'] }, { id: 'b', position: ['shift + 3', '14'] },
  { id: 'o', position: [0, 0] }, { id: 'right', position: [5, 0] }, { id: 'top', position: [0, 5] }
], entities: [
  { id: 'line', kind: 'line', startPointId: 'a', endPointId: 'b', construction: true },
  { id: 'circle', kind: 'circle', centerPointId: 'a', radius: ' bore / 2 ', construction: false },
  { id: 'minor', kind: 'arc', centerPointId: 'o', startPointId: 'right', endPointId: 'top', direction: 'ccw', construction: true },
  { id: 'major', kind: 'arc', centerPointId: 'o', startPointId: 'right', endPointId: 'top', direction: 'cw', construction: true }
], relations: [] });

describe('read-only sketch geometry measurements', () => {
  it('reads actual local geometry and ordered point deltas without changing exact drivers', () => {
    const exact=JSON.stringify(graph), reader=createCadSketchMeasurementReader(graph, { shift: 1000000, bore: 8 });
    expect(reader.point('a')).toEqual([1000000, 10]);
    expect(reader.entity('line')).toEqual({ kind: 'line', lengthMm: 5, deltaMm: [3, 4] });
    expect(reader.betweenPoints('b', 'a')).toEqual({ distanceMm: 5, deltaMm: [-3, -4] });
    expect(reader.betweenPoints('a', 'a')).toEqual({ distanceMm: 0, deltaMm: [0, 0] });
    expect(reader.entity('circle')).toEqual({ kind: 'circle', radiusMm: 4, diameterMm: 8, circumferenceMm: 8*Math.PI });
    expect(JSON.stringify(graph)).toBe(exact);
  });
  it('retains actual directed minor and major arc sweeps instead of chord length', () => {
    const reader=createCadSketchMeasurementReader(graph, { shift: 0, bore: 8 });
    expect(reader.entity('minor')).toEqual({ kind: 'arc', radiusMm: 5, sweepDegrees: 90, lengthMm: 2.5*Math.PI });
    expect(reader.entity('major')).toEqual({ kind: 'arc', radiusMm: 5, sweepDegrees: -270, lengthMm: 7.5*Math.PI });
  });
  it('rejects unavailable or invalid geometry rather than inventing a measurement', () => {
    const reader=createCadSketchMeasurementReader(graph, { shift: 0, bore: 8 });
    expect(()=>reader.point('missing')).toThrow(); expect(()=>reader.entity('missing')).toThrow();
    expect(()=>createCadSketchMeasurementReader(graph, {}).entity('circle')).toThrow();
    const bad = { ...graph, points: graph.points.map(p=>p.id==='top' ? { ...p, position: [0, 6] as const } : p) };
    expect(()=>createCadSketchMeasurementReader(bad, {shift:0,bore:8}).entity('minor')).toThrow();
  });
});
