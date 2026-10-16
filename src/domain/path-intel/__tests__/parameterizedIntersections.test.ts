import { describe, expect, it } from 'vitest';
import { classifyLineRayPathSegmentIntersection, classifyParameterizedPathSegmentIntersection, classifyPathSegmentIntersection } from '../intersections';
import { createArcSegment, createCircleSegment, createLineSegment } from '../segments';

const source = { sourceEntityIndex: 0, sourceEntityType: 'line', layer: null, exact: true };
describe('finite analytic intersection parameters', () => {
  it('returns detached source-oriented line parameters without changing the legacy classifier', () => {
    const a = createLineSegment({ id: 'a', source, start: { x: 20, y: 0 }, end: { x: 0, y: 0 } });
    const b = createLineSegment({ id: 'b', source, start: { x: 5, y: -10 }, end: { x: 5, y: 10 } });
    const before = JSON.stringify([a, b]), hit = classifyParameterizedPathSegmentIntersection(a, b, 1e-12);
    expect(hit).toEqual({ kind: 'points', points: [{ point: { x: 5, y: 0 }, leftParameter: 0.75, rightParameter: 0.5 }] });
    expect(classifyPathSegmentIntersection(a, b, 1e-12)).toEqual({ kind: 'points', points: [{ x: 5, y: 0 }] });
    expect(Object.isFrozen(hit.points)).toBe(true); expect(Object.isFrozen(hit.points[0].point)).toBe(true);
    expect(JSON.stringify([a, b])).toBe(before); expect(Object.isFrozen(a)).toBe(false);
  });

  it('keeps signed major-arc parameters and a circle’s absent endpoint parameter when operands swap', () => {
    const arc = createArcSegment({ id: 'arc', source, center: { x: 0, y: 0 }, start: { x: 10, y: 0 }, end: { x: 0, y: 10 }, clockwise: true });
    const line = createLineSegment({ id: 'line', source, start: { x: -20, y: 0 }, end: { x: -5, y: 0 } });
    const hit = classifyParameterizedPathSegmentIntersection(arc, line, 1e-12);
    expect(hit).toEqual({ kind: 'points', points: [{ point: { x: -10, y: 0 }, leftParameter: 2 / 3, rightParameter: 2 / 3 }] });
    const circle = createCircleSegment({ id: 'circle', source, center: { x: 0, y: 0 }, radius: 10 });
    expect(classifyParameterizedPathSegmentIntersection(line, circle, 1e-12)).toEqual({ kind: 'points', points: [
      { point: { x: -10, y: 0 }, leftParameter: 2 / 3, rightParameter: null }] });
  });

  it('reports overlap and no finite hit explicitly, without inventing extension parameters', () => {
    const a = createLineSegment({ id: 'a', source, start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
    const b = createLineSegment({ id: 'b', source, start: { x: 5, y: 0 }, end: { x: 20, y: 0 } });
    expect(classifyParameterizedPathSegmentIntersection(a, b, 1e-12)).toEqual({ kind: 'overlap', points: [] });
    const c = createLineSegment({ id: 'c', source, start: { x: 20, y: -5 }, end: { x: 20, y: 5 } });
    expect(classifyParameterizedPathSegmentIntersection(a, c, 1e-12)).toEqual({ kind: 'none', points: [] });
  });
});

describe('outward line ray against finite analytic boundaries', () => {
  it('returns source t beyond either endpoint without extending its finite cutter or changing finite queries', () => {
    const line = createLineSegment({ id: 'line', source, start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
    const forward = createLineSegment({ id: 'front', source, start: { x: 20, y: -5 }, end: { x: 20, y: 5 } });
    const backward = createLineSegment({ id: 'back', source, start: { x: -10, y: -5 }, end: { x: -10, y: 5 } });
    expect(classifyLineRayPathSegmentIntersection(line, forward, 'end', 1e-12)).toEqual({ kind: 'points', points: [
      { point: { x: 20, y: 0 }, leftParameter: 2, rightParameter: 0.5 }] });
    expect(classifyLineRayPathSegmentIntersection(line, backward, 'start', 1e-12)).toEqual({ kind: 'points', points: [
      { point: { x: -10, y: 0 }, leftParameter: -1, rightParameter: 0.5 }] });
    expect(classifyLineRayPathSegmentIntersection(line, backward, 'end', 1e-12)).toEqual({ kind: 'none', points: [] });
    expect(classifyParameterizedPathSegmentIntersection(line, forward, 1e-12)).toEqual({ kind: 'none', points: [] });
    const short = createLineSegment({ id: 'short', source, start: { x: 20, y: 1 }, end: { x: 20, y: 5 } });
    expect(classifyLineRayPathSegmentIntersection(line, short, 'end', 1e-12)).toEqual({ kind: 'none', points: [] });
  });

  it('retains both circle roots but only the actual signed arc sector without a proxy endpoint', () => {
    const line = createLineSegment({ id: 'line', source, start: { x: -20, y: 0 }, end: { x: -15, y: 0 } });
    const circle = createCircleSegment({ id: 'circle', source, center: { x: 0, y: 0 }, radius: 10 });
    const hits = classifyLineRayPathSegmentIntersection(line, circle, 'end', 1e-12);
    expect(hits).toEqual({ kind: 'points', points: [
      { point: { x: -10, y: 0 }, leftParameter: 2, rightParameter: null },
      { point: { x: 10, y: 0 }, leftParameter: 6, rightParameter: null }] });
    const minor = createArcSegment({ id: 'arc', source, center: circle.center, start: { x: 10, y: 0 }, end: { x: 0, y: 10 }, clockwise: false });
    expect(classifyLineRayPathSegmentIntersection(line, minor, 'end', 1e-12)).toEqual({ kind: 'points', points: [
      { point: { x: 10, y: 0 }, leftParameter: 6, rightParameter: 0 }] });
    const major = createArcSegment({ ...minor, clockwise: true, sweepRadians: undefined });
    expect(classifyLineRayPathSegmentIntersection(line, major, 'end', 1e-12)).toEqual({ kind: 'points', points: [
      { point: { x: -10, y: 0 }, leftParameter: 2, rightParameter: 2 / 3 },
      { point: { x: 10, y: 0 }, leftParameter: 6, rightParameter: 0 }] });
    expect(Object.isFrozen(hits.points)).toBe(true); expect(Object.isFrozen(hits.points[0].point)).toBe(true);
  });

  it('clips collinear overlap to the selected ray and retains one tangent contact', () => {
    const line = createLineSegment({ id: 'line', source, start: { x: 0, y: 5 }, end: { x: 10, y: 5 } });
    const ahead = createLineSegment({ id: 'ahead', source, start: { x: 20, y: 5 }, end: { x: 30, y: 5 } });
    const behind = createLineSegment({ id: 'behind', source, start: { x: -20, y: 5 }, end: { x: -10, y: 5 } });
    expect(classifyLineRayPathSegmentIntersection(line, ahead, 'end', 1e-12)).toEqual({ kind: 'overlap', points: [] });
    expect(classifyLineRayPathSegmentIntersection(line, behind, 'start', 1e-12)).toEqual({ kind: 'overlap', points: [] });
    expect(classifyLineRayPathSegmentIntersection(line, ahead, 'start', 1e-12)).toEqual({ kind: 'none', points: [] });
    expect(classifyLineRayPathSegmentIntersection(line, behind, 'end', 1e-12)).toEqual({ kind: 'none', points: [] });
    const circle = createCircleSegment({ id: 'circle', source, center: { x: 20, y: 0 }, radius: 5 });
    expect(classifyLineRayPathSegmentIntersection(line, circle, 'end', 1e-12)).toEqual({ kind: 'points', points: [
      { point: { x: 20, y: 5 }, leftParameter: 2, rightParameter: null }] });
  });
});
