import { CompoundSketch, draw, drawCircle, drawRoundedRectangle, exportSTEP, getOC, makeCompound, measureVolume, Plane, type Drawing, type Shape3D, type SimplePoint, type Sketch } from 'replicad';
import type { CadBuildResult, CadDocument, CadFeature, CadMesh, CadScalar, CadSketchFeature } from '../../../domain/cad/cadDocument';
import { evaluateCadAngle, evaluateCadScalar } from '../../../domain/cad/cadExpression';
import { CadError } from '../../../domain/cad/cadError';
import { cadProfileContainsPoint, cadProfileToEntities, resolveCadProfile, type ResolvedCadProfile } from '../../../domain/cad/cadSketchGeometry';
import type { CadSectionRequest, CadSectionResult } from '../../../domain/cad/cadSection';
import { cadKernelPlaneBasis } from './cadKernelPlane';
import { sectionCadKernelShape } from './cadKernelSection';
import { cadMeshScalarCount, MAX_CAD_PREVIEW_SCALARS } from './cadKernelLimits';

/** BRep state stays inside the worker. Only tessellation and export bytes leave it. */
export interface CadKernelModel {
  readonly result: CadBuildResult;
  export(format: 'step' | 'stl'): Blob;
  section(request: CadSectionRequest): CadSectionResult;
  dispose(): void;
}

const meshOptions = { tolerance: 0.05, angularTolerance: 0.15 };

function profileDrawing(profile: ResolvedCadProfile, drawings: Drawing[]): Drawing {
  const own = (drawing: Drawing) => { drawings.push(drawing); return drawing; };
  switch (profile.kind) {
    case 'rectangle': {
      if (profile.cornerRadius === 0) return own(own(drawRoundedRectangle(profile.width, profile.height)).translate(profile.x + profile.width / 2, profile.y + profile.height / 2));
      // Explicit analytic arcs also handle radius exactly half the shorter side.
      // Replicad's tangent-arc primitive fails on the zero-length straight edges.
      const entities = cadProfileToEntities(profile);
      const first = entities[0];
      if (!first || first.type !== 'line' && first.type !== 'arc') throw new CadError('invalid-profile', 'A rounded rectangle needs a closed analytic boundary.');
      const pen = draw([first.start.x, first.start.y]);
      for (const entity of entities) {
        if (entity.type === 'line') pen.lineTo([entity.end.x, entity.end.y]);
        else if (entity.type === 'arc') {
          const midAngle = (entity.startAngle + entity.endAngle) / 2;
          pen.threePointsArcTo([entity.end.x, entity.end.y], [entity.center.x + entity.radius * Math.cos(midAngle), entity.center.y + entity.radius * Math.sin(midAngle)]);
        } else throw new CadError('invalid-profile', 'Rounded rectangle boundaries must contain lines and circular arcs.');
      }
      return own(pen.close());
    }
    case 'circle': return own(own(drawCircle(profile.radius)).translate(profile.x, profile.y));
    case 'slot': {
      // The rectangle primitive cannot accept radius equal to half its shorter side.
      const halfStraight = (profile.length - profile.width) / 2;
      const radius = profile.width / 2;
      if (halfStraight === 0) return own(own(drawCircle(radius)).translate(profile.x, profile.y));
      const drawing = own(draw([-halfStraight, -radius]).lineTo([halfStraight, -radius])
        .threePointsArcTo([halfStraight, radius], [halfStraight + radius, 0])
        .lineTo([-halfStraight, radius]).threePointsArcTo([-halfStraight, -radius], [-halfStraight - radius, 0]).close());
      return own(own(drawing.rotate(profile.angle, [0, 0])).translate(profile.x, profile.y));
    }
    case 'polygon': {
      const first = profile.points[0];
      if (!first) throw new CadError('empty-profile', 'A polygon needs at least three points.');
      const pen = draw([first[0], first[1]]);
      for (const point of profile.points.slice(1)) pen.lineTo([point[0], point[1]]);
      return own(pen.close());
    }
    default: { const exhaustive: never = profile; throw new Error(`Unsupported profile: ${exhaustive}`); }
  }
}

