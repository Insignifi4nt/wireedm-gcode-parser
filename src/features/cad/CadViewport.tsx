import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Box, Grid2X2, Maximize2 } from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CadMesh } from '@/domain/cad/cadDocument';
import type { CadTopologyPickSet } from '@/domain/cad/cadTopology';
import { captureCanvas } from '@/features/editor/captureEditorPreview';
import { ToolError } from '@/features/webmcp/siteTools';
import type { CadNamedView, CadRenderedViewControls } from './cadViewportControls';
import { pickTopology, type CadPickMode, type CadTopologyHit } from './cadTopologyPicking';
import { createCadTopologyHighlights } from './cadTopologyHighlights';
import { pickCadCurveReference } from './cadCurveRendering';
import { cadReferenceFeatureIds, type CadViewportReference } from './cadViewportReferences';
import { cadLocalRenderPositions, cadRenderOrigin } from './cadRenderCoordinates';
const NO_REFERENCES: readonly CadViewportReference[] = Object.freeze([]);
export interface CadViewportEmptyAction {
  readonly label: string;
  readonly description: string;
  onAction(): void;
}

export function CadViewport({ meshes, references = NO_REFERENCES, referenceVersion = null, selectedId, onSelect, onControlsReady, interactionLocked = false,
  pickMode = 'body', topologySelection = null, onPickMode, onTopologyPick, pickingEnabled = true, emptyAction = null }: {
  meshes: readonly CadMesh[];
  references?: readonly CadViewportReference[];
  referenceVersion?: string | null;
  selectedId: string | null;
  onSelect(id: string | null): void;
  onControlsReady?(controls: CadRenderedViewControls | null, released?: CadRenderedViewControls): void;
  interactionLocked?: boolean;
  pickMode?: CadPickMode;
  topologySelection?: CadTopologyPickSet | null;
  onPickMode?(mode: CadPickMode): void;
  onTopologyPick?(hit: CadTopologyHit | null, additive: boolean): void;
  pickingEnabled?: boolean;
  emptyAction?: CadViewportEmptyAction | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<CadRenderedViewControls | null>(null);
  const publish = useRef(onControlsReady);
  publish.current = onControlsReady;
  const data = useRef({ meshes, references, referenceVersion, selectedId, onSelect, pickMode, topologySelection, onTopologyPick, interactionLocked, pickingEnabled });
  data.current = { meshes, references, referenceVersion, selectedId, onSelect, pickMode, topologySelection, onTopologyPick, interactionLocked, pickingEnabled };
  const redraw = useRef<(() => void) | null>(null);
  const recolor = useRef<(() => void) | null>(null);
  const highlight = useRef<(() => void) | null>(null);
  const uploadedMeshes = useRef<readonly CadMesh[] | null>(null);
  const uploadedReferences = useRef<readonly CadViewportReference[] | null>(null);
  const uploadReferences = useRef<(() => void) | null>(null);
  const orbit = useRef<OrbitControls | null>(null);
  const [graphicsFailure, setGraphicsFailure] = useState<'unavailable' | 'lost' | null>(null);
  const [contextGeneration, setContextGeneration] = useState(0);
  const unavailable = graphicsFailure !== null;
  const [gridVisible, setGridVisible] = useState(true);
  const [viewName, setViewName] = useState<CadNamedView | 'Custom'>('Isometric');

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { setGraphicsFailure('unavailable'); return; }
    setGraphicsFailure(null); setGridVisible(true); setViewName('Isometric');
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x18252e);
    const camera = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.01, 100000);
    camera.up.set(0, 0, 1);
    camera.position.set(160, -180, 140);
    const createOrbitControls = () => {
      const next = new OrbitControls(camera, renderer.domElement);
      next.enableDamping = false;
      next.screenSpacePanning = true;
      next.minZoom = 0.01;
      next.maxZoom = 10000;
      next.enabled = !data.current.interactionLocked;
      return next;
    };
    let controls = createOrbitControls();
    orbit.current = controls;
    scene.add(new THREE.HemisphereLight(0xd7e6ff, 0x383b43, 2));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(100, -100, 200);
    scene.add(light);
    const grid = new THREE.GridHelper(1000, 100, 0x465666, 0x293640);
    grid.rotation.x = Math.PI / 2;
    for (const material of Array.isArray(grid.material) ? grid.material : [grid.material]) material.depthWrite = false;
    grid.renderOrder = -2;
    scene.add(grid);
    const axes = new THREE.AxesHelper(30);
    for (const material of Array.isArray(axes.material) ? axes.material : [axes.material]) material.depthWrite = false;
    axes.renderOrder = -1;
    scene.add(axes);
    const solids = new THREE.Group();
    const referenceLines = new THREE.Group();
    const pickableReferences: THREE.LineSegments[] = [];
    const installedReferences = new Map<string, { reference: CadViewportReference; line: THREE.LineSegments; patch?: THREE.Mesh }>();
    const pickableBodies: THREE.Mesh[] = [];
    const pickableEdges: THREE.LineSegments[] = [];
    const meshByObject = new Map<THREE.Object3D, CadMesh>();
    const highlights = createCadTopologyHighlights();
    scene.add(solids);
    scene.add(referenceLines);
    scene.add(highlights.objects);
    let frame: number | null = null;
    let disposed = false;
    let pendingHover: PointerEvent | null = null;
    let namedDirection = camera.position.clone().sub(controls.target).normalize();
    const viewState: { view: CadNamedView | 'Custom'; gridVisible: boolean; revision: number; hoveredTopology: CadTopologyHit | null } = { view: 'Isometric', gridVisible: true, revision: 0, hoveredTopology: null };
    let installedReferenceVersion: string | null = null;
    let installedReferenceFeatureIds: readonly string[] = Object.freeze([]);
    const render = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        if (disposed || renderer.getContext().isContextLost()) { frame = null; return; }
        const event = pendingHover; pendingHover = null;
        if (event && !down && !event.buttons && !data.current.interactionLocked && data.current.pickingEnabled && data.current.pickMode !== 'body') {
          setRay(event); setHover(hitTopology());
        }
        updateReferenceStyles(); renderer.render(scene, camera); frame = null;
      });
    };
    const resize = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      const halfHeight = 85;
      camera.left = -halfHeight * width / height;
      camera.right = halfHeight * width / height;
      camera.top = halfHeight;
      camera.bottom = -halfHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      highlights.resize(width, height);
      render();
    };
    // A reference-only scene and its first solid have separate initial frames.
    // Later rebuilds, or an explicitly chosen camera, never trigger another fit.
    let fittedReferences = false, fittedSolid = false, userFramed = false, fittingAutomatically = false;
    const fit = (automatic = false) => {
      if (!automatic) userFramed = true;
      fittingAutomatically = automatic;
      try {
        const bounds = new THREE.Box3().setFromObject(solids);
        const contours = data.current.references.filter(reference => reference.featureKind !== 'datum-plane');
        const fitReferences = !bounds.isEmpty() || contours.length ? contours : data.current.references;
        for (const reference of fitReferences) bounds.union(new THREE.Box3(new THREE.Vector3(...reference.bounds.min), new THREE.Vector3(...reference.bounds.max)));
        const center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
        const size = bounds.isEmpty() ? new THREE.Vector3(100, 100, 100) : bounds.getSize(new THREE.Vector3());
        const direction = camera.position.clone().sub(controls.target).normalize();
        controls.target.copy(center);
        camera.position.copy(center).addScaledVector(direction, Math.max(200, size.length() * 3));
        camera.far = Math.max(100000, size.length() * 10);
        camera.zoom = Math.min(camera.right - camera.left, camera.top - camera.bottom) / Math.max(20, size.length() * 1.18);
        camera.updateProjectionMatrix();
        controls.update();
        render();
      } finally { fittingAutomatically = false; }
    };
    const disposeSolids = () => {
      pickableBodies.length = 0;
      pickableEdges.length = 0;
      meshByObject.clear();
      for (const child of [...solids.children]) {
        if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
          child.geometry.dispose();
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          for (const material of materials) material.dispose();
        }
        solids.remove(child);
      }
    };
    const disposeReferences = () => {
      for (const { line, patch } of installedReferences.values()) disposeReference(line, patch);
      installedReferences.clear();
      pickableReferences.length = 0;
    };
    const disposeReference = (line: THREE.LineSegments, patch?: THREE.Mesh) => {
      if (patch) { patch.geometry.dispose(); for (const material of Array.isArray(patch.material) ? patch.material : [patch.material]) material.dispose(); referenceLines.remove(patch); }
      line.geometry.dispose();
      for (const material of Array.isArray(line.material) ? line.material : [line.material]) material.dispose();
      referenceLines.remove(line);
    };
    const referenceColor = (reference: CadViewportReference) => reference.featureId === data.current.selectedId ? 0xf0c779 : reference.construction ? 0x698594 : 0x89b9c6;
    const updateReferenceStyles = () => {
      const worldPerPixel = (camera.top - camera.bottom) / camera.zoom / Math.max(1, container.clientHeight);
      for (const { reference, line, patch } of installedReferences.values()) {
        if (patch && patch.material instanceof THREE.MeshBasicMaterial) { patch.material.color.setHex(referenceColor(reference)); patch.material.opacity = reference.featureId === data.current.selectedId ? .12 : .055; }
        if (line.material instanceof THREE.LineBasicMaterial) line.material.color.setHex(referenceColor(reference));
        if (line.material instanceof THREE.LineDashedMaterial) { line.material.dashSize = worldPerPixel * 6; line.material.gapSize = worldPerPixel * 4; }
      }
    };
    const updateReferences = () => {
      if (uploadedReferences.current !== data.current.references) {
        const wanted = new Map(data.current.references.map(reference => [reference.referenceId, reference]));
        for (const [id, installed] of installedReferences) {
          if (wanted.get(id) === installed.reference) continue;
          disposeReference(installed.line, installed.patch); installedReferences.delete(id);
        }
        for (const reference of data.current.references) {
          if (installedReferences.has(reference.referenceId)) continue;
          // Float32 world vertices lose small curves far from the origin. Keep
          // GPU coordinates local; Three composes the world/camera translations
          // in double precision before uploading the model-view matrix.
          const origin = cadRenderOrigin(reference.bounds);
          const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(cadLocalRenderPositions(reference.positions, origin), 3));
          const material = reference.construction ? new THREE.LineDashedMaterial({ color: referenceColor(reference), depthWrite: false }) : new THREE.LineBasicMaterial({ color: referenceColor(reference) });
          const line = new THREE.LineSegments(geometry, material);
          if (reference.construction) line.computeLineDistances();
          line.renderOrder = 1;
          line.position.set(origin[0], origin[1], origin[2]);
          line.userData.featureKind = reference.featureKind; line.userData.featureId = reference.featureId; line.userData.referenceId = reference.referenceId; referenceLines.add(line); line.updateMatrixWorld(true);
          let patch: THREE.Mesh | undefined;
          if (reference.planePatch) {
            const patchGeometry = new THREE.BufferGeometry(); patchGeometry.setAttribute('position', new THREE.BufferAttribute(cadLocalRenderPositions(reference.planePatch, origin), 3));
            patch = new THREE.Mesh(patchGeometry, new THREE.MeshBasicMaterial({ color: referenceColor(reference), transparent: true, opacity: .055, side: THREE.DoubleSide, depthWrite: false }));
            patch.position.set(...origin); patch.userData.featureId = reference.featureId; referenceLines.add(patch); patch.updateMatrixWorld(true);
          }
          installedReferences.set(reference.referenceId, { reference, line, patch });
        }
        pickableReferences.length = 0; installedReferences.forEach(({ line }) => pickableReferences.push(line));
        uploadedReferences.current = data.current.references;
      }
      installedReferenceVersion = data.current.referenceVersion;
      installedReferenceFeatureIds = cadReferenceFeatureIds(data.current.references);
      viewState.revision++;
      if (!fittedReferences && !fittedSolid && data.current.references.length && !data.current.meshes.length) {
        fittedReferences = true;
        if (!userFramed) fit(true);
      }
      render();
    };
    const update = () => {
      uploadedMeshes.current = data.current.meshes;
      disposeSolids();
      for (const mesh of data.current.meshes) {
        const origin = cadRenderOrigin(mesh.bounds);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(cadLocalRenderPositions(mesh.positions, origin), 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normals, 3));
        geometry.setIndex([...mesh.indices]);
        const selected = mesh.featureId === data.current.selectedId;
        const material = new THREE.MeshStandardMaterial({ color: selected ? 0x79c8e6 : 0xa3b0bf, roughness: 0.55, metalness: 0.18, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
        const body = new THREE.Mesh(geometry, material);
        body.position.set(...origin);
        body.userData.featureId = mesh.featureId;
        solids.add(body);
        pickableBodies.push(body);
        meshByObject.set(body, mesh);
        const edges = new THREE.BufferGeometry();
        edges.setAttribute('position', new THREE.BufferAttribute(cadLocalRenderPositions(mesh.edges, origin), 3));
        const lines = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: selected ? 0xb5eafd : 0x344452 }));
        lines.position.set(...origin);
        lines.userData.featureId = mesh.featureId;
        solids.add(lines);
        pickableEdges.push(lines);
        meshByObject.set(lines, mesh);
      }
      if (!fittedSolid && data.current.meshes.length) {
        fittedSolid = true;
        if (!userFramed) fit(true);
      }
      viewState.hoveredTopology = null;
      updateHighlights();
      render();
    };
    const updateHighlights = () => {
      if (highlights.update({ meshes: data.current.meshes, selection: data.current.topologySelection, hover: viewState.hoveredTopology })) {
        viewState.revision++; render();
      }
    };
    const setHover = (hit: CadTopologyHit | null) => {
      const previous = viewState.hoveredTopology;
      if (previous?.bodyId === hit?.bodyId && previous?.pick.key === hit?.pick.key) return;
      viewState.hoveredTopology = hit;
      updateHighlights();
    };
    const updateSelection = () => {
      for (const child of solids.children) {
        const selected = child.userData.featureId === data.current.selectedId;
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) child.material.color.setHex(selected ? 0x79c8e6 : 0xa3b0bf);
        else if (child instanceof THREE.LineSegments && child.material instanceof THREE.LineBasicMaterial) child.material.color.setHex(selected ? 0xb5eafd : 0x344452);
      }
      updateReferenceStyles();
      render();
    };
    const raycaster = new THREE.Raycaster();
    let down: { x: number; y: number } | null = null;
    const setRay = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / Math.max(1, rect.width) * 2 - 1, -(event.clientY - rect.top) / Math.max(1, rect.height) * 2 + 1), camera);
    };
    const hitTopology = () => data.current.pickMode === 'body' ? null : pickTopology({ mode: data.current.pickMode,
      raycaster, bodies: pickableBodies, edges: pickableEdges, meshByObject, camera, viewportHeight: container.clientHeight });
    const pointerDown = (event: PointerEvent) => { pendingHover = null; setHover(null); if (event.button === 0) down = { x: event.clientX, y: event.clientY }; };
    const pointerMove = (event: PointerEvent) => {
      if (down || event.buttons || data.current.interactionLocked || !data.current.pickingEnabled || data.current.pickMode === 'body') { setHover(null); return; }
      pendingHover = event; render();
    };
    const pointerLeave = () => { pendingHover = null; setHover(null); };
    const pointerCancel = () => { pendingHover = null; down = null; setHover(null); };
    const pointerUp = (event: PointerEvent) => {
      if (event.button !== 0 || !down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4 || data.current.interactionLocked) { down = null; return; }
      down = null;
      setRay(event);
      if (data.current.pickMode === 'body') {
        const referenceId = pickCadCurveReference({ raycaster, references: pickableReferences.filter(line => line.userData.featureKind !== 'datum-plane'), bodies: pickableBodies, camera, viewportHeight: container.clientHeight });
        if (referenceId) { data.current.onSelect(referenceId); return; }
        const datumId = pickCadCurveReference({ raycaster, references: pickableReferences.filter(line => line.userData.featureKind === 'datum-plane'), bodies: pickableBodies, camera, viewportHeight: container.clientHeight });
        if (datumId) { data.current.onSelect(datumId); return; }
        const patches = [...installedReferences.values()].flatMap(entry => entry.patch ? [entry.patch] : []);
        const patchHit = raycaster.intersectObjects(patches, false)[0];
        const surface = raycaster.intersectObjects(pickableBodies, false)[0];
        if (patchHit && (!surface || patchHit.distance <= surface.distance + 1e-7)) { data.current.onSelect(patchHit.object.userData.featureId); return; }
      }
      if (!data.current.pickingEnabled) return;
      if (data.current.pickMode !== 'body') { data.current.onTopologyPick?.(hitTopology(), event.ctrlKey || event.metaKey); return; }
      const hit = raycaster.intersectObjects(pickableBodies, false)[0];
      const id: unknown = hit?.object.userData.featureId;
      data.current.onSelect(typeof id === 'string' ? id : null);
    };
    const onChange = () => {
      if (!fittingAutomatically) userFramed = true;
      if (viewState.view !== 'Custom' && camera.position.clone().sub(controls.target).normalize().distanceToSquared(namedDirection) > 1e-12) { viewState.view = 'Custom'; setViewName('Custom'); }
      viewState.revision++; render();
    };
    const onStart = () => { pendingHover = null; setHover(null); };
    const attachOrbitListeners = (instance: OrbitControls) => {
      instance.addEventListener('change', onChange);
      instance.addEventListener('start', onStart);
    };
    const releaseOrbitControls = (instance: OrbitControls) => {
      instance.removeEventListener('change', onChange);
      instance.removeEventListener('start', onStart);
      instance.dispose();
    };
    const contextLost = () => {
      if (disposed) return;
      if (frame !== null) { cancelAnimationFrame(frame); frame = null; }
      pendingHover = null;
      viewState.revision++;
      setGraphicsFailure('lost');
    };
    const contextRestored = () => {
      if (disposed) return;
      // Three restores its GPU resources first. Demand rendering must then redraw
      // the retained scene rather than waiting for the next pointer interaction.
      viewState.revision++;
      setGraphicsFailure(null);
      resize();
    };
    renderer.domElement.addEventListener('webglcontextlost', contextLost);
    renderer.domElement.addEventListener('webglcontextrestored', contextRestored);
    attachOrbitListeners(controls);
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    renderer.domElement.addEventListener('pointermove', pointerMove);
    renderer.domElement.addEventListener('pointerleave', pointerLeave);
    renderer.domElement.addEventListener('pointercancel', pointerCancel);
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    update();
    updateReferences();
    redraw.current = update;
    uploadReferences.current = updateReferences;
    recolor.current = updateSelection;
    highlight.current = () => {
      if (!data.current.pickingEnabled || viewState.hoveredTopology?.pick.kind !== data.current.pickMode) viewState.hoveredTopology = null;
      updateHighlights();
    };
    updateHighlights();
    controller.current = {
      getState: () => Object.freeze({ mode: 'solid', available: !disposed && !renderer.getContext().isContextLost(), view: viewState.view, gridVisible: viewState.gridVisible, zoom: camera.zoom, revision: viewState.revision, referenceVersion: installedReferenceVersion, referenceFeatureIds: installedReferenceFeatureIds,
        hoveredTopology: viewState.hoveredTopology ? Object.freeze({ ...viewState.hoveredTopology, pick: Object.freeze({ ...viewState.hoveredTopology.pick }) }) : null }),
      fit,
      setGrid(visible) { grid.visible = visible; viewState.gridVisible = visible; viewState.revision++; setGridVisible(visible); render(); },
      setView(name) {
        const direction = name === 'Top' ? new THREE.Vector3(0, 0, 1) : name === 'Front' ? new THREE.Vector3(0, -1, 0) : name === 'Right' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(1, -1.2, 0.9).normalize();
        const distance = Math.max(1000, camera.position.distanceTo(controls.target));
        const up = new THREE.Vector3(0, name === 'Top' ? 1 : 0, name === 'Top' ? 0 : 1);
        if (!camera.up.equals(up)) {
          const target = controls.target.clone();
          releaseOrbitControls(controls);
          camera.up.copy(up);
          // OrbitControls captures the up basis at construction. Its constructor
          // also updates the camera before our retained target is restored.
          controls = createOrbitControls();
          controls.target.copy(target);
          orbit.current = controls;
          attachOrbitListeners(controls);
        }
        camera.position.copy(controls.target).addScaledVector(direction, distance);
        namedDirection = direction.clone().normalize();
        viewState.view = name; viewState.revision++; setViewName(name);
        controls.update(); render();
      },
      async capture(signal) {
        signal.throwIfAborted();
        const assertGraphicsAvailable = () => {
          if (disposed || renderer.getContext().isContextLost()) throw new ToolError('CAPTURE_UNAVAILABLE', 'The 3D graphics context is unavailable. Wait for recovery or retry the 3D view.');
        };
        assertGraphicsAvailable();
        if (uploadedMeshes.current !== data.current.meshes) update();
        if (uploadedReferences.current !== data.current.references || installedReferenceVersion !== data.current.referenceVersion) updateReferences();
        updateSelection();
        updateHighlights();
        controls.update();
        if (frame !== null) { cancelAnimationFrame(frame); frame = null; }
        updateReferenceStyles(); renderer.render(scene, camera);
        assertGraphicsAvailable();
        const image = captureCanvas(renderer.domElement, '3d');
        assertGraphicsAvailable();
        signal.throwIfAborted();
        return image;
      },
    };
    const publishedControls = controller.current;
    publish.current?.(publishedControls);
    return () => {
      disposed = true;
      observer.disconnect();
      releaseOrbitControls(controls);
      orbit.current = null;
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('pointermove', pointerMove);
      renderer.domElement.removeEventListener('pointerleave', pointerLeave);
      renderer.domElement.removeEventListener('pointercancel', pointerCancel);
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', contextRestored);
      if (frame !== null) cancelAnimationFrame(frame);
      disposeSolids();
      disposeReferences();
      highlights.dispose();
      grid.geometry.dispose();
      for (const material of Array.isArray(grid.material) ? grid.material : [grid.material]) material.dispose();
      axes.geometry.dispose();
      for (const material of Array.isArray(axes.material) ? axes.material : [axes.material]) material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      controller.current = null;
      redraw.current = null;
      recolor.current = null;
      highlight.current = null;
      uploadedMeshes.current = null;
      uploadedReferences.current = null; uploadReferences.current = null;
      publish.current?.(null, publishedControls);
    };
  }, [contextGeneration]);

  useEffect(() => { if (uploadedMeshes.current !== meshes) redraw.current?.(); }, [meshes]);
  useLayoutEffect(() => { uploadReferences.current?.(); }, [references, referenceVersion]);
  useEffect(() => { recolor.current?.(); }, [selectedId]);
  useEffect(() => { highlight.current?.(); }, [topologySelection, pickMode, meshes, pickingEnabled, interactionLocked]);
  useEffect(() => { if (orbit.current) orbit.current.enabled = !interactionLocked; }, [interactionLocked]);
  return <div className="cad-viewport">
    <div className="cad-webgl" ref={host} aria-label="3D model viewport" />
    <div className="cad-view-tools" aria-label="Viewport controls">
      <Box size={14} />
      <select aria-label="Named view" value={viewName} disabled={interactionLocked || unavailable} onChange={(event) => {
        const name = (['Isometric', 'Top', 'Front', 'Right'] satisfies CadNamedView[]).find((entry) => entry === event.target.value);
        if (name) controller.current?.setView?.(name);
      }}>{viewName === 'Custom' && <option value="Custom" disabled>Custom</option>}{(['Isometric', 'Top', 'Front', 'Right'] satisfies CadNamedView[]).map((name) => <option key={name} value={name}>{name}</option>)}</select>
      <span className="cad-divider" />
      <button title="Fit model" aria-label="Fit model" disabled={interactionLocked || unavailable} onClick={() => controller.current?.fit()}><Maximize2 size={14} /></button>
      <button title="Toggle grid" aria-label="Toggle grid" disabled={interactionLocked || unavailable} aria-pressed={gridVisible} onClick={() => controller.current?.setGrid(!gridVisible)}><Grid2X2 size={14} /></button>
      {onPickMode && <><span className="cad-divider" />
        {(['body', 'face', 'edge'] satisfies CadPickMode[]).map((mode) => <button key={mode} disabled={interactionLocked || unavailable || !pickingEnabled} aria-pressed={pickMode === mode} title={`Pick ${mode === 'body' ? 'bodies' : `${mode}s`}`} onClick={() => onPickMode(mode)}>{mode === 'body' ? 'Body' : mode === 'face' ? 'Face' : 'Edge'}</button>)}
      </>}
    </div>
    {unavailable ? <div className="cad-view-message" role="status"><strong>{graphicsFailure === 'lost' ? 'The 3D graphics context was interrupted.' : '3D graphics are unavailable in this browser.'}</strong><span>{graphicsFailure === 'lost' ? 'Waiting for recovery. Retry the view if it stays blank; your CAD document is retained.' : 'Sketch editing and document operations remain available. Enable WebGL to view solids.'}</span><button type="button" disabled={interactionLocked} onClick={() => setContextGeneration(generation => generation + 1)}>Retry 3D view</button></div> : meshes.length === 0 && references.length === 0 ? emptyAction && <div className="cad-view-message"><button type="button" disabled={interactionLocked} title={emptyAction.description} onClick={emptyAction.onAction}>{emptyAction.label}</button></div> : null}
    {topologySelection?.picks.length ? <div className="cad-view-caption">{topologySelection.picks.length} {topologySelection.picks[0].kind}{topologySelection.picks.length === 1 ? '' : 's'} selected</div> : null}
    <div className="cad-view-help">{pickMode === 'edge' ? 'Ctrl / Cmd click to toggle edges · ' : ''}Drag to orbit · Right drag to pan · Scroll to zoom</div>
  </div>;
}
