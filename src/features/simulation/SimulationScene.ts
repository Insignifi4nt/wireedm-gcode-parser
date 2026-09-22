import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Point2 } from '@/domain/path-intel/types';
import { sampleSimulation, type SimulationPlan, type SimulationSnapshot } from '@/domain/simulation';
import { arcSweep } from '@/domain/simulation/geometry';
import type { MachineModel } from '@/domain/simulation/machine-import';
import { captureCanvas } from '@/features/editor/captureEditorPreview';
import type { EditorPreviewCapture } from '@/features/webmcp/previewCapture';
import { createSimulationPathBuffers, updateActiveSimulationPath } from './simulationPathBuffers';
import { createMachineSurfacePalette } from './machineSurfacePalette';
import { createStudioEnvironment, createSupportGridTexture, smoothExtrudedWalls } from './simulationSurfaceAppearance';

// Arc tessellation changes the wall normal by only 2°; outline actual creases and cap rims.
const STOCK_OUTLINE_THRESHOLD_DEGREES = 25;

export interface SceneMachinePlacement { x: number; y: number; z: number; rotation: number }
export interface ScenePresentation { showWaste: boolean; showStock: boolean; finalPartOnly: boolean }
export interface SimulationScene {
  update(snapshot: SimulationSnapshot): void;
  setMachine(model: MachineModel | null, placement: SceneMachinePlacement): void;
  setMachineVisible(visible: boolean): void;
  setPresentation(presentation: ScenePresentation): void;
  fitPart(): void;
  fitMachine(): void;
  setView(view: 'isometric' | 'top' | 'front'): void;
  capture(signal: AbortSignal): Promise<EditorPreviewCapture>;
  dispose(): void;
  readonly backend: 'WebGPU' | 'WebGL2';
}

