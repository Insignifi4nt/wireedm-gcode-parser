import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Box, Grid2X2, Maximize2 } from 'lucide-react';
import { CadContextHelp } from './CadContextHelp';
import { CadViewTools } from './CadCommandDock';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CadMesh, CadPlane, CadSketchPlane } from '@/domain/cad/cadDocument';
import type { CadTopologyPickSet } from '@/domain/cad/cadTopology';
import { captureCanvas } from '@/features/editor/captureEditorPreview';
import { ToolError } from '@/features/webmcp/siteTools';
import type { CadNamedView, CadRenderedViewControls } from './cadViewportControls';
import { pickTopology, type CadPickMode, type CadTopologyHit } from './cadTopologyPicking';
import { createCadTopologyHighlights } from './cadTopologyHighlights';
import { pickCadCurveReference } from './cadCurveRendering';
import { cadReferenceFeatureIds, cadReferencePlanes, cadSameReferencePlane, type CadViewportReference } from './cadViewportReferences';
import { cadLocalRenderPositions, cadRenderOrigin } from './cadRenderCoordinates';
import { readCadFitArea, type CadFitAreaReader } from './cadFitArea';
import './cad-plane-selection.css';
const NO_REFERENCES: readonly CadViewportReference[] = Object.freeze([]);
export interface CadViewportContextMenuRequest {
  readonly clientX: number;
  readonly clientY: number;
  readonly trigger: 'pointer' | 'keyboard';
  readonly target: { readonly kind: 'feature'; readonly featureId: string } | { readonly kind: 'topology'; readonly hit: CadTopologyHit } | null;
}

