import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { compileSimulation, sampleSimulation } from '@/domain/simulation';
import { polygonArea } from '@/domain/simulation/geometry';
import { setPathOperationClassification } from '@/domain/path-editor/pathDocumentOperations';
import { triangleModel } from '@/domain/simulation/machine-import/__tests__/machineTestModel';
import { createSimulationScene } from '../SimulationScene';

const state = vi.hoisted(() => ({
  failRender: false,
  renderers: [] as Array<{ dispose: ReturnType<typeof vi.fn>; domElement: HTMLCanvasElement }>,
  frames: [] as Array<{ scene: THREE.Scene; camera: THREE.PerspectiveCamera }>,
  observers: [] as Array<{ disconnect: ReturnType<typeof vi.fn> }>
}));

vi.mock('three/webgpu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three/webgpu')>();
  class Renderer {
    domElement = document.createElement('canvas');
    backend = { isWebGPUBackend: true };
    shadowMap = { enabled: false };
    init = vi.fn(async () => {});
    dispose = vi.fn(async () => {});
    setPixelRatio = vi.fn();
    setSize = vi.fn((width: number, height: number) => { this.domElement.width = width; this.domElement.height = height; });
    render = vi.fn((scene: THREE.Scene, camera: THREE.PerspectiveCamera) => {
      state.frames.push({ scene, camera });
      if (state.failRender) throw new Error('GPU setup failed');
    });
    constructor() { state.renderers.push(this); }
  }
  return { ...actual, WebGPURenderer: Renderer };
});

