import { CompoundSketch, exportSTEP, getOC, makeCompound, measureVolume, Plane, type Drawing, type Shape3D, type SimplePoint, type Sketch } from 'replicad';
import type { CadBuildResult, CadDocument, CadFeature, CadMesh, CadScalar, CadSketchFeature } from '../../../domain/cad/cadDocument';
import { evaluateCadAngle, evaluateCadScalar } from '../../../domain/cad/cadExpression';
import { CadError } from '../../../domain/cad/cadError';
import { resolveCadSketchRegions } from '../../../domain/cad/cadSketchGeometry';
import type { CadSectionRequest, CadSectionResult } from '../../../domain/cad/cadSection';
import { cadKernelPlaneBasis } from './cadKernelPlane';
import { cadKernelProfileDrawing } from './cadKernelSketch';
import { sectionCadKernelShape } from './cadKernelSection';
import { cadMeshScalarCount, MAX_CAD_PREVIEW_SCALARS } from './cadKernelLimits';
import { CadKernelTopology } from './cadKernelTopology';
import { applyCadEdgeOperation, applyCadShell } from './cadKernelOperations';
import { loadCadSolidImport } from './cadKernelImport';
import { resolveCadCircularPattern } from '../../../domain/cad/cadPatterns';
import { resolveCadLoftSections } from '../../../domain/cad/cadLoft';
import { buildCadLoftSolid } from './cadKernelLoft';
import { resolveCadSweepInputs } from '../../../domain/cad/cadSweep';
import { buildCadSweepSolid } from './cadKernelSweep';
import { resolveCadPocketInputs } from '../../../domain/cad/cadPocket';
import { buildCadPocketCut } from './cadKernelPocket';
import { meshCadKernelPreview } from './cadKernelMeshing';
import { MAX_CAD_TOPOLOGY_ELEMENTS, parseCadTopologyInspectRequest, parseCadTopologyResolvePicksRequest, type CadTopologyInspectRequest, type CadTopologyInspectResult,
  type CadTopologyResolvePicksRequest, type CadTopologyResolvePicksResult } from '../../../domain/cad/cadTopology';

/** BRep state stays inside the worker. Only tessellation and export bytes leave it. */
export interface CadKernelModel {
  readonly result: CadBuildResult;
  export(format: 'step' | 'stl'): Blob;
  section(request: CadSectionRequest): CadSectionResult;
  inspectTopology(request: CadTopologyInspectRequest): CadTopologyInspectResult;
  resolveTopologyPicks(request: CadTopologyResolvePicksRequest): CadTopologyResolvePicksResult;
  dispose(): void;
}

const meshOptions = { tolerance: 0.05, angularTolerance: 0.15 };

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

function shapeMesh(shape: Shape3D, feature: CadFeature, topology: CadKernelTopology): CadMesh {
  const box = shape.boundingBox;
  try {
    const [min, max] = box.bounds;
    const { mesh, edgeMesh } = meshCadKernelPreview(shape, { min, max }, meshOptions);
    return { featureId: feature.id, name: feature.name, positions: mesh.vertices, normals: mesh.normals, indices: mesh.triangles,
      edges: edgeMesh.lines, ...topology.meshGroups(mesh, edgeMesh), volume: measureVolume(shape), bounds: { min, max } };
  } finally { box.delete(); }
}