export function CadViewport({ meshes, references = NO_REFERENCES, referenceVersion = null, selectedId, onSelect, onControlsReady, interactionLocked = false,
  navigationLocked = interactionLocked, navigationMode = 'mouse', onContextMenu, pickMode = 'body', topologySelection = null, onPickMode, onTopologyPick, pickingEnabled = true, getFitArea,
  selectedReferencePlane = null, onSelectPlane, planePickingOnly = false }: {
  meshes: readonly CadMesh[];
  references?: readonly CadViewportReference[];
  referenceVersion?: string | null;
  selectedId: string | null;
  onSelect(id: string | null): void;
  selectedReferencePlane?: CadSketchPlane | null;
  onSelectPlane?(plane: CadSketchPlane): void;
  planePickingOnly?: boolean;
  onControlsReady?(controls: CadRenderedViewControls | null, released?: CadRenderedViewControls): void;
  interactionLocked?: boolean;
  navigationLocked?: boolean;
  navigationMode?: 'mouse' | 'trackpad';
  onContextMenu?(request: CadViewportContextMenuRequest): void;
  pickMode?: CadPickMode;
  topologySelection?: CadTopologyPickSet | null;
  onPickMode?(mode: CadPickMode): void;
  onTopologyPick?(hit: CadTopologyHit | null, additive: boolean): void;
  pickingEnabled?: boolean;
  getFitArea?: CadFitAreaReader;
}) {
  const host = useRef<HTMLDivElement>(null);
  const planeLabels = useRef<HTMLDivElement>(null);
  const controller = useRef<CadRenderedViewControls | null>(null);
  const publish = useRef(onControlsReady);
  publish.current = onControlsReady;
  const data = useRef({ meshes, references, referenceVersion, selectedId, onSelect, pickMode, topologySelection, onTopologyPick, interactionLocked, navigationLocked, navigationMode, onContextMenu, pickingEnabled, getFitArea, selectedReferencePlane, onSelectPlane, planePickingOnly });
  data.current = { meshes, references, referenceVersion, selectedId, onSelect, pickMode, topologySelection, onTopologyPick, interactionLocked, navigationLocked, navigationMode, onContextMenu, pickingEnabled, getFitArea, selectedReferencePlane, onSelectPlane, planePickingOnly };
  const redraw = useRef<(() => void) | null>(null);
  const recolor = useRef<(() => void) | null>(null);
  const highlight = useRef<(() => void) | null>(null);
  const cancelInteraction = useRef<(() => void) | null>(null);
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
    renderer.domElement.tabIndex = data.current.navigationLocked && data.current.interactionLocked ? -1 : 0;
    renderer.domElement.setAttribute('aria-label', '3D model canvas');
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x18252e);
    const camera = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.01, 100000);
    camera.up.set(0, 0, 1);
    camera.position.set(160, -180, 140);
    const createOrbitControls = () => {
      const next = new OrbitControls(camera, renderer.domElement);
      next.enableDamping = false;
      next.screenSpacePanning = true;
      next.minZoom = Math.min(0.01, camera.zoom);
      next.maxZoom = 10000;
      next.enabled = !data.current.navigationLocked;
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
    let hoveredFeatureId: string | null = null;
    let namedDirection = camera.position.clone().sub(controls.target).normalize();
    const viewState: { view: CadNamedView | 'Custom'; gridVisible: boolean; revision: number; hoveredTopology: CadTopologyHit | null } = { view: 'Isometric', gridVisible: true, revision: 0, hoveredTopology: null };
    let installedReferenceVersion: string | null = null;
    let installedReferenceFeatureIds: readonly string[] = Object.freeze([]);
    let installedReferencePlanes: readonly CadPlane[] = Object.freeze([]);
    let hoveredPlaneReference: string | null = null;
    const updatePlaneLabels = () => {
      camera.updateMatrixWorld();
      for (const label of planeLabels.current?.querySelectorAll<HTMLElement>('[data-cad-plane-label]') ?? []) {
        const reference = installedReferences.get(label.dataset.cadPlaneLabel ?? '')?.reference;
        if (!reference?.labelPosition) { label.hidden = true; continue; }
        const point = new THREE.Vector3(...reference.labelPosition).project(camera);
        label.hidden = point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1;
        label.style.left = `${(point.x + 1) * container.clientWidth / 2}px`;
        label.style.top = `${(1 - point.y) * container.clientHeight / 2}px`;
      }
    };
    const render = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        if (disposed || renderer.getContext().isContextLost()) { frame = null; return; }
        const event = pendingHover; pendingHover = null;
        if (event && !down && !event.buttons && !data.current.interactionLocked) {
          setRay(event);
          if (data.current.pickMode === 'body') setFeatureHover(data.current.planePickingOnly ? null : hitFeature(), hitPlane()?.referenceId ?? null);
          else if (data.current.pickingEnabled) setHover(hitTopology());
        }
        updateReferenceStyles(); updatePlaneLabels(); renderer.render(scene, camera); frame = null;
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
        const area = readCadFitArea(container, data.current.getFitArea);
        if (!area) return;
        const bounds = new THREE.Box3().setFromObject(solids);
        const contours = data.current.references.filter(reference => !reference.planePatch);
        const fitReferences = !bounds.isEmpty() || contours.length ? contours : data.current.references;
        for (const reference of fitReferences) bounds.union(new THREE.Box3(new THREE.Vector3(...reference.bounds.min), new THREE.Vector3(...reference.bounds.max)));
        const center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
        const size = bounds.isEmpty() ? new THREE.Vector3(100, 100, 100) : bounds.getSize(new THREE.Vector3());
        const direction = camera.position.clone().sub(controls.target).normalize();
        camera.zoom = Math.min((camera.right - camera.left) * area.width / container.clientWidth, (camera.top - camera.bottom) * area.height / container.clientHeight) / Math.max(20, size.length() * 1.18);
        // Explicit Fit must not be clipped by the navigation limit on large parts.
        controls.minZoom = Math.min(0.01, camera.zoom);
        camera.updateMatrixWorld();
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
        center.addScaledVector(right, (container.clientWidth / 2 - area.left - area.width / 2) * (camera.right - camera.left) / (camera.zoom * container.clientWidth));
        center.addScaledVector(up, (area.top + area.height / 2 - container.clientHeight / 2) * (camera.top - camera.bottom) / (camera.zoom * container.clientHeight));
        controls.target.copy(center);
        camera.position.copy(center).addScaledVector(direction, Math.max(200, size.length() * 3));
        camera.far = Math.max(100000, size.length() * 10);
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
    const referenceSelected = (reference: CadViewportReference) => reference.plane ? cadSameReferencePlane(reference.plane, data.current.selectedReferencePlane)
      || reference.featureId !== null && reference.featureId === data.current.selectedId : reference.featureId === data.current.selectedId;
    const referenceColor = (reference: CadViewportReference) => referenceSelected(reference) ? 0xf0c779 : reference.referenceId === hoveredPlaneReference || reference.featureId !== null && reference.featureId === hoveredFeatureId ? 0x91edff
      : reference.featureKind === 'principal-plane' ? ({ XY: 0x80b7d4, XZ: 0x94cda4, YZ: 0xd2aaa0 }[reference.plane]) : reference.construction ? 0x698594 : 0x89b9c6;
    const updateReferenceStyles = () => {
      const worldPerPixel = (camera.top - camera.bottom) / camera.zoom / Math.max(1, container.clientHeight);
      for (const { reference, line, patch } of installedReferences.values()) {
        if (patch && patch.material instanceof THREE.MeshBasicMaterial) { patch.material.color.setHex(referenceColor(reference)); patch.material.opacity = referenceSelected(reference) ? .18 : reference.referenceId === hoveredPlaneReference ? .12 : .075; }
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
            patch.position.set(...origin); patch.userData.featureId = reference.featureId; patch.userData.referenceId = reference.referenceId; referenceLines.add(patch); patch.updateMatrixWorld(true);
          }
          installedReferences.set(reference.referenceId, { reference, line, patch });
        }
        pickableReferences.length = 0; installedReferences.forEach(({ line }) => pickableReferences.push(line));
        uploadedReferences.current = data.current.references;
      }
      installedReferenceVersion = data.current.referenceVersion;
      installedReferenceFeatureIds = cadReferenceFeatureIds(data.current.references);
      installedReferencePlanes = cadReferencePlanes(data.current.references);
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
      hoveredFeatureId = null;
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
        const hovered = child.userData.featureId === hoveredFeatureId;
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) child.material.color.setHex(selected ? 0x79c8e6 : hovered ? 0xb2d2df : 0xa3b0bf);
        else if (child instanceof THREE.LineSegments && child.material instanceof THREE.LineBasicMaterial) child.material.color.setHex(selected ? 0xb5eafd : hovered ? 0x91edff : 0x344452);
      }
      updateReferenceStyles();
      render();
    };
    const setFeatureHover = (id: string | null, planeId: string | null = null) => {
      if (hoveredFeatureId === id && hoveredPlaneReference === planeId) return;
      hoveredFeatureId = id; hoveredPlaneReference = planeId; viewState.revision++; updateSelection();
    };
    const raycaster = new THREE.Raycaster();
    let down: { pointerId: number; button: number; x: number; y: number; moved: boolean } | null = null;
    const activePointers = new Set<number>();
    const setRay = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / Math.max(1, rect.width) * 2 - 1, -(event.clientY - rect.top) / Math.max(1, rect.height) * 2 + 1), camera);
    };
    const hitTopology = () => data.current.pickMode === 'body' ? null : pickTopology({ mode: data.current.pickMode,
      raycaster, bodies: pickableBodies, edges: pickableEdges, meshByObject, camera, viewportHeight: container.clientHeight });
    const hitFeature = (): string | null => {
      const referenceId = pickCadCurveReference({ raycaster, references: pickableReferences.filter(line => line.userData.featureKind !== 'datum-plane' && line.userData.featureKind !== 'principal-plane'), bodies: pickableBodies, camera, viewportHeight: container.clientHeight });
      if (referenceId) return referenceId;
      const datumId = pickCadCurveReference({ raycaster, references: pickableReferences.filter(line => line.userData.featureKind === 'datum-plane'), bodies: pickableBodies, camera, viewportHeight: container.clientHeight });
      if (datumId) return datumId;
      const patches = [...installedReferences.values()].flatMap(entry => entry.patch && entry.reference.featureId !== null ? [entry.patch] : []);
      const patchHit = raycaster.intersectObjects(patches, false)[0];
      const surface = raycaster.intersectObjects(pickableBodies, false)[0];
      if (patchHit && (!surface || patchHit.distance <= surface.distance + 1e-7)) return patchHit.object.userData.featureId;
      const id: unknown = data.current.pickingEnabled ? surface?.object.userData.featureId : null;
      return typeof id === 'string' ? id : null;
    };
    const hitPlane = (): CadViewportReference | null => {
      const planeLines = pickableReferences.filter(line => installedReferences.get(line.userData.referenceId)?.reference.plane);
      raycaster.params.Line.threshold = (camera.top - camera.bottom) / camera.zoom / Math.max(1, container.clientHeight) * 5;
      const patches = [...installedReferences.values()].flatMap(entry => entry.patch && entry.reference.plane ? [entry.patch] : []);
      const hit = raycaster.intersectObjects([...planeLines, ...patches], false)[0];
      return hit ? installedReferences.get(hit.object.userData.referenceId)?.reference ?? null : null;
    };
    const pointerDown = (event: PointerEvent) => {
      pendingHover = null; setHover(null); setFeatureHover(null);
      if (data.current.interactionLocked && data.current.navigationLocked) return;
      activePointers.add(event.pointerId);
      renderer.domElement.focus({ preventScroll: true });
      if (data.current.interactionLocked) return;
      if (down && down.pointerId !== event.pointerId) down.moved = true;
      else if ((event.button === 0 || event.button === 2) && event.isPrimary !== false) down = { pointerId: event.pointerId, button: event.button, x: event.clientX, y: event.clientY, moved: false };
    };
    const pointerMove = (event: PointerEvent) => {
      if (down && down.pointerId === event.pointerId && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) down.moved = true;
      if (down || event.buttons || data.current.interactionLocked || !data.current.pickingEnabled && data.current.pickMode !== 'body') { setHover(null); setFeatureHover(null); return; }
      pendingHover = event; render();
    };
    const cancelPointerInteraction = () => {
      pendingHover = null; down = null; setHover(null); setFeatureHover(null);
      if (!activePointers.size) return;
      const cancelled = [...activePointers]; activePointers.clear();
      // Disconnect clears OrbitControls' active pointers and document drag
      // listeners. Reconnect preserves the camera/target and future gestures.
      controls.disconnect(); controls.connect(renderer.domElement);
      for (const pointerId of cancelled) {
        try { if (renderer.domElement.hasPointerCapture?.(pointerId)) renderer.domElement.releasePointerCapture(pointerId); }
        catch { /* Capture may already have been lost or cancelled by the browser. */ }
      }
    };
    const pointerLeave = () => cancelPointerInteraction();
    const pointerCancel = (event: PointerEvent) => { if (activePointers.has(event.pointerId)) cancelPointerInteraction(); };
    const lostPointerCapture = (event: PointerEvent) => { if (activePointers.has(event.pointerId)) cancelPointerInteraction(); };
    const pointerUp = (event: PointerEvent) => {
      const tracked = activePointers.delete(event.pointerId);
      // OrbitControls also listens on document. A foreign pointer release must
      // not terminate or reinterpret its active mouse/pen navigation gesture.
      if (!tracked && activePointers.size) { event.stopPropagation(); return; }
      if (!down || event.pointerId !== down.pointerId) return;
      if (event.button !== down.button || down.moved || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4 || data.current.interactionLocked) { down = null; return; }
      down = null;
      setRay(event);
      if (event.button === 2) {
        const hit = data.current.pickingEnabled ? hitTopology() : null;
        const id = data.current.pickMode === 'body' ? hitFeature() : null;
        data.current.onContextMenu?.({ clientX: event.clientX, clientY: event.clientY, trigger: 'pointer', target: hit ? { kind: 'topology', hit } : id ? { kind: 'feature', featureId: id } : null });
        return;
      }
      if (data.current.pickMode === 'body') {
        const plane = hitPlane();
        if (data.current.planePickingOnly) { if (plane?.plane) data.current.onSelectPlane?.(plane.plane); return; }
        const id = hitFeature();
        if (id) data.current.onSelect(id);
        else if (plane?.plane) data.current.onSelectPlane?.(plane.plane);
        else data.current.onSelect(null);
        return;
      }
      if (!data.current.pickingEnabled) return;
      data.current.onTopologyPick?.(hitTopology(), event.ctrlKey || event.metaKey);
    };
    // Native contextmenu timing differs across platforms. Open on release so
    // a right drag can finish as a pan without an early popup on mouse-down.
    const nativeContextMenu = (event: MouseEvent) => event.preventDefault();
    const keyboardContextMenu = (event: KeyboardEvent) => {
      if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
      event.preventDefault();
      if (data.current.interactionLocked || !data.current.onContextMenu || renderer.getContext().isContextLost()) return;
      cancelPointerInteraction();
      const selection = data.current.topologySelection;
      const mesh = selection && data.current.pickingEnabled ? data.current.meshes.find(mesh => mesh.featureId === selection.bodyId) : null;
      const pick = selection?.picks.find(pick => (pick.kind === 'edge' ? mesh?.edgeGroups : mesh?.faceGroups)?.some(group => group.key === pick.key));
      const selected = data.current.selectedId;
      const visibleFeature = selected && (data.current.references.some(reference => reference.featureId === selected) || data.current.pickingEnabled && data.current.meshes.some(mesh => mesh.featureId === selected));
      const rect = renderer.domElement.getBoundingClientRect();
      data.current.onContextMenu({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, trigger: 'keyboard',
        target: selection && pick ? { kind: 'topology', hit: { bodyId: selection.bodyId, pick } } : visibleFeature ? { kind: 'feature', featureId: selected } : null });
    };
    const wheelNavigation = (event: WheelEvent) => {
      if (data.current.navigationLocked || renderer.getContext().isContextLost()) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      // Ctrl-wheel is the browser's synthesized pinch gesture. OrbitControls
      // already normalizes it and prevents browser zoom on this canvas only.
      if (data.current.navigationMode !== 'trackpad' || event.ctrlKey) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (activePointers.size) return;
      const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
      const pixels = (delta: number, extent: number) => Number.isFinite(delta) ? THREE.MathUtils.clamp(delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? extent : 1), -2 * extent, 2 * extent) : 0;
      const x = pixels(event.deltaX, width), y = pixels(event.deltaY, height);
      if (!x && !y) return;
      pendingHover = null; setHover(null); setFeatureHover(null);
      if (event.altKey) {
        controls.rotateLeft(THREE.MathUtils.clamp(2 * Math.PI * x / height, -Math.PI / 2, Math.PI / 2));
        controls.rotateUp(THREE.MathUtils.clamp(2 * Math.PI * y / height, -Math.PI / 2, Math.PI / 2));
      } else controls.pan(-x, -y);
    };
    const onChange = () => {
      if (!fittingAutomatically) userFramed = true;
      if (viewState.view !== 'Custom' && camera.position.clone().sub(controls.target).normalize().distanceToSquared(namedDirection) > 1e-12) { viewState.view = 'Custom'; setViewName('Custom'); }
      viewState.revision++; render();
    };
    const onStart = () => { pendingHover = null; setHover(null); setFeatureHover(null); };
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
      cancelPointerInteraction();
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
    renderer.domElement.addEventListener('lostpointercapture', lostPointerCapture);
    renderer.domElement.addEventListener('contextmenu', nativeContextMenu);
    renderer.domElement.addEventListener('keydown', keyboardContextMenu);
    renderer.domElement.addEventListener('wheel', wheelNavigation, { capture: true, passive: false });
    window.addEventListener('blur', cancelPointerInteraction);
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    update();
    updateReferences();
    redraw.current = update;
    uploadReferences.current = updateReferences;
    recolor.current = updateSelection;
    highlight.current = () => {
      if (data.current.interactionLocked || !data.current.pickingEnabled || viewState.hoveredTopology?.pick.kind !== data.current.pickMode) viewState.hoveredTopology = null;
      updateHighlights();
    };
    cancelInteraction.current = cancelPointerInteraction;
    updateHighlights();
    controller.current = {
      getState: () => Object.freeze({ mode: 'solid', available: !disposed && !renderer.getContext().isContextLost(), view: viewState.view, gridVisible: viewState.gridVisible, zoom: camera.zoom, revision: viewState.revision, referenceVersion: installedReferenceVersion, referenceFeatureIds: installedReferenceFeatureIds, referencePlanes: installedReferencePlanes,
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
        updateReferenceStyles(); updatePlaneLabels(); renderer.render(scene, camera);
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
      renderer.domElement.removeEventListener('lostpointercapture', lostPointerCapture);
      renderer.domElement.removeEventListener('contextmenu', nativeContextMenu);
      renderer.domElement.removeEventListener('keydown', keyboardContextMenu);
      renderer.domElement.removeEventListener('wheel', wheelNavigation, true);
      window.removeEventListener('blur', cancelPointerInteraction);
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
      cancelInteraction.current = null;
      uploadedMeshes.current = null;
      uploadedReferences.current = null; uploadReferences.current = null;
      publish.current?.(null, publishedControls);
    };
  }, [contextGeneration]);

  useEffect(() => { if (uploadedMeshes.current !== meshes) redraw.current?.(); }, [meshes]);
  useLayoutEffect(() => { uploadReferences.current?.(); }, [references, referenceVersion]);
  useEffect(() => { recolor.current?.(); }, [selectedId, selectedReferencePlane]);
  useEffect(() => { highlight.current?.(); }, [topologySelection, pickMode, meshes, pickingEnabled, interactionLocked]);
  useLayoutEffect(() => {
    cancelInteraction.current?.();
    if (orbit.current) orbit.current.enabled = !navigationLocked;
    const canvas = host.current?.querySelector('canvas');
    if (canvas) canvas.tabIndex = navigationLocked && interactionLocked ? -1 : 0;
  }, [interactionLocked, navigationLocked, navigationMode, pickMode, meshes, references, referenceVersion, pickingEnabled]);
  return <div className="cad-viewport">
    <div className="cad-webgl" ref={host} aria-label="3D model viewport" />
    <div className="cad-plane-labels" ref={planeLabels} aria-label="Reference planes in design area">
      {references.filter(reference => reference.plane && reference.labelPosition).map(reference => <button key={reference.referenceId} type="button" data-cad-plane-label={reference.referenceId}
        aria-label={`Select ${reference.name} in design area`} aria-pressed={cadSameReferencePlane(reference.plane ?? null, selectedReferencePlane)}
        disabled={interactionLocked || unavailable || pickMode !== 'body' || !onSelectPlane} onClick={() => { if (reference.plane) onSelectPlane?.(reference.plane); }}>{reference.name}</button>)}
    </div>
    <CadViewTools label="Viewport controls">
      <Box size={14} />
      <select aria-label="Named view" value={viewName} disabled={navigationLocked || unavailable} onChange={(event) => {
        const name = (['Isometric', 'Top', 'Front', 'Right'] satisfies CadNamedView[]).find((entry) => entry === event.target.value);
        if (name) controller.current?.setView?.(name);
      }}>{viewName === 'Custom' && <option value="Custom" disabled>Custom</option>}{(['Isometric', 'Top', 'Front', 'Right'] satisfies CadNamedView[]).map((name) => <option key={name} value={name}>{name}</option>)}</select>
      <span className="cad-divider" />
      <button title="Fit model" aria-label="Fit model" disabled={navigationLocked || unavailable} onClick={() => controller.current?.fit()}><Maximize2 size={14} /></button>
      <button title="Toggle grid" aria-label="Toggle grid" disabled={navigationLocked || unavailable} aria-pressed={gridVisible} onClick={() => controller.current?.setGrid(!gridVisible)}><Grid2X2 size={14} /></button>
      {onPickMode && <><span className="cad-divider" />
        {(['body', 'face', 'edge'] satisfies CadPickMode[]).map((mode) => <button key={mode} disabled={interactionLocked || unavailable || !pickingEnabled} aria-pressed={pickMode === mode} title={`Pick ${mode === 'body' ? 'bodies' : `${mode}s`}`} onClick={() => onPickMode(mode)}>{mode === 'body' ? 'Body' : mode === 'face' ? 'Face' : 'Edge'}</button>)}
      </>}
      <CadContextHelp label="Model navigation">{navigationMode === 'trackpad' ? 'Use two-finger scrolling to pan, pinch to zoom, and Alt + scroll to orbit.' : 'Drag to orbit, drag with the right mouse button to pan, and use the wheel to zoom.'} Ctrl or Command + click toggles individual edge selections.</CadContextHelp>
    </CadViewTools>
    {unavailable ? <div className="cad-view-message" role="status"><strong>{graphicsFailure === 'lost' ? 'The 3D graphics context was interrupted.' : '3D graphics are unavailable in this browser.'}</strong><span>{graphicsFailure === 'lost' ? 'Waiting for recovery. Retry the view if it stays blank; your CAD document is retained.' : 'Sketch editing and document operations remain available. Enable WebGL to view solids.'}</span><button type="button" disabled={interactionLocked} onClick={() => setContextGeneration(generation => generation + 1)}>Retry 3D view</button></div> : null}
    {topologySelection?.picks.length ? <div className="cad-view-caption">{topologySelection.picks.length} {topologySelection.picks[0].kind}{topologySelection.picks.length === 1 ? '' : 's'} selected</div> : null}
  </div>;
}
