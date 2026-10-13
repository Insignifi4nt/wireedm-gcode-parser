import { useEffect, useRef, useState } from 'react';
import { Box, Grid2X2, Maximize2 } from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CadMesh } from '@/domain/cad/cadDocument';
import { captureCanvas } from '@/features/editor/captureEditorPreview';
import type { CadNamedView, CadRenderedViewControls } from './cadViewportControls';

export function CadViewport({ meshes, selectedId, onSelect, onControlsReady, interactionLocked = false }: {
  meshes: readonly CadMesh[];
  selectedId: string | null;
  onSelect(id: string | null): void;
  onControlsReady?(controls: CadRenderedViewControls | null, released?: CadRenderedViewControls): void;
  interactionLocked?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<CadRenderedViewControls | null>(null);
  const publish = useRef(onControlsReady);
  publish.current = onControlsReady;
  const data = useRef({ meshes, selectedId, onSelect });
  data.current = { meshes, selectedId, onSelect };
  const redraw = useRef<(() => void) | null>(null);
  const recolor = useRef<(() => void) | null>(null);
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
    scene.add(solids);
    let frame: number | null = null;
    const viewState: { view: CadNamedView | 'Custom'; gridVisible: boolean; revision: number } = { view: 'Isometric', gridVisible: true, revision: 0 };
    const render = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => { frame = null; renderer.render(scene, camera); });
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
        const edges = new THREE.BufferGeometry();
        edges.setAttribute('position', new THREE.Float32BufferAttribute(mesh.edges, 3));
        const lines = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: selected ? 0xb5eafd : 0x344452 }));
        lines.userData.featureId = mesh.featureId;
        solids.add(lines);
      }
      if (firstBody && data.current.meshes.length) { firstBody = false; fit(); }
      render();
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
    const pointerDown = (event: PointerEvent) => { if (event.button === 0) down = { x: event.clientX, y: event.clientY }; };
    const pointerUp = (event: PointerEvent) => {
      if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) { down = null; return; }
      down = null;
      const rect = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
      const hit = raycaster.intersectObjects(pickableBodies, false)[0];
      const id: unknown = hit?.object.userData.featureId;
      data.current.onSelect(typeof id === 'string' ? id : null);
    };
    const onChange = () => { viewState.revision++; render(); };
    const onStart = () => { viewState.view = 'Custom'; setViewName('Custom'); };
    controls.addEventListener('change', onChange);
    controls.addEventListener('start', onStart);
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    update();
    redraw.current = update;
    recolor.current = updateSelection;
    controller.current = {
      getState: () => Object.freeze({ mode: 'solid', available: true, view: viewState.view, gridVisible: viewState.gridVisible, zoom: camera.zoom, revision: viewState.revision }),
      fit,
      setGrid(visible) { grid.visible = visible; viewState.gridVisible = visible; viewState.revision++; setGridVisible(visible); render(); },
      setView(name) {
        const direction = name === 'Top' ? new THREE.Vector3(0, 0, 1) : name === 'Front' ? new THREE.Vector3(0, -1, 0) : name === 'Right' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(1, -1.2, 0.9).normalize();
        const distance = Math.max(1000, camera.position.distanceTo(controls.target));
        camera.up.set(0, name === 'Top' ? 1 : 0, name === 'Top' ? 0 : 1);
        camera.position.copy(controls.target).addScaledVector(direction, distance);
        viewState.view = name; viewState.revision++; setViewName(name);
        controls.update(); render();
      },
      async capture(signal) {
        signal.throwIfAborted();
        if (uploadedMeshes.current !== data.current.meshes) update();
        updateSelection();
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
      if (frame !== null) cancelAnimationFrame(frame);
      disposeSolids();
      grid.geometry.dispose();
      for (const material of Array.isArray(grid.material) ? grid.material : [grid.material]) material.dispose();
      axes.geometry.dispose();
      for (const material of Array.isArray(axes.material) ? axes.material : [axes.material]) material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      controller.current = null;
      redraw.current = null;
      recolor.current = null;
      uploadedMeshes.current = null;
      publish.current?.(null, publishedControls);
    };
  }, []);

  useEffect(() => { if (uploadedMeshes.current !== meshes) redraw.current?.(); }, [meshes]);
  useEffect(() => { recolor.current?.(); }, [selectedId]);
  useEffect(() => { if (orbit.current) orbit.current.enabled = !interactionLocked; }, [interactionLocked]);
  return <div className="cad-viewport">
    <div className="cad-webgl" ref={host} aria-label="3D model viewport" />
    <div className="cad-view-tools" aria-label="Viewport controls">
      <Box size={14} />
      {(['Isometric', 'Top', 'Front', 'Right'] satisfies CadNamedView[]).map((name) => <button key={name} disabled={interactionLocked || unavailable} aria-pressed={viewName === name} onClick={() => controller.current?.setView?.(name)}>{name}</button>)}
      <span className="cad-divider" />
      <button title="Fit model" aria-label="Fit model" disabled={interactionLocked || unavailable} onClick={() => controller.current?.fit()}><Maximize2 size={14} /></button>
      <button title="Toggle grid" aria-label="Toggle grid" disabled={interactionLocked || unavailable} aria-pressed={gridVisible} onClick={() => controller.current?.setGrid(!gridVisible)}><Grid2X2 size={14} /></button>
    </div>
    {unavailable ? <div className="cad-view-message"><strong>3D graphics are unavailable in this browser.</strong><span>Sketch editing and document operations remain available. Enable WebGL to view solids.</span></div> : meshes.length === 0 ? <div className="cad-view-message"><strong>Your part starts with a sketch</strong><span>Create a sketch on a reference plane, then draw a profile and add a Pad or Revolve.</span></div> : null}
    <div className="cad-view-caption">{viewName} <span>ORTHOGRAPHIC</span></div>
    <div className="cad-view-help">Drag to orbit · Right drag to pan · Scroll to zoom</div>
  </div>;
}