function polygonShape(polygon: readonly Point2[], holes: readonly (readonly Point2[])[], origin: Point2) {
  const contour = polygon.map(point => new THREE.Vector2(point.x - origin.x, point.y - origin.y));
  if (!THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
  const shape = new THREE.Shape(contour);
  shape.holes = holes.map(hole => {
    const points = hole.map(point => new THREE.Vector2(point.x - origin.x, point.y - origin.y));
    // ExtrudeGeometry does not normalize holes when its outer contour is already clockwise.
    if (THREE.ShapeUtils.isClockWise(points)) points.reverse();
    return new THREE.Path(points);
  });
  return shape;
}

function releaseObject(object: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  object.traverse(child => {
    if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments || child instanceof THREE.Line) {
      geometries.add(child.geometry);
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) materials.add(material);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

/** One scene owns its GPU resources. Playback consumes the pure UPID simulator's snapshots. */
export async function createSimulationScene(
  host: HTMLElement, plan: SimulationPlan, signal: AbortSignal
): Promise<SimulationScene> {
  const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: false });
  const scene = new THREE.Scene();
  let controls!: OrbitControls;
  let observer: ResizeObserver | undefined;
  let disposed = false;
  let disposal: Promise<void> | null = null;
  const textures: THREE.Texture[] = [];
  function dispose() {
    if (disposed) return disposal ?? Promise.resolve();
    disposed = true;
    observer?.disconnect(); controls?.dispose(); releaseObject(scene);
    for (const texture of textures) texture.dispose();
    renderer.domElement.remove();
    disposal = renderer.dispose();
    // Device loss must not leave a rejected cleanup promise after the component unmounts.
    void disposal.catch(() => {});
    return disposal;
  }
  try {
    await renderer.init();
    signal.throwIfAborted();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true;
    renderer.domElement.setAttribute('aria-label', '3D simulation preview');
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none';
    renderer.domElement.tabIndex = 0;
    host.append(renderer.domElement);
    scene.background = new THREE.Color('#171c23');
    const environment = createStudioEnvironment(); textures.push(environment);
    scene.environment = environment; scene.environmentIntensity = 1.15;
    scene.environmentRotation.x = Math.PI / 2;
    const stock = plan.settings.stock;
    const size = Math.max(stock.width, stock.depth, stock.thickness, 20);
    const center = new THREE.Vector3(stock.originX + stock.width / 2, stock.originY + stock.depth / 2, stock.bottomZ + stock.thickness / 2);
    const camera = new THREE.PerspectiveCamera(40, 1, Math.max(0.01, size / 10000), size * 500);
    camera.up.set(0, 0, 1);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.minDistance = size * 0.05;
    controls.maxDistance = size * 20;
    controls.screenSpacePanning = true;
    const ambient = new THREE.HemisphereLight('#ffffff', '#343a43', 1.1);
    ambient.position.set(0, 0, 1);
    scene.add(ambient);
    const key = new THREE.DirectionalLight('#fffaf2', 2.2);
    key.position.copy(center).add(new THREE.Vector3(size * 0.5, -size, size * 2));
    key.target.position.copy(center);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -size * 1.5; key.shadow.camera.right = size * 1.5;
    key.shadow.camera.top = size * 1.5; key.shadow.camera.bottom = -size * 1.5;
    key.shadow.camera.near = size * 0.01; key.shadow.camera.far = size * 6;
    key.shadow.normalBias = size * 0.001;
    key.shadow.intensity = 0.3;
    scene.add(key, key.target);
    const rim = new THREE.DirectionalLight('#e0eaff', 1.2);
    rim.position.copy(center).add(new THREE.Vector3(-size, size, size));
    rim.target.position.copy(center);
    scene.add(rim, rim.target);
    const floorZ = plan.settings.supportFloorZ ?? stock.bottomZ - plan.settings.guideClearanceMm;
    const table = new THREE.Group(); table.name = 'table';
    const tableWidth = stock.width + size; const tableDepth = stock.depth + size;
    const gridTexture = createSupportGridTexture(tableWidth, tableDepth, size / 10); textures.push(gridTexture);
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(tableWidth, tableDepth),
      new THREE.MeshStandardMaterial({ map: gridTexture, color: '#c4c9cc', roughness: 0.8, metalness: 0.1,
        transparent: true, opacity: 0.48, depthWrite: false, side: THREE.DoubleSide }));
    grid.name = 'grid'; grid.position.set(center.x, center.y, floorZ); grid.receiveShadow = true;
    table.add(grid); scene.add(table);

    const stockMaterial = new THREE.MeshStandardMaterial({ color: '#b9bdc2', roughness: 0.3, metalness: 0.82 });
    const stockPolygon = [{ x: stock.originX, y: stock.originY }, { x: stock.originX + stock.width, y: stock.originY },
      { x: stock.originX + stock.width, y: stock.originY + stock.depth }, { x: stock.originX, y: stock.originY + stock.depth }];
    function extrude(polygon: readonly Point2[], holes: readonly (readonly Point2[])[], depth = stock.thickness) {
      return smoothExtrudedWalls(new THREE.ExtrudeGeometry(polygonShape(polygon, holes, center), { depth, bevelEnabled: false, curveSegments: 1 }));
    }
    const body = new THREE.Mesh(extrude(stockPolygon, []), stockMaterial);
    // Support-plane shadows convey depth without self-shadow banding along tessellated cut walls.
    body.name = 'stock'; body.position.set(center.x, center.y, stock.bottomZ); body.castShadow = true;
    scene.add(body);
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry, STOCK_OUTLINE_THRESHOLD_DEGREES), new THREE.LineBasicMaterial({ color: '#c9e1ee', transparent: true, opacity: 0.28 }));
    body.add(outline);
    let stockHoles: readonly (readonly Point2[])[] = [];
    const sameHoles = (a: readonly (readonly Point2[])[], b: readonly (readonly Point2[])[]) => a.length === b.length && a.every((polygon, index) => polygon === b[index]);
    const pieces = new Map<string, { mesh: THREE.Mesh<THREE.ExtrudeGeometry, THREE.MeshStandardMaterial>; holes: readonly (readonly Point2[])[] }>();
    const finalParts = new THREE.Group(); finalParts.name = 'final-material'; finalParts.visible = false; scene.add(finalParts);
    const finalBounds = new THREE.Box3();
    let finalPartsBuilt = false;
    for (const solid of plan.finalMaterial.solids) for (const point of solid.polygon) {
      finalBounds.expandByPoint(new THREE.Vector3(point.x, point.y, solid.bottomZ));
      finalBounds.expandByPoint(new THREE.Vector3(point.x, point.y, solid.topZ));
    }
    function buildFinalParts() {
      if (finalPartsBuilt) return;
      finalPartsBuilt = true;
      for (const solid of plan.finalMaterial.solids) {
        const mesh = new THREE.Mesh(extrude(solid.polygon, solid.holes, solid.topZ - solid.bottomZ), stockMaterial);
        mesh.name = 'finished-part'; mesh.userData.materialSolidId = solid.id;
        mesh.position.set(center.x, center.y, solid.bottomZ); finalParts.add(mesh);
      }
    }
    let presentation: ScenePresentation = { showWaste: false, showStock: true, finalPartOnly: false };
    let currentSnapshot: SimulationSnapshot | null = null;
    let activePathVisible = false;
    let machineVisible = true;

    const pathGroup = new THREE.Group(); pathGroup.name = 'paths';
    const pathZ = stock.bottomZ + stock.thickness + 0.1;
    const pathOrigin = { x: center.x, y: center.y, z: stock.bottomZ };
    pathGroup.position.set(pathOrigin.x, pathOrigin.y, pathOrigin.z);
    const pathBuffers = createSimulationPathBuffers(plan.steps, pathZ, pathOrigin);
    const pathBatches = (['cut', 'position'] as const).map(kind => {
      const positions = pathBuffers[kind].positions;
      const line = (color: string, opacity: number, order: number) => {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const object = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false }));
        object.renderOrder = order; pathGroup.add(object); return object;
      };
      const planned = line(kind === 'cut' ? '#5f8395' : '#806d50', 0.4, 2);
      const completed = line(kind === 'cut' ? '#5ad9b0' : '#d5ac65', 0.9, 3);
      planned.visible = positions.length > 0;
      completed.geometry.setDrawRange(0, 0);
      return { kind, completed };
    });
    scene.add(pathGroup);
    const activeAttribute = new THREE.BufferAttribute(pathBuffers.active, 3).setUsage(THREE.DynamicDrawUsage);
    const activeGeometry = new THREE.BufferGeometry();
    activeGeometry.setAttribute('position', activeAttribute); activeGeometry.setDrawRange(0, 0);
    const activeTrail = new THREE.Line(activeGeometry, new THREE.LineBasicMaterial({ color: '#66e5c0', depthTest: false }));
    activeTrail.position.copy(pathGroup.position);
    activeTrail.renderOrder = 4; activeTrail.visible = false; activeTrail.frustumCulled = false; scene.add(activeTrail);
    const wireRadius = plan.settings.wireDiameter / 2;
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(wireRadius, wireRadius, 1, 8),
      new THREE.MeshStandardMaterial({ color: '#f7d885', emissive: '#ebc063', emissiveIntensity: 0.35, metalness: 0.7, roughness: 0.25 }));
    wire.name = 'wire'; wire.rotation.x = Math.PI / 2; scene.add(wire);
    const guideMaterial = new THREE.MeshStandardMaterial({ color: '#273d4d', metalness: 0.7, roughness: 0.28 });
    const guideHeight = plan.settings.guideRadiusMm * 2;
    const guideGeometry = new THREE.CylinderGeometry(plan.settings.guideRadiusMm * 0.65, plan.settings.guideRadiusMm, guideHeight, 24);
    const upperGuide = new THREE.Mesh(guideGeometry, guideMaterial);
    const lowerGuide = new THREE.Mesh(guideGeometry, guideMaterial);
    upperGuide.name = 'upper-guide'; lowerGuide.name = 'lower-guide';
    upperGuide.rotation.x = -Math.PI / 2; lowerGuide.rotation.x = Math.PI / 2;
    upperGuide.castShadow = true; lowerGuide.castShadow = true;
    scene.add(upperGuide, lowerGuide);
    const contact = new THREE.Mesh(new THREE.SphereGeometry(Math.max(wireRadius * 2.5, size * 0.006), 12, 8),
      new THREE.MeshBasicMaterial({ color: '#fff0b2' }));
    scene.add(contact);
    const machineGroup = new THREE.Group(); machineGroup.name = 'machine'; scene.add(machineGroup);
    let lastModel: MachineModel | null = null;
    let clippingBounds: THREE.Box3 | null = null;
    function render() {
      if (disposed || !host.clientWidth || !host.clientHeight) return;
      if (clippingBounds && !clippingBounds.isEmpty()) {
        const direction = controls.target.clone().sub(camera.position).normalize();
        let nearest = Infinity; let furthest = 0;
        for (const x of [clippingBounds.min.x, clippingBounds.max.x]) for (const y of [clippingBounds.min.y, clippingBounds.max.y]) for (const z of [clippingBounds.min.z, clippingBounds.max.z]) {
          const depth = new THREE.Vector3(x, y, z).sub(camera.position).dot(direction);
          nearest = Math.min(nearest, depth); furthest = Math.max(furthest, depth);
        }
        camera.near = Math.max(0.001, nearest > 0 ? nearest * 0.5 : 0.001);
        camera.far = Math.max(camera.near + 1, furthest + Math.max(1, size * 0.1));
        camera.updateProjectionMatrix();
      }
      renderer.render(scene, camera);
    }
    function resize() {
      if (disposed) return;
      const width = Math.max(host.clientWidth, 1); const height = Math.max(host.clientHeight, 1);
      renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); render();
    }
    controls.addEventListener('change', render);
    observer = new ResizeObserver(resize); observer.observe(host);
    const simulationBounds = new THREE.Box3(new THREE.Vector3(stock.originX, stock.originY, stock.bottomZ),
      new THREE.Vector3(stock.originX + stock.width, stock.originY + stock.depth, stock.bottomZ + stock.thickness));
    const guideRadius = Math.max(plan.settings.guideRadiusMm, wireRadius);
    for (const step of plan.steps) {
      const motion = step.event.kind === 'motion' && step.event.motion === 'circular' && step.event.center ? step.event : null;
      const curveMargin = motion?.center ? Math.hypot(motion.start.x - motion.center.x, motion.start.y - motion.center.y)
        * (1 - Math.cos(Math.abs(arcSweep(motion)) / Math.max(1, step.path.length - 1) / 2)) : 0;
      for (const point of step.path) {
        simulationBounds.min.x = Math.min(simulationBounds.min.x, point.x - guideRadius - curveMargin);
        simulationBounds.min.y = Math.min(simulationBounds.min.y, point.y - guideRadius - curveMargin);
        simulationBounds.max.x = Math.max(simulationBounds.max.x, point.x + guideRadius + curveMargin);
        simulationBounds.max.y = Math.max(simulationBounds.max.y, point.y + guideRadius + curveMargin);
      }
    }
    simulationBounds.min.z = Math.min(floorZ, stock.bottomZ - plan.settings.guideClearanceMm - guideHeight);
    simulationBounds.max.z = Math.max(pathZ + Math.max(wireRadius * 2.5, size * 0.006),
      stock.bottomZ + stock.thickness + plan.settings.guideClearanceMm + guideHeight);
    // Include the complete vertical fall, but not the decorative floor/grid's oversized footprint.
    for (const piece of sampleSimulation(plan, plan.durationSeconds).pieces) {
      simulationBounds.min.z = Math.min(simulationBounds.min.z, piece.bottomZ);
      simulationBounds.max.z = Math.max(simulationBounds.max.z, piece.topZ);
    }
    function refreshClippingBounds() {
      clippingBounds = presentation.finalPartOnly ? finalBounds.clone() : simulationBounds.clone();
      if (!presentation.finalPartOnly) {
        if (table.visible) { table.updateMatrixWorld(true); clippingBounds.union(new THREE.Box3().setFromObject(table)); }
        if (machineGroup.visible && lastModel) {
          machineGroup.updateMatrixWorld(true);
          clippingBounds.union(new THREE.Box3(new THREE.Vector3(...lastModel.bounds.min), new THREE.Vector3(...lastModel.bounds.max)).applyMatrix4(machineGroup.matrixWorld));
        }
      }
    }
    function applyPresentation() {
      const process = !presentation.finalPartOnly;
      body.visible = process && presentation.showStock;
      finalParts.visible = !process;
      table.visible = process && plan.settings.supportFloorZ !== null;
      pathGroup.visible = process; activeTrail.visible = process && activePathVisible;
      wire.visible = process && (currentSnapshot?.wire.threaded ?? false);
      upperGuide.visible = process && plan.settings.guideRadiusMm > 0;
      lowerGuide.visible = process && plan.settings.guideRadiusMm > 0;
      contact.visible = process && (currentSnapshot?.wire.cutting ?? false);
      machineGroup.visible = process && machineVisible;
      const visiblePieces = new Set(currentSnapshot?.pieces.filter(piece => piece.role !== 'waste' || presentation.showWaste).map(piece => piece.id));
      for (const [id, item] of pieces) item.mesh.visible = process && visiblePieces.has(id);
      refreshClippingBounds();
    }
    function fitBounds(bounds: THREE.Box3, direction: THREE.Vector3) {
      const target = bounds.getCenter(new THREE.Vector3());
      const radius = Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, 1);
      const backward = direction.normalize();
      const right = new THREE.Vector3().crossVectors(camera.up, backward);
      if (right.lengthSq() < 1e-12) right.set(1, 0, 0);
      right.normalize();
      const up = new THREE.Vector3().crossVectors(backward, right).normalize();
      const verticalTangent = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const horizontalTangent = verticalTangent * camera.aspect;
      let distance = 1;
      // Project the box along the requested view. In top view, fall depth should not shrink the stock.
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        const offset = new THREE.Vector3(x, y, z).sub(target);
        const depth = offset.dot(backward);
        distance = Math.max(distance, depth + Math.abs(offset.dot(right)) * 1.1 / horizontalTangent,
          depth + Math.abs(offset.dot(up)) * 1.1 / verticalTangent);
      }
      controls.target.copy(target);
      controls.minDistance = radius * 0.005;
      controls.maxDistance = Math.max(distance * 4, radius * 20);
      camera.position.copy(target).add(backward.multiplyScalar(distance));
      refreshClippingBounds(); controls.update(); render();
    }
    function setView(view: 'isometric' | 'top' | 'front') {
      if (disposed) return;
      const direction = view === 'top' ? new THREE.Vector3(0, -0.001, 1) : view === 'front' ? new THREE.Vector3(0, -1, 0.05) : new THREE.Vector3(1.1, -1.5, 1.1);
      const bounds = presentation.finalPartOnly ? finalBounds : simulationBounds;
      if (!bounds.isEmpty()) fitBounds(bounds, direction);
    }
    let processCamera: { position: THREE.Vector3; target: THREE.Vector3; minDistance: number; maxDistance: number } | null = null;
    function fitPart() {
      if (disposed || finalBounds.isEmpty()) return;
      const direction = camera.position.clone().sub(controls.target);
      if (direction.lengthSq() === 0) direction.set(1.1, -1.5, 1.1);
      fitBounds(finalBounds, direction);
    }
    applyPresentation(); resize(); setView('isometric');
    return {
      backend: 'isWebGPUBackend' in renderer.backend ? 'WebGPU' : 'WebGL2',
      setView,
      fitPart,
      setPresentation(next) {
        if (disposed) return;
        const enteringFinal = next.finalPartOnly && !presentation.finalPartOnly;
        const leavingFinal = !next.finalPartOnly && presentation.finalPartOnly;
        if (enteringFinal) {
          processCamera = { position: camera.position.clone(), target: controls.target.clone(),
            minDistance: controls.minDistance, maxDistance: controls.maxDistance };
          buildFinalParts();
        }
        presentation = { ...next }; applyPresentation();
        if (enteringFinal) fitPart();
        if (leavingFinal && processCamera) {
          camera.position.copy(processCamera.position); controls.target.copy(processCamera.target);
          controls.minDistance = processCamera.minDistance; controls.maxDistance = processCamera.maxDistance;
          processCamera = null; controls.update();
        }
        render();
      },
      update(snapshot) {
        if (disposed) return;
        currentSnapshot = snapshot;
        if (!sameHoles(stockHoles, snapshot.stockHoles)) {
          stockHoles = snapshot.stockHoles;
          body.geometry.dispose(); body.geometry = extrude(stockPolygon, snapshot.stockHoles);
          outline.geometry.dispose(); outline.geometry = new THREE.EdgesGeometry(body.geometry, STOCK_OUTLINE_THRESHOLD_DEGREES);
        }
        for (const piece of snapshot.pieces) {
          let item = pieces.get(piece.id);
          if (!item) {
            const mesh = new THREE.Mesh(extrude(piece.polygon, piece.holes), stockMaterial.clone());
            mesh.name = piece.role === 'part' ? 'finished-part' : piece.role === 'waste' ? 'waste' : 'unclassified-material';
            mesh.castShadow = true;
            item = { mesh, holes: piece.holes }; pieces.set(piece.id, item); scene.add(mesh);
          }
          if (!sameHoles(item.holes, piece.holes)) {
            item.mesh.geometry.dispose(); item.mesh.geometry = extrude(piece.polygon, piece.holes); item.holes = piece.holes;
          }
          item.mesh.visible = true; item.mesh.position.set(center.x, center.y, piece.bottomZ);
        }
        const completeCount = Math.max(0, Math.min(plan.steps.length, snapshot.completedStepCount));
        for (const { kind, completed } of pathBatches) {
          completed.geometry.setDrawRange(0, pathBuffers[kind].completedVertexCounts[completeCount]);
        }
        const active = updateActiveSimulationPath(pathBuffers, snapshot.activeStepIndex, snapshot.activeStepFraction, snapshot.wire.point);
        activePathVisible = active.vertexCount > 0;
        activeGeometry.setDrawRange(0, active.vertexCount);
        if (active.kind) {
          activeTrail.material.color.set(active.kind === 'cut' ? '#66e5c0' : '#ffc884');
          activeAttribute.clearUpdateRanges();
          for (const range of active.updates) activeAttribute.addUpdateRange(range.start, range.count);
          activeAttribute.needsUpdate = true;
        }
        const { point, bottomZ, topZ, threaded, cutting } = snapshot.wire;
        wire.position.set(point.x, point.y, (bottomZ + topZ) / 2); wire.scale.y = topZ - bottomZ; wire.visible = threaded;
        upperGuide.position.set(point.x, point.y, topZ + guideHeight / 2);
        lowerGuide.position.set(point.x, point.y, bottomZ - guideHeight / 2);
        contact.position.set(point.x, point.y, pathZ); contact.visible = cutting;
        applyPresentation(); render();
      },
      setMachine(model, placement) {
        if (disposed) return;
        if (model !== lastModel) {
          releaseObject(machineGroup); machineGroup.clear(); lastModel = model;
          const sourceMeshes = model?.meshes ?? [];
          const palette = createMachineSurfacePalette(sourceMeshes);
          const materials = palette.colors.map(rgb => new THREE.MeshStandardMaterial({
            color: rgb ? new THREE.Color(...rgb) : new THREE.Color('#526a7d'), metalness: 0.35, roughness: 0.6,
            transparent: true, opacity: 0.7, side: THREE.DoubleSide
          }));
          for (const [meshIndex, source] of sourceMeshes.entries()) {
            const geometry = new THREE.BufferGeometry();
            const origin = source.bounds.min.map((value, axis) => value + (source.bounds.max[axis] - value) / 2);
            const positions = new Float32Array(source.positions.length);
            // Keep small details before Float32 upload; authored coordinates and placement stay unchanged.
            for (let offset = 0; offset < positions.length; offset++) positions[offset] = source.positions[offset] - origin[offset % 3];
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setIndex(new THREE.BufferAttribute(palette.meshes[meshIndex].indices, 1));
            if (source.normals) geometry.setAttribute('normal', new THREE.BufferAttribute(source.normals, 3));
            else geometry.computeVertexNormals();
            for (const group of palette.meshes[meshIndex].groups) geometry.addGroup(group.start, group.count, group.materialIndex);
            const mesh = new THREE.Mesh(geometry, materials);
            mesh.position.set(origin[0], origin[1], origin[2]);
            mesh.name = source.name;
            mesh.castShadow = true; mesh.receiveShadow = true; machineGroup.add(mesh);
          }
        }
        machineGroup.position.set(placement.x, placement.y, placement.z);
        machineGroup.rotation.z = placement.rotation * Math.PI / 180;
        refreshClippingBounds(); render();
      },
      setMachineVisible(visible) {
        if (disposed) return;
        machineVisible = visible; applyPresentation(); render();
      },
      fitMachine() {
        if (disposed || !lastModel || presentation.finalPartOnly) return;
        machineGroup.updateMatrixWorld(true);
        const bounds = new THREE.Box3(new THREE.Vector3(...lastModel.bounds.min), new THREE.Vector3(...lastModel.bounds.max))
          .applyMatrix4(machineGroup.matrixWorld).union(simulationBounds);
        const direction = camera.position.clone().sub(controls.target);
        if (direction.lengthSq() === 0) direction.set(1.1, -1.5, 1.1);
        fitBounds(bounds, direction);
      },
      async capture(captureSignal) {
        captureSignal.throwIfAborted(); render();
        const image = captureCanvas(renderer.domElement, '3d');
        captureSignal.throwIfAborted(); return image;
      },
      dispose
    };
  } catch (error) {
    await dispose().catch(() => {});
    throw error;
  }
}