function plan(stockWidth = 40, guideRadiusMm = 2) {
  const source = createUpidFromDxfEntities([
    { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    { type: 'line', layer: 'CUT', start: { x: 20, y: 0 }, end: { x: 30, y: 0 } }
  ], { operationOrderStrategy: 'source-order' });
  source.geometryBasis = 'wire-centre';
  source.setup = { initialWirePosition: { kind: 'manual', point: { x: 0, y: 0 }, review: 'reviewed' },
    threadingDefault: { mode: 'manual', wireSeparation: 'manual-before-positioning' } };
  for (const operation of source.plan.operations) operation.transitions = {
    entry: { strategy: 'none', review: 'reviewed' }, exit: { strategy: 'none', review: 'reviewed' }
  };
  const result = compileSimulation(source, { stock: { originX: -5, originY: -5, width: stockWidth, depth: 20, thickness: 10, bottomZ: 0 },
    wireDiameter: 0.25, guideRadiusMm, cutSpeedMmPerSecond: 10, rapidSpeedMmPerSecond: 20 });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.plan;
}

function releasedPlan(supportFloorZ: number | null = -50, center = 0, radius = 5, hole = false) {
  let source = createUpidFromDxfEntities([
    { type: 'circle', layer: 'CUT', center: { x: center, y: center }, radius }
  ], { operationOrderStrategy: 'source-order' });
  if (hole) source = setPathOperationClassification(source, source.plan.operations[0].id, 'hole')!;
  source.geometryBasis = 'wire-centre';
  source.setup = { initialWirePosition: { kind: 'manual', point: { ...source.plan.operations[0].startPoint }, review: 'reviewed' },
    threadingDefault: { mode: 'manual', wireSeparation: 'manual-before-positioning' } };
  source.plan.operations[0].transitions = {
    entry: { strategy: 'none', review: 'reviewed' }, exit: { strategy: 'none', review: 'reviewed' }
  };
  const result = compileSimulation(source, { stock: { originX: center - radius * 2, originY: center - radius * 2, width: radius * 4, depth: radius * 4, thickness: 10, bottomZ: 0 },
    wireDiameter: 0.25, cutSpeedMmPerSecond: 10, rapidSpeedMmPerSecond: 20, supportFloorZ, guideClearanceMm: 20 });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.plan;
}

function boxCorners(bounds: THREE.Box3) {
  return [bounds.min.x, bounds.max.x].flatMap(x => [bounds.min.y, bounds.max.y]
    .flatMap(y => [bounds.min.z, bounds.max.z].map(z => new THREE.Vector3(x, y, z))));
}

function signedMeshVolume(geometry: THREE.BufferGeometry) {
  const positions = geometry.getAttribute('position');
  let volume = 0;
  for (let index = 0; index < positions.count; index += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(positions, index);
    const b = new THREE.Vector3().fromBufferAttribute(positions, index + 1);
    const c = new THREE.Vector3().fromBufferAttribute(positions, index + 2);
    volume += a.dot(b.cross(c)) / 6;
  }
  return volume;
}

function expectSimulationFramed(frame: { scene: THREE.Scene; camera: THREE.PerspectiveCamera }) {
  frame.scene.updateMatrixWorld(true); frame.camera.updateMatrixWorld(true);
  const objects: THREE.Mesh[] = [];
  frame.scene.traverse(object => {
    if (object instanceof THREE.Mesh && object.visible && (object.geometry instanceof THREE.ExtrudeGeometry
      || object.geometry instanceof THREE.CylinderGeometry || object.name === 'Clamp')) objects.push(object);
  });
  expect(objects.length).toBeGreaterThanOrEqual(4);
  for (const object of objects) for (const corner of boxCorners(new THREE.Box3().setFromObject(object))) {
    const projected = corner.project(frame.camera);
    expect(Math.abs(projected.x), `${object.geometry.type} horizontal fit`).toBeLessThan(0.94);
    expect(Math.abs(projected.y), `${object.geometry.type} vertical fit`).toBeLessThan(0.94);
    expect(projected.z).toBeGreaterThan(-1);
    expect(projected.z).toBeLessThan(1);
  }
}

function host(width = 300, height = 200) {
  const element = document.createElement('div'); document.body.append(element);
  Object.defineProperties(element, { clientWidth: { value: width }, clientHeight: { value: height } });
  return element;
}

describe('simulation scene resources', () => {
  beforeEach(() => {
    state.failRender = false; state.renderers = []; state.frames = []; state.observers = [];
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn(); disconnect = vi.fn();
      constructor() { state.observers.push(this); }
    });
  });
  afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('keeps five path draw objects and stable active geometry across playback and reverse seeking', async () => {
    const compiled = plan();
    const scene = await createSimulationScene(host(), compiled, new AbortController().signal);
    const drawnPaths: THREE.Line[] = [];
    state.frames.at(-1)!.scene.traverse(object => { if (object instanceof THREE.Line && object.renderOrder >= 2) drawnPaths.push(object); });
    expect(drawnPaths).toHaveLength(5);
    const active = drawnPaths.find(line => line.renderOrder === 4)!;
    const geometry = active.geometry;
    const dispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    scene.update(sampleSimulation(compiled, 0.25));
    scene.update(sampleSimulation(compiled, 0.75));
    scene.update(sampleSimulation(compiled, 0.1));
    expect(active.geometry).toBe(geometry);
    expect(dispose).not.toHaveBeenCalled();
    expect(active.geometry.getAttribute('position').getX(1) + active.position.x).toBeCloseTo(1);
    scene.dispose(); scene.dispose();
    expect(state.renderers[0].dispose).toHaveBeenCalledOnce();
    expect(state.observers[0].disconnect).toHaveBeenCalledOnce();
    expect(state.renderers[0].domElement.isConnected).toBe(false);
  });

  it('removes the canvas and releases scene resources when setup fails after renderer initialization', async () => {
    state.failRender = true;
    const element = host();
    const release = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    await expect(createSimulationScene(element, plan(), new AbortController().signal)).rejects.toThrow('GPU setup failed');
    expect(element.querySelector('canvas')).toBeNull();
    expect(release).toHaveBeenCalled();
    expect(state.renderers[0].dispose).toHaveBeenCalledOnce();
    expect(state.observers[0].disconnect).toHaveBeenCalledOnce();
  });

  it('disposes an initialized renderer if creation was cancelled before attaching it', async () => {
    const element = host();
    await expect(createSimulationScene(element, plan(), AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' });
    expect(element.querySelector('canvas')).toBeNull();
    expect(state.renderers[0].dispose).toHaveBeenCalledOnce();
    expect(state.observers).toHaveLength(0);
  });

  it('fits the transformed machine together with stock and hides it without replacing mesh resources', async () => {
    const scene = await createSimulationScene(host(), plan(), new AbortController().signal);
    scene.setMachine(triangleModel(), { x: 10_000, y: 0, z: 0, rotation: 90 });
    const frame = state.frames.at(-1)!;
    const machine = frame.scene.getObjectByName('Clamp')!;
    expect(machine).toBeDefined();
    scene.fitMachine();
    expect(frame.camera.position.length()).toBeGreaterThan(10_000);
    expect(frame.camera.far).toBeGreaterThan(10_000);
    scene.update(sampleSimulation(plan(), 0));
    expectSimulationFramed(frame);
    scene.setMachineVisible(false);
    expect(machine.parent!.visible).toBe(false);
    scene.setMachineVisible(true);
    expect(frame.scene.getObjectByName('Clamp')).toBe(machine);
    scene.dispose();
  });

  it.each([[1200, 650], [450, 800]])('keeps the complete wire, both guides and supported slug in view at %sx%s', async (width, height) => {
    const compiled = releasedPlan();
    const scene = await createSimulationScene(host(width, height), compiled, new AbortController().signal);
    const end = sampleSimulation(compiled, compiled.durationSeconds);
    expect(end.pieces).toMatchObject([{ state: 'supported', bottomZ: -50 }]);
    scene.update(end);
    // Initial framing must already include the full fall, without pressing fit after playback.
    expectSimulationFramed(state.frames.at(-1)!);
    for (const view of ['front', 'top', 'isometric'] as const) {
      scene.setView(view);
      expectSimulationFramed(state.frames.at(-1)!);
    }
    scene.dispose();
  });

  it('keeps the top view useful when the support floor is far below the stock', async () => {
    const spans: number[] = [];
    for (const supportFloorZ of [-50, -1000]) {
      const compiled = releasedPlan(supportFloorZ);
      const scene = await createSimulationScene(host(600, 400), compiled, new AbortController().signal);
      scene.update(sampleSimulation(compiled, compiled.durationSeconds));
      scene.setView('top');
      const frame = state.frames.at(-1)!;
      expectSimulationFramed(frame);
      const points = boxCorners(new THREE.Box3(new THREE.Vector3(-10, -10, 0), new THREE.Vector3(10, 10, 10)))
        .map(point => point.project(frame.camera));
      spans.push(Math.max(...points.map(point => point.x)) - Math.min(...points.map(point => point.x)));
      scene.dispose();
    }
    expect(spans[1] / spans[0]).toBeGreaterThan(0.95);
  });

  it.each([[true, true], [true, false], [false, true], [false, false]])('conserves retained material without overlapping caps, clockwise outer=%s hole=%s', async (outerClockwise, innerClockwise) => {
    const source = createUpidFromDxfEntities([2, 5].map((radius, index) => ({
      type: 'arc' as const, layer: 'CUT', center: { x: 0, y: 0 }, radius,
      start: { x: radius, y: 0 }, end: { x: radius, y: 0 }, startAngle: 0, endAngle: (index ? outerClockwise : innerClockwise) ? -360 : 360,
      sweepRadians: ((index ? outerClockwise : innerClockwise) ? -1 : 1) * Math.PI * 2, clockwise: index ? outerClockwise : innerClockwise
    })), { operationOrderStrategy: 'source-order' });
    source.geometryBasis = 'wire-centre';
    source.setup = { initialWirePosition: { kind: 'manual', point: { ...source.plan.operations[0].startPoint }, review: 'reviewed' },
      threadingDefault: { mode: 'manual', wireSeparation: 'manual-before-positioning' } };
    for (const operation of source.plan.operations) operation.transitions = {
      entry: { strategy: 'none', review: 'reviewed' }, exit: { strategy: 'none', review: 'reviewed' }
    };
    const result = compileSimulation(source, { stock: { originX: -10, originY: -10, width: 20, depth: 20, thickness: 10, bottomZ: 0 },
      wireDiameter: 0.25, cutSpeedMmPerSecond: 10, rapidSpeedMmPerSecond: 20, retention: 'retain', wasteHandling: 'keep' });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const end = sampleSimulation(result.plan, result.plan.durationSeconds);
    expect(end.pieces).toHaveLength(2);
    const scene = await createSimulationScene(host(), result.plan, new AbortController().signal);
    scene.setPresentation({ showStock: true, showWaste: true, finalPartOnly: false });
    scene.update(end);
    const extrusions: THREE.Mesh<THREE.ExtrudeGeometry>[] = [];
    state.frames.at(-1)!.scene.traverse(object => {
      if (object instanceof THREE.Mesh && object.geometry instanceof THREE.ExtrudeGeometry) extrusions.push(object);
    });
    expect(extrusions).toHaveLength(3);
    for (const mesh of extrusions) {
      const shape = mesh.geometry.parameters.shapes as THREE.Shape;
      const points = shape.extractPoints(1);
      const area = polygonArea(points.shape) - points.holes.reduce((sum, hole) => sum + polygonArea(hole), 0);
      expect(signedMeshVolume(mesh.geometry)).toBeCloseTo(area * 10, 3);
    }
    expect(extrusions.reduce((total, mesh) => total + signedMeshVolume(mesh.geometry), 0)).toBeCloseTo(4000, 3);
    const checkCapCoverage = () => {
      state.frames.at(-1)!.scene.updateMatrixWorld(true);
      for (const [x, y] of [[0.37, 0.29], [3.1, 0.77], [8, 0.3]]) {
        const ray = new THREE.Raycaster(new THREE.Vector3(x, y, 100), new THREE.Vector3(0, 0, -1));
        const hits = ray.intersectObjects(extrusions.filter(mesh => mesh.visible), false);
        expect(hits).toHaveLength(1);
        expect(hits[0].point.z).toBeCloseTo(10);
      }
    };
    checkCapCoverage();
    scene.update(sampleSimulation(result.plan, 0));
    checkCapCoverage();
    scene.update(end);
    checkCapCoverage();
    scene.dispose();
  });

  it('outlines stock corners and circular hole rims without outlining each curved-wall facet', async () => {
    const compiled = releasedPlan();
    const scene = await createSimulationScene(host(), compiled, new AbortController().signal);
    const body = state.frames.at(-1)!.scene.children.find(object =>
      object instanceof THREE.Mesh && object.geometry instanceof THREE.ExtrudeGeometry) as THREE.Mesh;
    const outline = body.children.find(object => object instanceof THREE.LineSegments) as THREE.LineSegments;
    const initial = sampleSimulation(compiled, 0);
    const end = sampleSimulation(compiled, compiled.durationSeconds);
    const rimVertexCount = new Set(end.stockHoles[0].map(point => `${point.x.toFixed(6)},${point.y.toFixed(6)}`)).size;
    expect(outline.geometry.getAttribute('position').count).toBe(24);

    for (let pass = 0; pass < 2; pass++) {
      scene.update(end);
      const positions = outline.geometry.getAttribute('position');
      const verticalEdges: THREE.Vector3[][] = [];
      const rims = new Map([[0, 0], [10, 0]]);
      for (let index = 0; index < positions.count; index += 2) {
        const from = new THREE.Vector3().fromBufferAttribute(positions, index);
        const to = new THREE.Vector3().fromBufferAttribute(positions, index + 1);
        if (Math.abs(from.z - to.z) > 9) verticalEdges.push([from, to]);
        else if (Math.abs(Math.hypot(from.x, from.y) - 5) < 1e-5 &&
          Math.abs(Math.hypot(to.x, to.y) - 5) < 1e-5) rims.set(from.z, (rims.get(from.z) ?? 0) + 1);
      }
      expect(verticalEdges).toHaveLength(4);
      for (const edge of verticalEdges) for (const point of edge) {
        expect(Math.abs(point.x)).toBe(10);
        expect(Math.abs(point.y)).toBe(10);
      }
      expect(rims.get(0)).toBe(rimVertexCount);
      expect(rims.get(10)).toBe(rimVertexCount);
      scene.update(initial);
      expect(outline.geometry.getAttribute('position').count).toBe(24);
    }
    scene.dispose();
  });

  it('uses one finite grid surface at the support elevation, with local disposable lighting and view-dependent clipping', async () => {
    const compiled = releasedPlan(-20);
    const scene = await createSimulationScene(host(1200, 650), compiled, new AbortController().signal);
    scene.update(sampleSimulation(compiled, 0));
    const frame = state.frames.at(-1)!;
    const table = frame.scene.getObjectByName('table')!;
    const grid = frame.scene.getObjectByName('grid') as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
    expect(table.children).toEqual([grid]);
    expect(grid.position.z).toBe(-20);
    expect(grid.geometry.parameters.width).toBe(40);
    expect(grid.geometry.parameters.height).toBe(40);
    expect(grid.material).toMatchObject({ depthWrite: false, side: THREE.DoubleSide });
    expect(grid.material.opacity).toBeLessThan(1);
    expect(grid.material.map!.generateMipmaps).toBe(true);
    const environment = frame.scene.environment!;
    const environmentDispose = vi.spyOn(environment, 'dispose');
    const gridDispose = vi.spyOn(grid.material.map!, 'dispose');
    for (const view of ['isometric', 'top', 'front'] as const) {
      scene.setView(view);
      expect(frame.camera.far / frame.camera.near).toBeLessThan(10_000);
      expect(table.visible).toBe(true);
    }
    scene.dispose(); scene.dispose();
    expect(environmentDispose).toHaveBeenCalledOnce(); expect(gridDispose).toHaveBeenCalledOnce();

    const unsupported = await createSimulationScene(host(), releasedPlan(null), new AbortController().signal);
    expect(state.frames.at(-1)!.scene.getObjectByName('table')!.visible).toBe(false);
    unsupported.dispose();
  });

  it('inspects final material before playback at authored elevation and restores the process view and visibility', async () => {
    const compiled = releasedPlan();
    expect(compiled.finalMaterial).toMatchObject({ status: 'ready', solids: [{ kind: 'piece', bottomZ: 0 }] });
    const scene = await createSimulationScene(host(800, 500), compiled, new AbortController().signal);
    scene.setMachine(triangleModel(), { x: 0, y: 0, z: 0, rotation: 0 });
    scene.update(sampleSimulation(compiled, 0));
    const frame = state.frames.at(-1)!;
    const processPosition = frame.camera.position.clone();
    const processQuaternion = frame.camera.quaternion.clone();
    scene.setPresentation({ showStock: false, showWaste: false, finalPartOnly: true });
    const visibleMeshes = () => {
      const meshes: THREE.Mesh[] = [];
      frame.scene.traverseVisible(object => { if (object instanceof THREE.Mesh) meshes.push(object); });
      return meshes;
    };
    expect(visibleMeshes().map(mesh => mesh.name)).toEqual(['finished-part']);
    const finished = visibleMeshes()[0];
    frame.scene.updateMatrixWorld(true);
    expect(new THREE.Box3().setFromObject(finished).min.z).toBe(0);
    for (const view of ['top', 'front', 'isometric'] as const) {
      scene.setView(view); frame.camera.updateMatrixWorld(true);
      for (const corner of boxCorners(new THREE.Box3().setFromObject(finished))) {
        const projected = corner.project(frame.camera);
        expect(Math.abs(projected.x)).toBeLessThan(0.94); expect(Math.abs(projected.y)).toBeLessThan(0.94);
        expect(projected.z).toBeGreaterThan(-1); expect(projected.z).toBeLessThan(1);
      }
    }
    scene.update(sampleSimulation(compiled, Infinity));
    expect(visibleMeshes()).toEqual([finished]);
    expect(finished.position.z).toBe(0);
    scene.setPresentation({ showStock: false, showWaste: false, finalPartOnly: false });
    expect(frame.camera.position.distanceTo(processPosition)).toBeLessThan(1e-9);
    expect(frame.camera.quaternion.angleTo(processQuaternion)).toBeLessThan(1e-7);
    expect(frame.scene.getObjectByName('stock')!.visible).toBe(false);
    expect(frame.scene.getObjectByName('machine')!.visible).toBe(true);
    expect(visibleMeshes().find(mesh => mesh.name === 'finished-part')!.position.z).toBe(-50);
    scene.dispose();
  });

  it('shows final remaining plate for a hole-only job while hiding waste, and never fabricates material for an open contour', async () => {
    const compiled = releasedPlan(-20, 0, 5, true);
    expect(compiled.finalMaterial.solids[0].kind).toBe('remaining-stock');
    const scene = await createSimulationScene(host(), compiled, new AbortController().signal);
    scene.update(sampleSimulation(compiled, compiled.pieces[0].releaseSeconds + 0.01));
    const frame = state.frames.at(-1)!;
    const waste = frame.scene.getObjectByName('waste')!;
    expect(waste.visible).toBe(false);
    scene.setPresentation({ showStock: true, showWaste: true, finalPartOnly: false });
    expect(waste.visible).toBe(true);
    scene.setPresentation({ showStock: true, showWaste: false, finalPartOnly: true });
    const final = frame.scene.getObjectByName('final-material')!.children[0] as THREE.Mesh<THREE.ExtrudeGeometry>;
    frame.scene.updateMatrixWorld(true);
    expect((final.geometry.parameters.shapes as THREE.Shape).holes).toHaveLength(1);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 100), new THREE.Vector3(0, 0, -1));
    expect(ray.intersectObject(final)).toHaveLength(0);
    ray.ray.origin.x = 8;
    expect(ray.intersectObject(final)).toHaveLength(1);
    scene.dispose();

    const open = await createSimulationScene(host(), plan(), new AbortController().signal);
    const openFrame = state.frames.at(-1)!;
    const originalPosition = openFrame.camera.position.clone();
    open.setPresentation({ showStock: true, showWaste: false, finalPartOnly: true }); open.fitPart();
    expect(openFrame.scene.getObjectByName('final-material')!.children).toHaveLength(0);
    expect(openFrame.camera.position).toEqual(originalPosition);
    open.dispose();
  });

  it.each([40, 10_000])('keeps the physical wire and guide envelope independent of stock width %s', async stockWidth => {
    const compiled = plan(stockWidth);
    const scene = await createSimulationScene(host(), compiled, new AbortController().signal);
    const snapshot = sampleSimulation(compiled, 0);
    scene.update(snapshot);
    const frame = state.frames.at(-1)!;
    frame.scene.updateMatrixWorld(true);
    const wire = frame.scene.getObjectByName('wire') as THREE.Mesh<THREE.CylinderGeometry>;
    expect(wire.geometry.parameters.radiusTop).toBe(0.125);
    expect(wire.geometry.parameters.radiusBottom).toBe(0.125);
    const wireSize = new THREE.Box3().setFromObject(wire).getSize(new THREE.Vector3());
    expect(wireSize.x).toBeCloseTo(0.25, 6); expect(wireSize.y).toBeCloseTo(0.25, 6);
    expect(wireSize.z).toBeCloseTo(snapshot.wire.topZ - snapshot.wire.bottomZ, 6);
    for (const name of ['upper-guide', 'lower-guide']) {
      const guide = frame.scene.getObjectByName(name) as THREE.Mesh<THREE.CylinderGeometry>;
      expect(Math.max(guide.geometry.parameters.radiusTop, guide.geometry.parameters.radiusBottom)).toBe(2);
      const dimensions = new THREE.Box3().setFromObject(guide).getSize(new THREE.Vector3());
      expect(dimensions.x).toBeCloseTo(4, 6); expect(dimensions.y).toBeCloseTo(4, 6); expect(dimensions.z).toBeCloseTo(4, 6);
    }
    scene.dispose();
  });

  it('hides disabled guide envelopes throughout process and final presentation changes', async () => {
    const compiled = plan(10_000, 0);
    const scene = await createSimulationScene(host(), compiled, new AbortController().signal);
    scene.update(sampleSimulation(compiled, 0));
    const frame = state.frames.at(-1)!;
    for (const finalPartOnly of [false, true, false]) {
      scene.setPresentation({ showStock: true, showWaste: true, finalPartOnly });
      expect(frame.scene.getObjectByName('upper-guide')!.visible).toBe(false);
      expect(frame.scene.getObjectByName('lower-guide')!.visible).toBe(false);
    }
    scene.dispose();
  });

  it('preserves small STEP features at large valid CAD offsets', async () => {
    const scene = await createSimulationScene(host(), plan(), new AbortController().signal);
    const model = triangleModel([[999999, 0, 0], [999999.02, 0, 0], [999999, 0.02, 0]]);
    scene.setMachine(model, { x: -999999, y: 0, z: 0, rotation: 0 });
    const frame = state.frames.at(-1)!;
    frame.scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(frame.scene.getObjectByName('Clamp')!);
    expect(bounds.getSize(new THREE.Vector3()).x).toBeCloseTo(0.02, 6);
    expect(bounds.min.x).toBeCloseTo(0, 6);
    scene.dispose();
  });

  it('preserves stock dimensions at large valid job coordinates', async () => {
    const compiled = releasedPlan(-50, 999999, 0.1);
    const scene = await createSimulationScene(host(), compiled, new AbortController().signal);
    const frame = state.frames.at(-1)!;
    frame.scene.updateMatrixWorld(true);
    const stock = frame.scene.children.find(object => object instanceof THREE.Mesh && object.geometry instanceof THREE.ExtrudeGeometry)!;
    const bounds = new THREE.Box3().setFromObject(stock);
    expect(bounds.getSize(new THREE.Vector3()).x).toBeCloseTo(0.4, 6);
    expect(bounds.getSize(new THREE.Vector3()).y).toBeCloseTo(0.4, 6);
    expect(bounds.min.x).toBeCloseTo(999998.8, 6);
    scene.dispose();
  });
});