/** Operations commit only after exact topology validation and successful meshing. */
export function buildCadKernelModel(document: CadDocument): CadKernelModel {
  const started = performance.now();
  const buildId = crypto.randomUUID();
  const shapes = new Set<Shape3D>();
  const bodies = new Map<string, { shape: Shape3D; feature: CadFeature; mesh: CadMesh; instances: number; topology: CadKernelTopology }>();
  const visible = new Set<string>();
  const sketches = new Map<string, CadSketchFeature>();
  const references = new Map<string, CadFeature>();
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
      const regions = resolveCadSketchRegions(sketch, document.parameters);
      let result: Shape3D | undefined;
      for (const region of regions) {
        const boundaries = [region.boundary, ...region.voids];
        const wires = boundaries.map(item => { const drawing = cadKernelProfileDrawing(item.geometry, drawings); const wire = drawing.blueprint.sketchOnPlane(plane); consumedSketches.push(wire); return wire; });
        const first = wires[0];
        if (!first) throw new CadError('empty-sketch', 'A solid feature needs a closed non-construction profile.');
        const sketched = wires.length === 1 ? first : new CompoundSketch(wires);
        const shape = own(feature.kind === 'extrude' ? sketched.extrude(distance) : sketched.revolve(feature.axis === 'x' ? orientation.u : orientation.v, { origin, angle: number(feature.angle) }));
        validateSolid(shape);
        result = result ? own(result.fuse(shape)) : shape;
      }
      if (!result) throw new CadError('empty-sketch', 'A solid feature needs at least one closed non-construction profile.');
      return result;
    } finally {
      for (const sketched of consumedSketches) sketched.delete();
      plane.delete();
      for (const drawing of drawings) drawing.blueprint.delete();
    }
  }

  for (const [featureIndex, feature] of document.features.entries()) {
    if (feature.suppressed) continue;
    try {
      let result: Shape3D;
      let instances = 1;
      const consumed: string[] = [];
      switch (feature.kind) {
        case 'sketch': sketches.set(feature.id, feature); references.set(feature.id, feature); continue;
        case 'curve': references.set(feature.id, feature); continue; // Exact reference geometry produces and consumes no native body.
        case 'imported': {
          const imported = loadCadSolidImport(feature.source);
          result = own(imported.shape); instances = boundedInstances(imported.analysis.solidCount); break;
        }
        case 'extrude': case 'revolve': {
          const sourceSketch = sketches.get(feature.sketchId);
          instances = sourceSketch ? resolveCadSketchRegions(sourceSketch, document.parameters).length : 1;
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
        case 'loft': {
          const sections = resolveCadLoftSections(feature, sketches, document.parameters);
          if (feature.operation !== 'new') {
            if (!feature.targetId) throw new CadError('missing-target', 'Join and cut need a target body.');
            const target = body(feature.targetId);
            instances = boundedInstances(1 + instancesOf(feature.targetId));
            const loft = own(buildCadLoftSolid(sections, feature.ruled));
            result = own(feature.operation === 'join' ? target.fuse(loft) : target.cut(loft));
            consumed.push(feature.targetId);
          } else result = own(buildCadLoftSolid(sections, feature.ruled));
          break;
        }
        case 'sweep': {
          const inputs = resolveCadSweepInputs(feature, references, document.parameters);
          if (feature.operation !== 'new') {
            if (!feature.targetId) throw new CadError('missing-target', 'Join and cut need a target body.');
            const target = body(feature.targetId);
            instances = boundedInstances(1 + instancesOf(feature.targetId));
            const sweep = own(buildCadSweepSolid(inputs));
            result = own(feature.operation === 'join' ? target.fuse(sweep) : target.cut(sweep));
            consumed.push(feature.targetId);
          } else result = own(buildCadSweepSolid(inputs));
          break;
        }
        case 'pocket': {
          const target = body(feature.targetId);
          const prefix = new Map(document.features.slice(0, featureIndex).map(entry => [entry.id, entry]));
          const inputs = resolveCadPocketInputs(feature, prefix, document.parameters);
          instances = boundedInstances(inputs.regionCount + instancesOf(feature.targetId));
          result = own(buildCadPocketCut(target, inputs)); consumed.push(feature.targetId); break;
        }
        case 'fillet': case 'chamfer': {
          const target = body(feature.targetId);
          instances = instancesOf(feature.targetId);
          const topology = bodies.get(feature.targetId)?.topology;
          if (!topology) throw new CadError('missing-body', 'The selected target body is unavailable.');
          result = own(feature.selection ? applyCadEdgeOperation(target, topology.selectedEdges(feature.selection, document.parameters), feature.kind, number(feature.radius))
            : feature.kind === 'fillet' ? target.fillet(number(feature.radius)) : target.chamfer(number(feature.radius)));
          consumed.push(feature.targetId); break;
        }
        case 'shell': {
          const target = body(feature.targetId); const topology = bodies.get(feature.targetId)?.topology;
          if (!topology) throw new CadError('missing-body', 'The shell target body is unavailable.');
          instances = instancesOf(feature.targetId);
          result = own(applyCadShell(target, topology.selectedFace(feature.opening, document.parameters), number(feature.thickness)));
          if (!(measureVolume(result) < measureVolume(target) - 1e-9)) throw new CadError('shell-failed', 'The inward shell did not remove material. Reduce its thickness or choose another opening.');
          const originalBox = target.boundingBox; const shellBox = result.boundingBox;
          try {
            const [originalMin, originalMax] = originalBox.bounds; const [shellMin, shellMax] = shellBox.bounds;
            if (shellMin.some((value, axis) => value < originalMin[axis] - 1e-6) || shellMax.some((value, axis) => value > originalMax[axis] + 1e-6)) {
              throw new CadError('shell-failed', 'The kernel shell extended outside the original body instead of producing inward walls.');
            }
          } finally { originalBox.delete(); shellBox.delete(); }
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
            const clone = own(source.clone());
            const instance = own(clone.translate(spacing[0] * index, spacing[1] * index, spacing[2] * index));
            // Translation consumes its input wrapper. Keep the original seed
            // and current union while building, just as for circular patterns.
            shapes.delete(clone);
            const previous = result;
            result = own(previous.fuse(instance));
            instance.delete(); shapes.delete(instance);
            if (previous !== source) { previous.delete(); shapes.delete(previous); }
          }
          consumed.push(feature.sourceId); break;
        }
        case 'circular-pattern': {
          const pattern = resolveCadCircularPattern(feature, document.parameters);
          const source = body(feature.sourceId);
          instances = boundedInstances(instancesOf(feature.sourceId) * pattern.count);
          const center: SimplePoint = [...pattern.center]; const direction: SimplePoint = [...pattern.direction];
          result = source;
          for (const angle of pattern.angles.slice(1)) {
            const clone = own(source.clone());
            const instance = own(clone.rotate(angle, center, direction));
            // Replicad rotations consume their input wrapper. Keep only the
            // original seed and current union while constructing the pattern.
            shapes.delete(clone);
            const previous = result;
            result = own(previous.fuse(instance));
            instance.delete(); shapes.delete(instance);
            if (previous !== source) { previous.delete(); shapes.delete(previous); }
          }
          consumed.push(feature.sourceId); break;
        }
        default: { const exhaustive: never = feature; throw new Error(`Unsupported feature: ${exhaustive}`); }
      }
      validateSolid(result);
      const topology = new CadKernelTopology(result);
      try {
        const retainedTopology = [...bodies.entries()].reduce((total, [id, entry]) => total + (consumed.includes(id) ? 0 : entry.topology.count), 0);
        if (retainedTopology + topology.count > MAX_CAD_TOPOLOGY_ELEMENTS) throw new CadError('topology-limit', `The complete model may contain at most ${MAX_CAD_TOPOLOGY_ELEMENTS} distinct faces and edges. Simplify the model.`);
        const mesh = shapeMesh(result, feature, topology);
        const retainedScalars = [...bodies.entries()].reduce((total, [id, entry]) => total + (consumed.includes(id) ? 0 : cadMeshScalarCount(entry.mesh)), 0);
        if (retainedScalars + cadMeshScalarCount(mesh) > MAX_CAD_PREVIEW_SCALARS) throw new CadError('mesh-limit', 'The complete model exceeds the bounded preview buffer budget. Simplify the geometry or reduce body and pattern counts.');
        for (const id of consumed) { visible.delete(id); bodies.get(id)?.topology.dispose(); bodies.delete(id); }
        bodies.set(feature.id, { shape: result, feature, mesh, instances, topology });
      } catch (error) { topology.dispose(); throw error; }
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
    result: { buildId, meshes: [...visible].flatMap(id => { const found = bodies.get(id); return found ? [found.mesh] : []; }), diagnostics, durationMs: performance.now() - started },
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
    inspectTopology(request) {
      const parsed = parseCadTopologyInspectRequest(request);
      if (disposed || parsed.expectedBuildId !== buildId) throw new CadError('STALE_BUILD', 'The topology snapshot is stale. Rebuild the current document and select again.');
      body(parsed.bodyId);
      const topology = bodies.get(parsed.bodyId)?.topology;
      if (!topology) throw new CadError('missing-body', 'The topology body is unavailable.');
      return topology.inspect(parsed, buildId);
    },
    resolveTopologyPicks(request) {
      const parsed = parseCadTopologyResolvePicksRequest(request);
      if (disposed || parsed.expectedBuildId !== buildId) throw new CadError('STALE_BUILD', 'The topology snapshot is stale. Rebuild the current document and select again.');
      if (diagnostics.length) throw new CadError('invalid-selection', 'Fix the feature diagnostics before applying a topology selection.');
      body(parsed.bodyId);
      const topology = bodies.get(parsed.bodyId)?.topology;
      if (!topology) throw new CadError('missing-body', 'The selected topology body is unavailable.');
      return topology.resolvePicks(parsed, buildId, document.parameters);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const entry of bodies.values()) entry.topology.dispose();
      for (const shape of shapes) {
        // Replicad transforms consume their input wrapper; delete is idempotent.
        shape.delete();
      }
    }
  };
}
