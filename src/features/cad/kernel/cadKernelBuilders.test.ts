// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import initOpenCascade from 'replicad-opencascadejs';
import { CompoundSketch, draw, drawCircle, drawRoundedRectangle, makeAx1, makeBox, makeCylinder, makePln, makeSphere, Plane, setOC, Vector,
  type Drawing, type Shape3D, type Sketch } from 'replicad';
import type { gp_Pln } from 'replicad-opencascadejs';
import { cadKernelAx1, cadKernelBuilders, cadKernelScaledUnitVector } from './cadKernelBuilders';
import { CadKernelPlane } from './cadKernelPlane';
import { cadKernelCurveEnd, cadKernelCurvePointAt, cadKernelCurveStart, cadKernelCurveTangentAt, cadKernelFaceNormal, cadKernelPlaneThrough } from './cadKernelQueries';
import { cadKernelRotateDrawing, cadKernelSketchFace, cadKernelSketchOnPlane, cadKernelTranslateDrawing } from './cadKernelSketch';
import { cadKernelDisposeOwned, cadKernelDisposeShape, cadKernelEdges, cadKernelFaces, cadKernelIsValid } from './cadKernelShapes';
import { watchCadKernelBuilders, type CadKernelBuilderKind } from './__tests__/cadKernelBuilderWatch';
import { watchCadKernelNativeObjects, watchEveryCadKernelNativeObject } from './__tests__/cadKernelNativeObjects';

