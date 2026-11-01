import { describe, expect, it } from 'vitest';
import { checkCadSketchGraph, parseCadSketchGraph } from '../cadSketchGraph';
import { tangentJoint, tangentPart, tangentSketch } from './cadSketchTangentFixtures';

/**
 * A 1 mm line ending tangent to a 1 mm radius arc at (1e7, 0), with the line's far end raised by
 * `rise` mm. At 1e7 mm the coordinates' roundoff over 1 mm supports (about 1.8e-8 rad) exceeds the
 * angular roundoff cap, so the cap is the angular limit; the rise keeps the residual within the
 * driver tolerance at that scale, so only the angle decides.
 */
function farTangent(rise: number) {
  const source = tangentSketch(tangentPart()).graph;
  return parseCadSketchGraph({ ...source, points: [
    { id: 'a', position: [9999999, rise] }, { id: 'j', position: [10000000, 0] },
    { id: 'c', position: [10000000, 1] }, { id: 'e', position: [10000001, 1] }
  ], relations: [tangentJoint] });
}
const tangentIssues = (rise: number) => checkCadSketchGraph(farTangent(rise), {}).filter(issue => issue.source.kind === 'relation' && issue.source.id === 'tangent');

describe('angular roundoff cap for far-origin tangency', () => {
  it('accepts a far-origin tangent joint turned by 4e-10 rad', () => {
    expect(tangentIssues(4e-10)).toEqual([]);
  });

  it('refuses a far-origin tangent joint turned by 3e-9 rad', () => {
    expect(tangentIssues(3e-9)).toEqual([expect.objectContaining({ code: 'relation-residual', message: 'The line and arc do not form a smooth tangent joint.' })]);
  });
});