function validateSolid(shape: Shape3D) {
  if (shape.isNull) throw new CadError('empty-solid', 'The operation produced no solid.');
  const solids = shape.solids;
  try {
    if (!solids.length || solids.some(solid => !Number.isFinite(measureVolume(solid)) || measureVolume(solid) <= 1e-9)) {
      throw new CadError('empty-solid', 'The operation must contain closed solids with positive volume.');
    }
  } finally { for (const solid of solids) solid.delete(); }
  const analyzer = new (getOC()).BRepCheck_Analyzer(shape.wrapped, true, false, false);
  try { if (!analyzer.IsValid()) throw new CadError('invalid-solid', 'OpenCascade rejected the resulting topology. Reduce the dimensions or choose a different feature.'); }
  finally { analyzer.delete(); }
  const volume = measureVolume(shape);
  if (!Number.isFinite(volume) || volume <= 1e-9) throw new CadError('empty-solid', 'The operation must produce a closed solid with positive volume.');
}

function shapeMesh(shape: Shape3D, feature: CadFeature): CadMesh {
  const mesh = shape.mesh(meshOptions);
  if (mesh.triangles.length > 3_000_000) throw new CadError('mesh-limit', 'The preview exceeds one million triangles. Simplify the model.');
  const box = shape.boundingBox;
  try {
    const [min, max] = box.bounds;
    return { featureId: feature.id, name: feature.name, positions: mesh.vertices, normals: mesh.normals, indices: mesh.triangles,
      edges: shape.meshEdges(meshOptions).lines, volume: measureVolume(shape), bounds: { min, max } };
  } finally { box.delete(); }
}

