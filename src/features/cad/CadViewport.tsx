import { useEffect, useRef, useState } from 'react';
import { Box, Grid2X2, Maximize2 } from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CadMesh } from '@/domain/cad/cadDocument';
import type { CadTopologyPickSet } from '@/domain/cad/cadTopology';
import { captureCanvas } from '@/features/editor/captureEditorPreview';
import type { CadNamedView, CadRenderedViewControls } from './cadViewportControls';
import { pickTopology, type CadPickMode, type CadTopologyHit } from './cadTopologyPicking';
import { createCadTopologyHighlights } from './cadTopologyHighlights';

export function CadViewport({ meshes, selectedId, onSelect, onControlsReady, interactionLocked = false,
  pickMode = 'body', topologySelection = null, onPickMode, onTopologyPick, pickingEnabled = true }: {
  meshes: readonly CadMesh[];
  selectedId: string | null;
  onSelect(id: string | null): void;
  onControlsReady?(controls: CadRenderedViewControls | null, released?: CadRenderedViewControls): void;
  interactionLocked?: boolean;
  pickMode?: CadPickMode;
  topologySelection?: CadTopologyPickSet | null;
  onPickMode?(mode: CadPickMode): void;
  onTopologyPick?(hit: CadTopologyHit | null, additive: boolean): void;
  pickingEnabled?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<CadRenderedViewControls | null>(null);
  const publish = useRef(onControlsReady);
  publish.current = onControlsReady;
  const data = useRef({ meshes, selectedId, onSelect, pickMode, topologySelection, onTopologyPick, interactionLocked, pickingEnabled });
  data.current = { meshes, selectedId, onSelect, pickMode, topologySelection, onTopologyPick, interactionLocked, pickingEnabled };
  const redraw = useRef<(() => void) | null>(null);
  const recolor = useRef<(() => void) | null>(null);
  const highlight = useRef<(() => void) | null>(null);
  const uploadedMeshes = useRef<readonly CadMesh[] | null>(null);
  const orbit = useRef<OrbitControls | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [gridVisible, setGridVisible] = useState(true);
  const [viewName, setViewName] = useState<CadNamedView | 'Custom'>('Isometric');

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { setUnavailable(true); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x18252e);
    const camera = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.01, 100000);
    camera.up.set(0, 0, 1);
    camera.position.set(160, -180, 140);
    const controls = new OrbitControls(camera, renderer.domElement);
    orbit.current = controls;
    controls.enableDamping = false;
    controls.screenSpacePanning = true;
    controls.minZoom = 0.01;
    controls.maxZoom = 10000;
    scene.add(new THREE.HemisphereLight(0xd7e6ff, 0x383b43, 2));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(100, -100, 200);
    scene.add(light);
    const grid = new THREE.GridHelper(1000, 100, 0x465666, 0x293640);
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);
    const axes = new THREE.AxesHelper(30);
    scene.add(axes);
    const solids = new THREE.Group();
    const pickableBodies: THREE.Mesh[] = [];
    const pickableEdges: THREE.LineSegments[] = [];
    const meshByObject = new Map<THREE.Object3D, CadMesh>();
    const highlights = createCadTopologyHighlights();
    scene.add(solids);
    scene.add(highlights.objects);
    let frame: number | null = null;
    let pendingHover: PointerEvent | null = null;
    let namedDirection = camera.position.clone().sub(controls.target).normalize();
    const viewState: { view: CadNamedView | 'Custom'; gridVisible: boolean; revision: number; hoveredTopology: CadTopologyHit | null } = { view: 'Isometric', gridVisible: true, revision: 0, hoveredTopology: null };
    const render = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        const event = pendingHover; pendingHover = null;
        if (event && !down && !event.buttons && !data.current.interactionLocked && data.current.pickingEnabled && data.current.pickMode !== 'body') {
          setRay(event); setHover(hitTopology());
        }
        renderer.render(scene, camera); frame = null;
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
    const fit = () => {
      const bounds = new THREE.Box3().setFromObject(solids);
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
    let firstBody = true;
    const update = () => {
      uploadedMeshes.current = data.current.meshes;
      disposeSolids();
      for (const mesh of data.current.meshes) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normals, 3));
        geometry.setIndex([...mesh.indices]);
        const selected = mesh.featureId === data.current.selectedId;
        const material = new THREE.MeshStandardMaterial({ color: selected ? 0x79c8e6 : 0xa3b0bf, roughness: 0.55, metalness: 0.18, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
        const body = new THREE.Mesh(geometry, material);
        body.userData.featureId = mesh.featureId;
        solids.add(body);
        pickableBodies.push(body);
        meshByObject.set(body, mesh);
        const edges = new THREE.BufferGeometry();
        edges.setAttribute('position', new THREE.Float32BufferAttribute(mesh.edges, 3));
        const lines = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: selected ? 0xb5eafd : 0x344452 }));
        lines.userData.featureId = mesh.featureId;
        solids.add(lines);
        pickableEdges.push(lines);
        meshByObject.set(lines, mesh);
      }
      if (firstBody && data.current.meshes.length) { firstBody = false; fit(); }
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
      if (event.button !== 0 || !down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4 || data.current.interactionLocked || !data.current.pickingEnabled) { down = null; return; }
      down = null;
      setRay(event);
      if (data.current.pickMode !== 'body') { data.current.onTopologyPick?.(hitTopology(), event.ctrlKey || event.metaKey); return; }
      const hit = raycaster.intersectObjects(pickableBodies, false)[0];
      const id: unknown = hit?.object.userData.featureId;
      data.current.onSelect(typeof id === 'string' ? id : null);
    };
    const onChange = () => {
      if (viewState.view !== 'Custom' && camera.position.clone().sub(controls.target).normalize().distanceToSquared(namedDirection) > 1e-12) { viewState.view = 'Custom'; setViewName('Custom'); }
      viewState.revision++; render();
    };
    const onStart = () => { pendingHover = null; setHover(null); };
    controls.addEventListener('change', onChange);
    controls.addEventListener('start', onStart);
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    renderer.domElement.addEventListener('pointermove', pointerMove);
    renderer.domElement.addEventListener('pointerleave', pointerLeave);
    renderer.domElement.addEventListener('pointercancel', pointerCancel);
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    update();
    redraw.current = update;
    recolor.current = updateSelection;
    highlight.current = () => {
      if (!data.current.pickingEnabled || viewState.hoveredTopology?.pick.kind !== data.current.pickMode) viewState.hoveredTopology = null;
      updateHighlights();
    };
    updateHighlights();
    controller.current = {
      getState: () => Object.freeze({ mode: 'solid', available: true, view: viewState.view, gridVisible: viewState.gridVisible, zoom: camera.zoom, revision: viewState.revision,
        hoveredTopology: viewState.hoveredTopology ? Object.freeze({ ...viewState.hoveredTopology, pick: Object.freeze({ ...viewState.hoveredTopology.pick }) }) : null }),
      fit,
      setGrid(visible) { grid.visible = visible; viewState.gridVisible = visible; viewState.revision++; setGridVisible(visible); render(); },
      setView(name) {
        const direction = name === 'Top' ? new THREE.Vector3(0, 0, 1) : name === 'Front' ? new THREE.Vector3(0, -1, 0) : name === 'Right' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(1, -1.2, 0.9).normalize();
        const distance = Math.max(1000, camera.position.distanceTo(controls.target));
        camera.up.set(0, name === 'Top' ? 1 : 0, name === 'Top' ? 0 : 1);
        camera.position.copy(controls.target).addScaledVector(direction, distance);
        namedDirection = direction.clone().normalize();
        viewState.view = name; viewState.revision++; setViewName(name);
        controls.update(); render();
      },
      async capture(signal) {
        signal.throwIfAborted();
        if (uploadedMeshes.current !== data.current.meshes) update();
        updateSelection();
        updateHighlights();
        controls.update();
        if (frame !== null) { cancelAnimationFrame(frame); frame = null; }
        renderer.render(scene, camera);
        const image = captureCanvas(renderer.domElement, '3d');
        signal.throwIfAborted();
        return image;
      },
    };
    const publishedControls = controller.current;
    publish.current?.(publishedControls);
    return () => {
      observer.disconnect();
      controls.removeEventListener('change', onChange);
      controls.removeEventListener('start', onStart);
      controls.dispose();
      orbit.current = null;
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('pointermove', pointerMove);
      renderer.domElement.removeEventListener('pointerleave', pointerLeave);
      renderer.domElement.removeEventListener('pointercancel', pointerCancel);
      if (frame !== null) cancelAnimationFrame(frame);
      disposeSolids();
      highlights.dispose();
      grid.geometry.dispose();
      for (const material of Array.isArray(grid.material) ? grid.material : [grid.material]) material.dispose();
      axes.geometry.dispose();
      for (const material of Array.isArray(axes.material) ? axes.material : [axes.material]) material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      controller.current = null;
      redraw.current = null;
      recolor.current = null;
      highlight.current = null;
      uploadedMeshes.current = null;
      publish.current?.(null, publishedControls);
    };
  }, []);

  useEffect(() => { if (uploadedMeshes.current !== meshes) redraw.current?.(); }, [meshes]);
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
    {unavailable ? <div className="cad-view-message"><strong>3D graphics are unavailable in this browser.</strong><span>Sketch editing and document operations remain available. Enable WebGL to view solids.</span></div> : meshes.length === 0 ? <div className="cad-view-message"><strong>Your part starts with a sketch</strong><span>Create a sketch on a reference plane, then draw a profile and add a Pad or Revolve.</span></div> : null}
    {topologySelection?.picks.length ? <div className="cad-view-caption">{topologySelection.picks.length} {topologySelection.picks[0].kind}{topologySelection.picks.length === 1 ? '' : 's'} selected</div> : null}
    <div className="cad-view-help">{pickMode === 'edge' ? 'Ctrl / Cmd click to toggle edges · ' : ''}Drag to orbit · Right drag to pan · Scroll to zoom</div>
  </div>;
}
