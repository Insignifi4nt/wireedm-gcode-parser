// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import initOpenCascade from 'replicad-opencascadejs';
import { draw, drawCircle, drawRoundedRectangle, setOC, type Drawing, type Sketch } from 'replicad';
import { CadError } from '../../../domain/cad/cadError';
import { cadKernelDraw, cadKernelDrawCircle, cadKernelDrawRectangle, type CadKernelPen } from './cadKernelPen';
import { failCadKernelMethod, refuseCadKernelMaker, watchEveryCadKernelNativeObject } from './__tests__/cadKernelNativeObjects';

beforeAll(async () => {
  const wasmBinary = await readFile(new URL('../../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));
  setOC(await initOpenCascade({ wasmBinary, print: () => undefined, printErr: () => undefined }));
}, 60_000);

const diagonal = Math.SQRT1_2 * 10;
interface Shape {
  readonly name: string;
  readonly owned: () => Drawing;
  readonly replicad: () => Drawing;
  /** The curves the drawing owns, by the maker whose Value each is. */
  readonly curves: Readonly<Record<string, number>>;
  /** Whether the curves make a wire; degenerate drawings are compared curve by curve only. */
  readonly wire?: false;
}
const shapes: readonly Shape[] = [
  { name: 'a circle', owned: () => cadKernelDrawCircle(4), replicad: () => drawCircle(4), curves: { 'GC_MakeArcOfCircle2d.Value': 2 } },
  { name: 'a circle of radius 0.001', owned: () => cadKernelDrawCircle(1e-3), replicad: () => drawCircle(1e-3), curves: { 'GC_MakeArcOfCircle2d.Value': 2 } },
  { name: 'a rectangle', owned: () => cadKernelDrawRectangle(20, 12), replicad: () => drawRoundedRectangle(20, 12), curves: { 'GC_MakeSegment2d.Value': 4 } },
  // Replicad leaves out a side of zero length: the outline is the two vertical sides.
  { name: 'a rectangle of zero width', owned: () => cadKernelDrawRectangle(0, 12), replicad: () => drawRoundedRectangle(0, 12), curves: { 'GC_MakeSegment2d.Value': 2 }, wire: false },
  { name: 'a slot', owned: () => cadKernelDraw([-6, -2], pen => { pen.lineTo([6, -2]).threePointsArcTo([6, 2], [8, 0]).lineTo([-6, 2]).threePointsArcTo([-6, -2], [-8, 0]); }),
    replicad: () => draw([-6, -2]).lineTo([6, -2]).threePointsArcTo([6, 2], [8, 0]).lineTo([-6, 2]).threePointsArcTo([-6, -2], [-8, 0]).close(),
    curves: { 'GC_MakeSegment2d.Value': 2, 'GC_MakeArcOfCircle2d.Value': 2 } },
  { name: 'a polygon', owned: () => cadKernelDraw([0, 0], pen => { pen.lineTo([10, 0]).lineTo([12, 7]).lineTo([3, 9]); }),
    replicad: () => draw([0, 0]).lineTo([10, 0]).lineTo([12, 7]).lineTo([3, 9]).close(), curves: { 'GC_MakeSegment2d.Value': 4 } },
  { name: 'a path with a clockwise arc', owned: () => cadKernelDraw([0, 0], pen => { pen.lineTo([0, 10]).threePointsArcTo([10, 0], [diagonal, diagonal]); }),
    replicad: () => draw([0, 0]).lineTo([0, 10]).threePointsArcTo([10, 0], [diagonal, diagonal]).close(), curves: { 'GC_MakeSegment2d.Value': 2, 'GC_MakeArcOfCircle2d.Value': 1 } },
  { name: 'a path with a major arc', owned: () => cadKernelDraw([0, 0], pen => { pen.lineTo([10, 0]).threePointsArcTo([0, 10], [-diagonal, -diagonal]); }),
    replicad: () => draw([0, 0]).lineTo([10, 0]).threePointsArcTo([0, 10], [-diagonal, -diagonal]).close(), curves: { 'GC_MakeSegment2d.Value': 2, 'GC_MakeArcOfCircle2d.Value': 1 } },
  { name: 'sagitta arcs to either side', owned: () => cadKernelDraw([0, 0], pen => { pen.sagittaArc(10, 0, -3).sagittaArcTo([0, 0], -2); }),
    replicad: () => draw([0, 0]).sagittaArc(10, 0, -3).sagittaArcTo([0, 0], -2).close(), curves: { 'GC_MakeArcOfCircle2d.Value': 2 } },
  { name: 'an outline its last line closes', owned: () => cadKernelDraw([0, 0], pen => { pen.lineTo([5, 0]).lineTo([5, 5]).lineTo([0, 0]); }),
    replicad: () => draw([0, 0]).lineTo([5, 0]).lineTo([5, 5]).lineTo([0, 0]).close(), curves: { 'GC_MakeSegment2d.Value': 3 } },
  // Within the profile point tolerance of its start, the outline is closed and no line is added.
  { name: 'an outline that ends 0.0000005 mm from its start', owned: () => cadKernelDraw([0, 0], pen => { pen.lineTo([5, 0]).lineTo([5, 5]).lineTo([5e-7, 0]); }),
    replicad: () => draw([0, 0]).lineTo([5, 0]).lineTo([5, 5]).lineTo([5e-7, 0]).close(), curves: { 'GC_MakeSegment2d.Value': 3 }, wire: false },
  // OpenCascade makes a circle of radius zero through three coincident points; both pens keep its curve.
  { name: 'an arc through three coincident points', owned: () => cadKernelDraw([0, 0], pen => { pen.lineTo([3, 0]).threePointsArcTo([3, 0], [3, 0]); }),
    replicad: () => draw([0, 0]).lineTo([3, 0]).threePointsArcTo([3, 0], [3, 0]).close(), curves: { 'GC_MakeSegment2d.Value': 2, 'GC_MakeArcOfCircle2d.Value': 1 }, wire: false }
];

describe('owned profile pen', () => {
  it.each(shapes)('draws $name with Replicad\'s curves and wire', shape => {
    const owned = shape.owned(), reference = shape.replicad(), sketches: Sketch[] = [];
    try {
      expect(owned.serialize()).toBe(reference.serialize());
      if (shape.wire !== false) {
        sketches.push(owned.sketchOnPlane() as Sketch, reference.sketchOnPlane() as Sketch);
        expect(sketches[0].wire.serialize()).toBe(sketches[1].wire.serialize());
      }
    } finally { sketches.forEach(sketch => sketch.delete()); owned.blueprint.delete(); reference.blueprint.delete(); }
  });
  it.each(shapes)('draws $name, deleting every point and maker, and its curves with the drawing', shape => {
    const objects = watchEveryCadKernelNativeObject();
    try {
      const drawing = shape.owned();
      expect(objects.outstanding()).toEqual(shape.curves);
      drawing.blueprint.delete();
      expect(objects.outstanding()).toEqual({});
    } finally { objects.restore(); }
  });
});

// Both pens refuse these. Replicad throws on the null curve of the refused maker before it deletes its points and maker.
const invalidProfile = (run: () => unknown) => {
  try { run(); } catch (error) { return error instanceof CadError ? error.code : error; }
  throw new Error('Expected the drawing to be refused');
};
const refusals: readonly {
  readonly name: string;
  readonly owned: () => Drawing;
  readonly replicad: () => Drawing;
  readonly refuse?: readonly ['GC_MakeSegment2d' | 'GC_MakeArcOfCircle2d', number];
  readonly replicadLeaves: Readonly<Record<string, number>>;
}[] = [
  { name: 'a line of zero length', owned: () => cadKernelDraw([0, 0], pen => { pen.lineTo([0, 0]); }), replicad: () => draw([0, 0]).lineTo([0, 0]).close(),
    replicadLeaves: { gp_Pnt2d: 2, GC_MakeSegment2d: 1 } },
  { name: 'a side of zero length after two lines', owned: () => cadKernelDraw([0, 0], pen => { pen.lineTo([5, 0]).lineTo([5, 5]).lineTo([5, 5]); }),
    replicad: () => draw([0, 0]).lineTo([5, 0]).lineTo([5, 5]).lineTo([5, 5]).close(), replicadLeaves: { gp_Pnt2d: 2, GC_MakeSegment2d: 1, 'GC_MakeSegment2d.Value': 2 } },
  { name: 'an arc OpenCascade refuses after a line', owned: () => cadKernelDraw([0, 0], pen => { pen.lineTo([3, 3]).threePointsArcTo([5, 5], [4, 4]); }),
    replicad: () => draw([0, 0]).lineTo([3, 3]).threePointsArcTo([5, 5], [4, 4]).close(), refuse: ['GC_MakeArcOfCircle2d', 1],
    replicadLeaves: { gp_Pnt2d: 3, GC_MakeArcOfCircle2d: 1, 'GC_MakeSegment2d.Value': 1 } },
  { name: 'a closing line OpenCascade refuses', owned: () => cadKernelDraw([0, 0], pen => { pen.lineTo([5, 0]).lineTo([5, 5]); }),
    replicad: () => draw([0, 0]).lineTo([5, 0]).lineTo([5, 5]).close(), refuse: ['GC_MakeSegment2d', 3],
    replicadLeaves: { gp_Pnt2d: 2, GC_MakeSegment2d: 1, 'GC_MakeSegment2d.Value': 2 } }
];

describe('owned profile pen on profiles it refuses', () => {
  it.each(refusals)('refuses $name as invalid and leaves no native object', refusal => {
    const objects = watchEveryCadKernelNativeObject(), refused = refusal.refuse ? refuseCadKernelMaker(...refusal.refuse) : null;
    try {
      expect(invalidProfile(refusal.owned)).toBe('invalid-profile');
      if (refused) expect(refused.refused()).toBe(true);
      expect(objects.made()).toBeGreaterThan(0); expect(objects.outstanding()).toEqual({});
    } finally { refused?.restore(); objects.restore(); }
  });
  it.each(refusals)('sees what Replicad\'s pen leaves when it refuses $name', refusal => {
    const objects = watchEveryCadKernelNativeObject(), refused = refusal.refuse ? refuseCadKernelMaker(...refusal.refuse) : null;
    try {
      expect(() => refusal.replicad()).toThrow();
      expect(objects.outstanding()).toEqual(refusal.replicadLeaves);
    } finally { refused?.restore(); objects.restore(); }
  });
  // Orienting a made curve reads its first point. If that fails, the curve is deleted with its points and maker.
  it.each([
    ['a line', (pen: CadKernelPen) => { pen.lineTo([5, 0]); }],
    ['an arc', (pen: CadKernelPen) => { pen.threePointsArcTo([10, 0], [5, 5]); }]
  ] as const)('deletes %s whose orientation fails', (_name, step) => {
    const objects = watchEveryCadKernelNativeObject(), failure = new Error('Interrupted orientation');
    const failing = failCadKernelMethod('Geom2d_TrimmedCurve.FirstParameter', 1, failure);
    try {
      expect(() => cadKernelDraw([0, 0], step)).toThrow(failure);
      expect(failing.failed()).toBe(true); expect(objects.made()).toBeGreaterThan(0); expect(objects.outstanding()).toEqual({});
    } finally { failing.restore(); objects.restore(); }
  });
  it('deletes the curves already drawn when a step throws', () => {
    const objects = watchEveryCadKernelNativeObject(), failure = new Error('Interrupted drawing');
    try {
      expect(() => cadKernelDraw([0, 0], pen => { pen.lineTo([5, 0]).threePointsArcTo([0, 5], [4, 4]); throw failure; })).toThrow(failure);
      expect(objects.made()).toBeGreaterThan(0); expect(objects.outstanding()).toEqual({});
    } finally { objects.restore(); }
  });
});