/** Operations commit only after exact topology validation and successful meshing. */
export function buildCadKernelModel(document: CadDocument): CadKernelModel {
  const started = performance.now();
  const shapes = new Set<Shape3D>();
  const bodies = new Map<string, { shape: Shape3D; feature: CadFeature; mesh: CadMesh; instances: number }>();
  const visible = new Set<string>();
  const sketches = new Map<string, CadSketchFeature>();
  const diagnostics: CadBuildResult['diagnostics'][number][] = [];
  const number = (value: CadScalar) => evaluateCadScalar(value, document.parameters);
  const own = (shape: Shape3D) => { shapes.add(shape); return shape; };
  const body = (id: string) => {
    const found = bodies.get(id);
    if (!found || !visible.has(id)) throw new CadError('missing-body', `Body ${id} is unavailable or has already been consumed. Choose a current body from the feature tree.`);
    return found.shape;
  };
  const instancesOf = (id: string) => bodies.get(id)?.instances ?? 1;
  const boundedInstances = (count: number) => {
    if (count > 1000) throw new CadError('instance-limit', 'Expanded nested patterns and Boolean operands may contain at most 1000 solid instances. Reduce the pattern counts.');
    return count;
  };
  function releaseTransientShapes() {
    const retained = new Set([...bodies.values()].map(item => item.shape));
    for (const shape of shapes) if (!retained.has(shape)) { shape.delete(); shapes.delete(shape); }
  }

  function fromSketch(feature: Extract<CadFeature, { kind: 'extrude' | 'revolve' }>): Shape3D {
    const sketch = sketches.get(feature.sketchId);
    if (!sketch) throw new CadError('missing-sketch', 'The source sketch is unavailable or suppressed.');
    const orientation = cadKernelPlaneBasis(sketch.plane);
    const offset = number(sketch.offset);
    const distance = feature.kind === 'extrude' ? number(feature.distance) : 0;
    const originOffset = offset - (feature.kind === 'extrude' && feature.symmetric ? distance / 2 : 0);
    const origin: SimplePoint = [orientation.normal[0] * originOffset, orientation.normal[1] * originOffset, orientation.normal[2] * originOffset];
    const plane = new Plane(origin, orientation.u, orientation.normal);
    const drawings: Drawing[] = [];
    const consumedSketches: Sketch[] = [];
    try {
      const contours = sketch.profiles.filter(profile => !profile.construction).map(profile => {
        const geometry = resolveCadProfile(profile.geometry, document.parameters);
        const drawing = profileDrawing(geometry, drawings);
        const [x, y] = drawing.blueprint.firstPoint;
        return { profile, geometry, drawing, point: { x, y } };
      });
      const nested = contours.map(contour => ({ ...contour, depth: contours.filter(other => other !== contour && cadProfileContainsPoint(other.geometry, contour.point)).length }));
      let result: Shape3D | undefined;
      for (const contour of nested.filter(item => item.profile.role === 'outer')) {
        const boundaries = [contour, ...nested.filter(item => item.profile.role === 'hole' && item.depth === contour.depth + 1 && cadProfileContainsPoint(contour.geometry, item.point))];
        const wires = boundaries.map(item => { const wire = item.drawing.blueprint.sketchOnPlane(plane); consumedSketches.push(wire); return wire; });
        const first = wires[0];
        if (!first) throw new CadError('empty-sketch', 'A solid feature needs a non-construction outer profile.');
        const sketched = wires.length === 1 ? first : new CompoundSketch(wires);
        const shape = own(feature.kind === 'extrude' ? sketched.extrude(distance) : sketched.revolve(feature.axis === 'x' ? orientation.u : orientation.v, { origin, angle: number(feature.angle) }));
        validateSolid(shape);
        result = result ? own(result.fuse(shape)) : shape;
      }
      if (!result) throw new CadError('empty-sketch', 'A solid feature needs at least one non-construction outer profile.');
      return result;
    } finally {
      for (const sketched of consumedSketches) sketched.delete();
      plane.delete();
      for (const drawing of drawings) drawing.blueprint.delete();
    }
  }

  for (const feature of document.features) {
    if (feature.suppressed) continue;
    try {
      let result: Shape3D;
      let instances = 1;
      const consumed: string[] = [];
      switch (feature.kind) {
        case 'sketch': sketches.set(feature.id, feature); continue;
        case 'extrude': case 'revolve': {
          instances = sketches.get(feature.sketchId)?.profiles.filter(profile => !profile.construction && profile.role === 'outer').length ?? 1;
          if (feature.targetId !== null) instances = boundedInstances(instances + instancesOf(feature.targetId));
          result = fromSketch(feature);
          if (feature.operation !== 'new') {
            if (!feature.targetId) throw new CadError('missing-target', 'Join and cut need a target body.');
            const target = body(feature.targetId);
            result = own(feature.operation === 'join' ? target.fuse(result) : target.cut(result));
            consumed.push(feature.targetId);
          }
          break;
        }
        case 'fillet': case 'chamfer': {
          const target = body(feature.targetId);
          instances = instancesOf(feature.targetId);
          result = own(feature.kind === 'fillet' ? target.fillet(number(feature.radius)) : target.chamfer(number(feature.radius)));
          consumed.push(feature.targetId); break;
        }
        case 'boolean': {
          const target = body(feature.targetId); const tool = body(feature.toolId);
          instances = boundedInstances(instancesOf(feature.targetId) + instancesOf(feature.toolId));
          result = own(feature.operation === 'union' ? target.fuse(tool) : feature.operation === 'cut' ? target.cut(tool) : target.intersect(tool));
          consumed.push(feature.targetId, feature.toolId); break;
        }
        case 'transform': {
          instances = instancesOf(feature.sourceId);
          result = own(body(feature.sourceId).clone());
          for (let axis = 0; axis < 3; axis++) {
            const angle = evaluateCadAngle(feature.rotation[axis], document.parameters);
            if (angle !== 0) result = own(result.rotate(angle, [0, 0, 0], axis === 0 ? [1, 0, 0] : axis === 1 ? [0, 1, 0] : [0, 0, 1]));
          }
          result = own(result.translate(number(feature.translation[0]), number(feature.translation[1]), number(feature.translation[2])));
          consumed.push(feature.sourceId); break;
        }
        case 'mirror': instances = instancesOf(feature.sourceId); result = own(own(body(feature.sourceId).clone()).mirror(feature.plane)); break;
        case 'linear-pattern': {
          if (!Number.isInteger(feature.count) || feature.count < 2 || feature.count > 100) throw new CadError('pattern-limit', 'Patterns require 2–100 instances.');
          const source = body(feature.sourceId);
          instances = boundedInstances(instancesOf(feature.sourceId) * feature.count);
          const spacing = feature.spacing.map(number);
          result = source;
          for (let index = 1; index < feature.count; index++) {
            const instance = own(own(source.clone()).translate(spacing[0] * index, spacing[1] * index, spacing[2] * index));
            result = own(result.fuse(instance));
          }
          consumed.push(feature.sourceId); break;
        }
        default: { const exhaustive: never = feature; throw new Error(`Unsupported feature: ${exhaustive}`); }
      }
      validateSolid(result);
      const mesh = shapeMesh(result, feature);
      const retainedScalars = [...bodies.entries()].reduce((total, [id, entry]) => total + (consumed.includes(id) ? 0 : cadMeshScalarCount(entry.mesh)), 0);
      if (retainedScalars + cadMeshScalarCount(mesh) > MAX_CAD_PREVIEW_SCALARS) throw new CadError('mesh-limit', 'The complete model exceeds the bounded preview buffer budget. Simplify the geometry or reduce body and pattern counts.');
      bodies.set(feature.id, { shape: result, feature, mesh, instances });
      for (const id of consumed) { visible.delete(id); bodies.delete(id); }
      visible.add(feature.id);
      releaseTransientShapes();
    } catch (error) {
      releaseTransientShapes();
      diagnostics.push({ code: error instanceof CadError ? error.code : 'kernel-operation-failed', featureId: feature.id,
        message: error instanceof Error ? error.message : 'OpenCascade could not construct this feature. Reduce its dimensions or revise the sketch.' });
      diagnostics.push({ code: 'rebuild-stopped', featureId: feature.id, message: 'Rebuild stopped here. The preview shows the preceding valid features; downstream features have not been evaluated.' });
      break;
    }
  }
  let disposed = false;
  return {
    result: { meshes: [...visible].flatMap(id => { const found = bodies.get(id); return found ? [found.mesh] : []; }), diagnostics, durationMs: performance.now() - started },
    export(format) {
      if (disposed) throw new Error('CAD model has been disposed.');
      if (diagnostics.length) throw new CadError('invalid-export', 'Fix the feature diagnostics before exporting. The retained preview is not the requested model.');
      const active = [...visible].flatMap(id => { const found = bodies.get(id); return found ? [found] : []; });
      if (!active.length) throw new CadError('empty-export', 'Create a valid solid before exporting.');
      if (format === 'step') return exportSTEP(active.map(({ shape, feature }) => ({ shape, name: feature.name })), { unit: 'MM', modelUnit: 'MM' });
      const compound = makeCompound(active.map(({ shape }) => shape));
      try { return compound.blobSTL({ ...meshOptions, binary: true }); } finally { compound.delete(); }
    },
    section(request) {
      if (disposed) throw new Error('CAD model has been disposed.');
      if (diagnostics.length) throw new CadError('invalid-section', 'Fix the model diagnostics before extracting a section. The retained preview is not the requested solid.');
      return sectionCadKernelShape(body(request.bodyId), { bodyId: request.bodyId, plane: request.plane, offset: number(request.offset) });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const shape of shapes) {
        // Replicad transforms consume their input wrapper; delete is idempotent.
        shape.delete();
      }
    }
  };
}