beforeAll(async () => {
  const wasmBinary = await readFile(new URL('../../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));
  setOC(await initOpenCascade({ wasmBinary, print: () => undefined, printErr: () => undefined }));
}, 60_000);

// Fresh operands for each side: Replicad's transforms consume their input, and a boolean's
// simplification rewrites topology its result shares with its operands.
const target = (): Shape3D => makeBox([0, 0, 0], [20, 16, 10]);
const tool = (): Shape3D => makeCylinder(4, 16, [12, 8, -3]);
const ball = (): Shape3D => makeSphere(7);
// A tool that does not meet the target.
const far = (): Shape3D => makeCylinder(4, 16, [100, 100, 100]);

function same(owned: Shape3D, reference: Shape3D, label: string) {
  try {
    const actual = owned.serialize(), expected = reference.serialize();
    expect(actual === expected, `${label}: ${actual.length} and ${expected.length} characters of BRep`).toBe(true);
  } finally { cadKernelDisposeShape(owned); cadKernelDisposeShape(reference); }
}
// The points, directions, vectors and axes the adapters make to configure their builders.
const temporaries = ['gp_Pnt', 'gp_Dir', 'gp_Vec', 'gp_Ax1', 'gp_Ax2'] as const;
function intact(...shapes: Shape3D[]) {
  for (const shape of shapes) { expect(shape.isNull).toBe(false); expect(cadKernelIsValid(shape)).toBe(true); }
}

interface Operation {
  readonly name: string;
  readonly kind: CadKernelBuilderKind;
  readonly inputs: () => Shape3D[];
  readonly owned: (inputs: Shape3D[]) => Shape3D;
  readonly replicad: (inputs: Shape3D[]) => Shape3D;
}
const operations: readonly Operation[] = [
  { name: 'fuse', kind: 'fuse', inputs: () => [target(), tool()], owned: ([a, b]) => cadKernelBuilders.fuse(a, b), replicad: ([a, b]) => a.fuse(b) },
  { name: 'cut', kind: 'cut', inputs: () => [target(), tool()], owned: ([a, b]) => cadKernelBuilders.cut(a, b), replicad: ([a, b]) => a.cut(b) },
  { name: 'common', kind: 'common', inputs: () => [target(), ball()], owned: ([a, b]) => cadKernelBuilders.common(a, b), replicad: ([a, b]) => a.intersect(b) },
  { name: 'translate', kind: 'transform', inputs: () => [tool()], owned: ([a]) => cadKernelBuilders.translate(a, [3.5, -7.25, 1e3]), replicad: ([a]) => a.translate(3.5, -7.25, 1e3) },
  { name: 'rotate', kind: 'transform', inputs: () => [tool()], owned: ([a]) => cadKernelBuilders.rotate(a, 37.5, [1, -2, 3], [0.3, -0.4, 0.866]),
    replicad: ([a]) => a.rotate(37.5, [1, -2, 3], [0.3, -0.4, 0.866]) },
  ...(['XY', 'XZ', 'YZ'] as const).map((plane): Operation => ({ name: `mirror ${plane}`, kind: 'transform', inputs: () => [tool()],
    owned: ([a]) => cadKernelBuilders.mirror(a, plane), replicad: ([a]) => a.mirror(plane) })),
  { name: 'scale', kind: 'transform', inputs: () => [tool()], owned: ([a]) => cadKernelBuilders.scale(a, 25.4), replicad: ([a]) => a.scale(25.4) },
  { name: 'filletAll', kind: 'fillet', inputs: () => [target()], owned: ([a]) => cadKernelBuilders.filletAll(a, 1.5), replicad: ([a]) => a.fillet(1.5) },
  { name: 'chamferAll', kind: 'chamfer', inputs: () => [target()], owned: ([a]) => cadKernelBuilders.chamferAll(a, 1.5), replicad: ([a]) => a.chamfer(1.5) },
  // Zero and identity inputs, and operands that do not meet.
  { name: 'translate by zero', kind: 'transform', inputs: () => [tool()], owned: ([a]) => cadKernelBuilders.translate(a, [0, 0, 0]), replicad: ([a]) => a.translate(0, 0, 0) },
  ...([0, 360] as const).map((angle): Operation => ({ name: `rotate by ${angle} degrees`, kind: 'transform', inputs: () => [tool()],
    owned: ([a]) => cadKernelBuilders.rotate(a, angle, [1, -2, 3], [0.3, -0.4, 0.866]), replicad: ([a]) => a.rotate(angle, [1, -2, 3], [0.3, -0.4, 0.866]) })),
  { name: 'scale by 1', kind: 'transform', inputs: () => [tool()], owned: ([a]) => cadKernelBuilders.scale(a, 1), replicad: ([a]) => a.scale(1) },
  { name: 'cut by a tool that does not meet it', kind: 'cut', inputs: () => [target(), far()], owned: ([a, b]) => cadKernelBuilders.cut(a, b), replicad: ([a, b]) => a.cut(b) },
  { name: 'common with a shape that does not meet it', kind: 'common', inputs: () => [target(), far()], owned: ([a, b]) => cadKernelBuilders.common(a, b), replicad: ([a, b]) => a.intersect(b) }
];

describe('owned builder adapters', () => {
  it.each(operations)('$name gives Replicad\'s exact BRep', operation => {
    const borrowed = operation.inputs(), consumed = operation.inputs();
    try { same(operation.owned(borrowed), operation.replicad(consumed), operation.name); }
    finally { [...borrowed, ...consumed].forEach(cadKernelDisposeShape); }
  });
  it.each(operations)('$name deletes its builder, native result and temporaries and borrows its inputs', operation => {
    const inputs = operation.inputs(), watch = watchCadKernelBuilders(), objects = watchCadKernelNativeObjects(temporaries);
    try {
      const result = operation.owned(inputs);
      expect(objects.outstanding()).toEqual({});
      try { intact(result); } finally { cadKernelDisposeShape(result); }
      intact(...inputs);
      expect(watch.builders.map(item => item.kind)).toEqual([operation.kind]); expect(watch.builders[0].results).toHaveLength(1);
      expect(watch.outstanding()).toBe(0);
    } finally { objects.restore(); watch.restore(); inputs.forEach(cadKernelDisposeShape); }
  });
  it.each(operations)('$name deletes its builder and keeps its inputs when the native operation fails', operation => {
    const inputs = operation.inputs(), failure = new Error(`Interrupted ${operation.name}`);
    const watch = watchCadKernelBuilders({ kinds: [operation.kind], call: 1, error: failure }), objects = watchCadKernelNativeObjects(temporaries);
    try {
      expect(() => operation.owned(inputs)).toThrow(failure);
      expect(watch.failed).toHaveLength(1); expect(watch.outstanding()).toBe(0); expect(objects.outstanding()).toEqual({});
      intact(...inputs);
    } finally { objects.restore(); watch.restore(); inputs.forEach(cadKernelDisposeShape); }
  });
});

// OpenCascade refuses these with its own exception, from the owned adapters as from Replicad. The owned adapters leave no
// native object; Replicad leaves its builder or temporaries.
const openCascadeException = (WebAssembly as unknown as { Exception: new (...input: never[]) => unknown }).Exception;
const failures: readonly { name: string; owned: (box: Shape3D) => unknown; replicad: (box: Shape3D) => unknown; replicadLeaves: Readonly<Record<string, number>> }[] = [
  { name: 'a fillet larger than the box', owned: box => cadKernelBuilders.filletAll(box, 20), replicad: box => box.fillet(20), replicadLeaves: { BRepFilletAPI_MakeFillet: 1, 'TopExp_Explorer.Current': 24, 'TopoDS.Edge': 12 } },
  { name: 'a chamfer larger than the box', owned: box => cadKernelBuilders.chamferAll(box, 20), replicad: box => box.chamfer(20), replicadLeaves: { BRepFilletAPI_MakeChamfer: 1, 'TopExp_Explorer.Current': 24, 'TopoDS.Edge': 12 } },
  { name: 'a rotation about an axis of zero direction', owned: box => cadKernelBuilders.rotate(box, 30, [1, 2, 3], [0, 0, 0]),
    replicad: box => box.rotate(30, [1, 2, 3], [0, 0, 0]), replicadLeaves: { gp_Trsf: 1, gp_Vec: 1, 'gp_Vec.XYZ': 1 } },
  { name: 'an extrusion along a zero direction', owned: () => cadKernelScaledUnitVector([0, 0, 0], 12.5),
    replicad: () => new Vector([0, 0, 0]).normalized().multiply(12.5), replicadLeaves: { gp_Vec: 1 } },
  { name: 'a revolve axis of zero direction', owned: () => cadKernelAx1([1.5, -2, 7e3], [0, 0, 0]), replicad: () => makeAx1([1.5, -2, 7e3], [0, 0, 0]),
    replicadLeaves: { gp_Pnt: 1, gp_Vec: 1, 'gp_Vec.XYZ': 2 } }
];
describe('owned adapters on inputs OpenCascade refuses', () => {
  it.each(failures)('refuses $name as Replicad does and leaves no native object', failure => {
    const owned = target(), consumed = target();
    try {
      const objects = watchEveryCadKernelNativeObject();
      try { expect(() => failure.owned(owned)).toThrow(openCascadeException); expect(objects.made()).toBeGreaterThan(0); expect(objects.outstanding()).toEqual({}); }
      finally { objects.restore(); }
      intact(owned);
      const control = watchEveryCadKernelNativeObject();
      try { expect(() => failure.replicad(consumed)).toThrow(openCascadeException); expect(control.outstanding()).toEqual(failure.replicadLeaves); }
      finally { control.restore(); }
    } finally { cadKernelDisposeShape(owned); cadKernelDisposeShape(consumed); }
  });
});

describe('owned native values', () => {
  const directions = [[0.3, -0.4, 0.866], [0, 0, -1], [1e-3, 1, 1e3]] as const;
  it.each(directions)('extrudes along (%s, %s, %s) with Replicad\'s normalized vector and deletes its temporaries', (...direction) => {
    // Normalized and Multiplied each return a new vector; only the last is the caller's.
    const objects = watchCadKernelNativeObjects(temporaries, ['gp_Vec.Normalized', 'gp_Vec.Multiplied']);
    const owned = cadKernelScaledUnitVector(direction, 12.5);
    try { expect(objects.made()).toBe(3); expect(objects.outstanding(owned)).toEqual({}); expect(objects.outstanding()).toEqual({ 'gp_Vec.Multiplied': 1 }); }
    finally { objects.restore(); }
    const reference = new Vector([...direction]).normalized().multiply(12.5);
    try { expect([owned.X(), owned.Y(), owned.Z()]).toEqual(reference.toTuple()); }
    finally { owned.delete(); reference.delete(); }
  });
  it.each(directions)('revolves about (%s, %s, %s) with Replicad\'s axis and deletes its temporaries', (...direction) => {
    const objects = watchCadKernelNativeObjects(temporaries);
    const owned = cadKernelAx1([1.5, -2, 7e3], direction);
    try { expect(objects.made()).toBe(3); expect(objects.outstanding(owned)).toEqual({}); } finally { objects.restore(); }
    const reference = makeAx1([1.5, -2, 7e3], [...direction]);
    const read = (axis: typeof owned) => {
      const location = axis.Location(), unit = axis.Direction();
      try { return [location.X(), location.Y(), location.Z(), unit.X(), unit.Y(), unit.Z()]; } finally { location.delete(); unit.delete(); }
    };
    try { expect(read(owned)).toEqual(read(reference)); } finally { owned.delete(); reference.delete(); }
  });
  const frames = [
    [[37, -24, 11], [0.6, 0.8, 0], [0, 0, 2]],
    [[0, 0, 7], [1, 0, 0], [0, -1, 0]],
    [[1e4, -3, 0.25], [0.36, -0.48, 0.8], [0.8, 0.6, 0]]
  ] as const;
  it.each(frames)('places a plane at %j like Replicad\'s Plane and sketches on it with the same wire', (origin, xDirection, normal) => {
    const owned = new CadKernelPlane([...origin], [...xDirection], [...normal]), reference = new Plane([...origin], [...xDirection], [...normal]);
    const sketches: Sketch[] = [];
    try {
      expect([owned.origin.toTuple(), owned.xDir.toTuple(), owned.zDir.toTuple()]).toEqual([reference.origin.toTuple(), reference.xDir.toTuple(), reference.zDir.toTuple()]);
      const drawing = drawRoundedRectangle(20, 12, 2).translate(5, 3);
      const sketched = cadKernelSketchOnPlane(drawing, owned), expected = drawing.sketchOnPlane(reference) as Sketch;
      sketches.push(sketched, expected);
      expect(sketched.wire.serialize()).toBe(expected.wire.serialize());
      expect([sketched.defaultOrigin.toTuple(), sketched.defaultDirection.toTuple()]).toEqual([expected.defaultOrigin.toTuple(), expected.defaultDirection.toTuple()]);
    } finally { sketches.forEach(sketch => sketch.delete()); owned.delete(); reference.delete(); }
  });
  it('rejects a null normal or x direction and releases what it made', () => {
    const objects = watchCadKernelNativeObjects(['gp_Vec']);
    try {
      expect(() => new CadKernelPlane([0, 0, 0], [1, 0, 0], [0, 0, 0])).toThrow('normal should be non null');
      expect(() => new CadKernelPlane([0, 0, 0], [0, 0, 0], [0, 0, 1])).toThrow('xDir should be non null');
      expect(objects.made()).toBe(3); expect(objects.outstanding()).toEqual({});
    } finally { objects.restore(); }
  });
  it.each(frames)('deletes every vector and axis of a plane at %j and of a sketch placed on it', (origin, xDirection, normal) => {
    const drawing = drawRoundedRectangle(20, 12, 2).translate(5, 3);
    const objects = watchCadKernelNativeObjects([...temporaries, 'gp_Ax3', 'gp_Trsf']);
    try {
      const plane = new CadKernelPlane([...origin], [...xDirection], [...normal]);
      try { cadKernelSketchOnPlane(drawing, plane).delete(); } finally { plane.delete(); }
      expect(objects.made()).toBeGreaterThan(3); expect(objects.outstanding()).toEqual({});
    } finally { objects.restore(); }
  });
  it.each([0, 1, 2])('builds a face with %s holes like Replicad\'s sketch faces', holes => {
    const make = () => [drawRoundedRectangle(40, 30, 3).sketchOnPlane() as Sketch,
      ...[[-10, 0], [10, 0]].slice(0, holes).map(([x, y]) => drawCircle(4).translate(x, y).sketchOnPlane() as Sketch)];
    const owned = make(), consumed = make();
    const face = cadKernelSketchFace(owned);
    const reference = consumed.length === 1 ? consumed[0].face() : new CompoundSketch(consumed).face();
    try { expect(face.serialize()).toBe(reference.serialize()); for (const sketch of owned) expect(sketch.wire.isNull).toBe(false); }
    finally { cadKernelDisposeShape(face); cadKernelDisposeShape(reference); [...owned, ...consumed].forEach(sketch => sketch.delete()); }
  });
});

// Replicad's curve, face and plane queries leak the gp_Pnt that Value returns and the gp_XYZ each Vector copies.
const queryObjects = ['gp_Pnt', 'gp_Dir', 'gp_Vec', 'gp_Pln', 'BRepGProp_Face'] as const;
const queryReturns = ['BRepAdaptor_Curve.Value', 'gp_Pnt.XYZ', 'gp_Vec.XYZ', 'gp_Dir.XYZ'] as const;
const tuple = (vector: Vector) => { try { return vector.toTuple(); } finally { vector.delete(); } };
const cutBox = (): Shape3D => { const box = target(), cylinder = tool(); try { return cadKernelBuilders.cut(box, cylinder); } finally { cadKernelDisposeShape(box); cadKernelDisposeShape(cylinder); } };

describe('owned queries', () => {
  // Lines and full circles of a box cut by a cylinder, and the half-circle arcs of a drawn circle.
  const edgeSources = [
    { name: 'a box cut by a cylinder', shape: cutBox },
    { name: 'a drawn circle', shape: () => { const sketch = drawCircle(4).translate(2, -3).sketchOnPlane() as Sketch; return sketch.wire; } }
  ];
  it.each(edgeSources)('reads the edges of $name like Replicad\'s curve queries and leaves nothing', source => {
    const shape = source.shape(), edges = cadKernelEdges(shape);
    try {
      expect(edges.length).toBeGreaterThan(1);
      for (const edge of edges) {
        const curve = edge.curve;
        try {
          const objects = watchCadKernelNativeObjects(queryObjects, queryReturns);
          let owned: number[][];
          try {
            owned = [cadKernelCurveStart(curve.wrapped), cadKernelCurveEnd(curve.wrapped),
              ...[0, .25, .5, 1].flatMap(position => [cadKernelCurvePointAt(curve.wrapped, position), cadKernelCurveTangentAt(curve.wrapped, position)])];
            expect(objects.made()).toBeGreaterThan(0); expect(objects.outstanding()).toEqual({});
          } finally { objects.restore(); }
          const reference = [tuple(curve.startPoint), tuple(curve.endPoint), ...[0, .25, .5, 1].flatMap(position => [tuple(curve.pointAt(position)), tuple(curve.tangentAt(position))])];
          expect(owned).toEqual(reference);
        } finally { curve.delete(); }
      }
    } finally { edges.forEach(cadKernelDisposeOwned); cadKernelDisposeShape(shape); }
  });
  it('reads each face normal of a cut box, a mirrored box and a sphere like Replicad\'s Face.normalAt and leaves nothing', () => {
    const box = cutBox(), mirrored = cadKernelBuilders.mirror(box, 'YZ'), sphere = ball();
    try {
      for (const shape of [box, mirrored, sphere]) {
        const faces = cadKernelFaces(shape);
        try {
          for (const face of faces) {
            const objects = watchCadKernelNativeObjects(queryObjects, queryReturns);
            let owned: number[];
            try { owned = cadKernelFaceNormal(face); expect(objects.made()).toBe(3); expect(objects.outstanding()).toEqual({}); } finally { objects.restore(); }
            expect(owned).toEqual(tuple(face.normalAt()));
          }
        } finally { faces.forEach(cadKernelDisposeOwned); }
      }
    } finally { [box, mirrored, sphere].forEach(cadKernelDisposeShape); }
  });
  it.each([[[0, 0, 2.5], [0, 0, 1]], [[0, -5, 0], [0, 1, 0]], [[1e4, -3, 0.25], [0.36, -0.48, 0.8]]] as const)(
    'makes the plane through %j along %j like Replicad\'s makePln', (origin, normal) => {
      const read = (plane: gp_Pln) => {
        const frame = plane.Position(), location = frame.Location(), x = frame.XDirection(), y = frame.YDirection(), z = frame.Direction();
        try { return [location, x, y, z].flatMap(value => [value.X(), value.Y(), value.Z()]); }
        finally { [location, x, y, z, frame].forEach(value => value.delete()); }
      };
      const objects = watchCadKernelNativeObjects(queryObjects, queryReturns);
      let owned: gp_Pln;
      try { owned = cadKernelPlaneThrough(origin, normal); expect(objects.made()).toBe(3); expect(objects.outstanding(owned)).toEqual({}); } finally { objects.restore(); }
      const reference = makePln([...origin], [...normal]);
      try { expect(read(owned)).toEqual(read(reference)); } finally { owned.delete(); reference.delete(); }
    });
  it('sees the points and copies Replicad\'s own queries leave', () => {
    const shape = cutBox(), edges = cadKernelEdges(shape), faces = cadKernelFaces(shape);
    try {
      const curve = edges[0].curve, face = faces[0];
      const objects = watchCadKernelNativeObjects(queryObjects, queryReturns);
      try {
        tuple(curve.startPoint); tuple(face.normalAt());
        expect(objects.outstanding()).toMatchObject({ 'BRepAdaptor_Curve.Value': 1, 'gp_Pnt.XYZ': 1, 'gp_Vec.XYZ': 1 });
      } finally { objects.restore(); curve.delete(); }
    } finally { [...edges, ...faces].forEach(cadKernelDisposeOwned); cadKernelDisposeShape(shape); }
  });
});

describe('owned drawing transforms', () => {
  const transforms2d = ['gp_Trsf2d', 'gp_GTrsf2d', 'gp_Vec2d', 'gp_Pnt2d'] as const;
  const slot = () => draw([-6, -2]).lineTo([6, -2]).threePointsArcTo([6, 2], [8, 0]).lineTo([-6, 2]).threePointsArcTo([-6, -2], [-8, 0]).close();
  const shapes: readonly { name: string; drawing: () => Drawing }[] = [
    { name: 'a circle', drawing: () => drawCircle(4) }, { name: 'a rectangle', drawing: () => drawRoundedRectangle(20, 12) }, { name: 'a slot', drawing: slot }
  ];
  function compare(owned: Drawing, reference: Drawing) {
    const sketches: Sketch[] = [];
    try {
      expect(owned.serialize()).toBe(reference.serialize());
      sketches.push(owned.sketchOnPlane() as Sketch, reference.sketchOnPlane() as Sketch);
      expect(sketches[0].wire.serialize()).toBe(sketches[1].wire.serialize());
    } finally { sketches.forEach(sketch => sketch.delete()); }
  }
  const offsets = shapes.flatMap(shape => ([[3.5, -7.25], [0, 0]] as const).map(([x, y]) => ({ ...shape, x, y })));
  it.each(offsets)('translates $name by ($x, $y) like Replicad\'s Drawing.translate and deletes its transforms', shape => {
    const source = shape.drawing(), objects = watchCadKernelNativeObjects(transforms2d);
    let owned: Drawing;
    try { owned = cadKernelTranslateDrawing(source, shape.x, shape.y); expect(objects.made()).toBe(3); expect(objects.outstanding()).toEqual({}); } finally { objects.restore(); }
    const reference = source.translate(shape.x, shape.y);
    try { compare(owned, reference); } finally { [owned, reference, source].forEach(drawing => drawing.blueprint.delete()); }
  });
  const angles = shapes.flatMap(shape => [37.5, 0, 360].map(angle => ({ ...shape, angle })));
  it.each(angles)('rotates $name by $angle degrees like Replicad\'s Drawing.rotate about the origin and deletes its transforms', shape => {
    const source = shape.drawing(), objects = watchCadKernelNativeObjects(transforms2d);
    let owned: Drawing;
    try { owned = cadKernelRotateDrawing(source, shape.angle); expect(objects.made()).toBe(3); expect(objects.outstanding()).toEqual({}); } finally { objects.restore(); }
    const reference = source.rotate(shape.angle, [0, 0]);
    try { compare(owned, reference); } finally { [owned, reference, source].forEach(drawing => drawing.blueprint.delete()); }
  });
  it('sees the gp_Trsf2d Replicad\'s Drawing.translate never deletes', () => {
    const source = drawCircle(4), objects = watchCadKernelNativeObjects(transforms2d);
    let moved: Drawing | undefined;
    try { moved = source.translate(1, 2); expect(objects.outstanding()).toMatchObject({ gp_Trsf2d: 1 }); }
    finally { objects.restore(); moved?.blueprint.delete(); source.blueprint.delete(); }
  });
});
