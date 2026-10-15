import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, Grid2X2, Magnet, Maximize2, Undo2, X } from 'lucide-react';
import { CadContextHelp } from './CadContextHelp';
import { CadViewTools } from './CadCommandDock';
import type { CadCurveFeature, CadPathSegment, CadProfile, CadSketchFeature, CadSketchProfile } from '@/domain/cad/cadDocument';
import { resolveCadCurveGeometry } from '@/domain/cad/cadCurve';
import { captureSvgPreview } from '@/features/editor/captureEditorPreview';
import { ToolError } from '@/features/webmcp/siteTools';
import type { CadRenderedViewControls, CadRenderedViewState } from './cadViewportControls';
import { closeSketchPolygon, snapSketchPathPoint, snapSketchPoint, twoPointSketchProfile, type SketchPoint, type SketchTool } from './cadSketchInteraction';
import { CadSketchProfileGeometry } from './CadSketchProfileGeometry';
import { createCadSketchProfilePicker } from './cadSketchPicking';
import { cadPathDraftEndpoint, closeCadPathDraft, createCadPathDraft, finishCadCurveDraft, previewCadPathDraft, updateCadPathDraft, type CadPathDrawingAction } from './cadPathDrawing';
import { CadPathDraftGeometry, CadPathSegmentGeometry } from './CadPathDraftGeometry';
import { cadProfileReferenceGeometry } from './cadViewportReferences';
import { CadGearInspectionOverlay } from './CadGearInspectionOverlay';
import { CadSketchDimensionControls, type CadSketchDimensionControlsProps } from './CadSketchDimensionControls';
import { readCadFitArea, type CadFitAreaReader } from './cadFitArea';
import { translateCadSketchProfile } from '@/domain/cad/cadSketchConstraints';

const NO_PROFILES: readonly CadSketchProfile[] = Object.freeze([]);
export interface CadSketchContextMenuRequest {
  readonly clientX: number;
  readonly clientY: number;
  readonly trigger: 'pointer' | 'keyboard';
  readonly profileId: string | null;
  readonly pointMm: SketchPoint;
}
interface CadSketchProfileDrag {
  readonly profile: CadSketchProfile;
  readonly sketch: CadSketchFeature;
  readonly parameters: Readonly<Record<string, number>>;
  readonly pointerId: number;
  readonly element: SVGSVGElement;
  readonly clientX: number;
  readonly clientY: number;
  readonly mmPerPixelX: number;
  readonly mmPerPixelY: number;
  readonly snap: boolean;
  readonly gridStep: number;
  moved: boolean;
  translation: SketchPoint;
}

export function CadSketchCanvas({ sketch, parameters, documentVersion, placementLabel, tool, selectedProfileId, onSelectProfile, onAddProfile, onTranslateProfile, onAddCurve, onCancelCurve, curveCreation = false, onPendingChange, onError, cancelSignal, interactionLocked = false, onControlsReady, viewLocked = false, navigationMode = 'mouse', onContextMenu, previewProfile, inspection, dimensionControls, getFitArea }: {
  sketch: CadSketchFeature | CadCurveFeature;
  parameters: Readonly<Record<string, number>>;
  documentVersion?: string;
  placementLabel?: string;
  tool: SketchTool;
  selectedProfileId: string | null;
  onSelectProfile(id: string | null): void;
  onAddProfile(geometry: CadProfile): void;
  onTranslateProfile?(profileId: string, translation: SketchPoint): void;
  onAddCurve?(segments: readonly CadPathSegment[]): void;
  onCancelCurve?(): void;
  curveCreation?: boolean;
  onPendingChange(pending: boolean): void;
  onError(message: string): void;
  cancelSignal: number;
  interactionLocked?: boolean;
  onControlsReady?(controls: CadRenderedViewControls | null, released?: CadRenderedViewControls): void;
  viewLocked?: boolean;
  navigationMode?: 'mouse' | 'trackpad';
  onContextMenu?(request: CadSketchContextMenuRequest): void;
  previewProfile?: CadSketchProfile | null;
  inspection?: { profileIds: readonly string[]; gear?: { profileId: string; inputName: string } };
  dimensionControls?: Pick<CadSketchDimensionControlsProps, 'document' | 'onEditMany' | 'onPendingChange' | 'interactionLocked' | 'onInspectInput' | 'onConfigure'>;
  getFitArea?: CadFitAreaReader;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const instructionsId = useId();
  const [points, setPoints] = useState<readonly SketchPoint[]>([]);
  const [pathDraft, setPathDraft] = useState(createCadPathDraft);
  const [cursor, setCursor] = useState<SketchPoint>([0, 0]);
  const [center, setCenter] = useState<SketchPoint>([0, 0]);
  const [span, setSpan] = useState(160);
  const [aspect, setAspect] = useState(1.3);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const measuredAspect = useRef(aspect);
  const [snap, setSnap] = useState(true);
  const [grid, setGrid] = useState(true);
  const [gridStep, setGridStep] = useState(5);
  const profileDrag = useRef<CadSketchProfileDrag | null>(null);
  const [dragPreview, setDragPreview] = useState<{ profile: CadSketchProfile; translation: SketchPoint } | null>(null);
  const suppressProfileClick = useRef(false);
  const pendingChange = useRef(onPendingChange);
  pendingChange.current = onPendingChange;
  const finishProfileDrag = useCallback((pointerId?: number) => {
    const active = profileDrag.current;
    if (!active || pointerId !== undefined && pointerId !== active.pointerId) return null;
    profileDrag.current = null;
    setDragPreview(null);
    if (active.moved) pendingChange.current(false);
    try { if (active.element.hasPointerCapture?.(active.pointerId)) active.element.releasePointerCapture(active.pointerId); }
    catch { /* Capture may have ended before the cancellation event reached React. */ }
    return active;
  }, []);
  useEffect(() => {
    const blurred = () => finishProfileDrag();
    window.addEventListener('blur', blurred);
    return () => { window.removeEventListener('blur', blurred); finishProfileDrag(); };
  }, [finishProfileDrag]);
  const pan = useRef<{ x: number; y: number; center: SketchPoint; pointerId: number; button: number; buttonMask: number; moved: boolean; element: SVGSVGElement } | null>(null);
  const finishPan = useCallback((pointerId?: number) => {
    const active = pan.current;
    if (!active || pointerId !== undefined && pointerId !== active.pointerId) return;
    pan.current = null;
    try { if (active.element.hasPointerCapture?.(active.pointerId)) active.element.releasePointerCapture(active.pointerId); }
    catch { /* Capture may already have ended when the browser cancelled the pointer. */ }
  }, []);
  useEffect(() => {
    const blurred = () => finishPan();
    window.addEventListener('blur', blurred);
    return () => { window.removeEventListener('blur', blurred); finishPan(); };
  }, [finishPan]);
  const profiles = useMemo(() => sketch.kind === 'sketch' ? sketch.profiles.map(profile => previewProfile?.id === profile.id ? previewProfile : profile) : NO_PROFILES, [sketch, previewProfile]);
  const inspectedGear = inspection?.gear ? profiles.find(profile => profile.id === inspection.gear?.profileId) : null;
  const savedCurve = useMemo(() => {
    if (sketch.kind !== 'curve' || !sketch.segments.length) return null;
    try { return resolveCadCurveGeometry(sketch, parameters); } catch { return null; }
  }, [sketch, parameters]);
  const profilePicker = useMemo(() => createCadSketchProfilePicker(profiles, parameters), [profiles, parameters]);
  useLayoutEffect(() => { finishPan(); }, [documentVersion, interactionLocked, cancelSignal, sketch.id, profilePicker, finishPan]);
  useLayoutEffect(() => { finishProfileDrag(); }, [documentVersion, sketch, parameters, tool, selectedProfileId, interactionLocked, cancelSignal, previewProfile, center, span, aspect, snap, gridStep, navigationMode, finishProfileDrag]);
  const width = span * aspect;
  const navigation = useRef({ center, span, aspect, viewLocked, navigationMode });
  navigation.current = { center, span, aspect, viewLocked, navigationMode };
  useLayoutEffect(() => { finishPan(); if (viewLocked && !profileDrag.current?.moved) finishProfileDrag(); }, [viewLocked, navigationMode, finishPan, finishProfileDrag]);
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      // React delegates wheel with a passive listener. A native non-passive
      // listener confines browser pinch/scroll prevention to the drawing surface.
      event.preventDefault();
      const current = navigation.current, rect = element.getBoundingClientRect();
      if (current.viewLocked || pan.current || profileDrag.current || !rect.width || !rect.height) return;
      const pixels = (delta: number, extent: number) => Number.isFinite(delta) ? Math.max(-2 * extent, Math.min(2 * extent, delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? extent : 1))) : 0;
      const x = pixels(event.deltaX, rect.width), y = pixels(event.deltaY, rect.height);
      let nextCenter: SketchPoint, nextSpan = current.span;
      if (current.navigationMode === 'trackpad' && !event.ctrlKey) {
        nextCenter = [current.center[0] + x / rect.width * current.span * current.aspect, current.center[1] - y / rect.height * current.span];
      } else {
        if (!y) return;
        nextSpan = Math.max(.1, Math.min(100000, current.span * Math.exp(Math.max(-1, Math.min(1, y * .001)))));
        const cursorX = (event.clientX - rect.left) / rect.width - .5, cursorY = .5 - (event.clientY - rect.top) / rect.height;
        nextCenter = [current.center[0] + cursorX * current.aspect * (current.span - nextSpan), current.center[1] + cursorY * (current.span - nextSpan)];
      }
      navigation.current = { ...current, center: nextCenter, span: nextSpan };
      setCenter(nextCenter); setSpan(nextSpan);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  const renderedPlane = useMemo(() => typeof sketch.plane === 'string' ? sketch.plane : Object.freeze({ ...sketch.plane }), [sketch.plane]);
  const viewRevision = useRef({ signature: '', revision: 0 });
  const viewSignature = JSON.stringify([sketch.plane, center, span, aspect, grid, snap, gridStep, previewProfile?.geometry, inspection, dragPreview?.translation]);
  if (viewRevision.current.signature !== viewSignature) { viewRevision.current = { signature: viewSignature, revision: viewRevision.current.revision + 1 }; }
  const currentView = useRef<CadRenderedViewState>({ mode: sketch.kind, available: false, plane: renderedPlane, gridVisible: grid, snapEnabled: snap, gridStepMm: gridStep, centerMm: center, heightSpanMm: span, revision: viewRevision.current.revision });
  currentView.current = Object.freeze({ mode: sketch.kind, available: Boolean(svg.current), plane: renderedPlane, gridVisible: grid, snapEnabled: snap, gridStepMm: gridStep, centerMm: Object.freeze([...center] satisfies [number, number]), heightSpanMm: span, revision: viewRevision.current.revision });
  const fitView = useRef<(() => void) | null>(null);
  const initialCursorFit = useRef(false);
  useLayoutEffect(() => {
    const container = host.current;
    if (!container) return;
    const measure = () => { if (container.clientWidth && container.clientHeight) { measuredAspect.current = container.clientWidth / container.clientHeight; setAspect(measuredAspect.current); setViewportSize({ width: container.clientWidth, height: container.clientHeight }); } };
    // Commit the actual aspect before another task can see capture availability.
    // ResizeObserver's first asynchronous delivery then repeats this measurement.
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const controls: CadRenderedViewControls = {
      getState: () => Object.freeze({ ...currentView.current, available: Boolean(svg.current) }),
      fit: () => fitView.current?.(),
      setGrid: setGrid,
      async capture(signal) {
        signal.throwIfAborted();
        const element = svg.current;
        if (!element) throw new ToolError('CAPTURE_UNAVAILABLE', 'Open a visible sketch first.');
        const revision = currentView.current.revision;
        const image = await captureSvgPreview(element, signal);
        signal.throwIfAborted();
        if (svg.current !== element || currentView.current.revision !== revision) throw new ToolError('STALE_VIEW', 'The sketch view changed during capture. Capture the current view again.');
        return image;
      },
    };
    onControlsReady?.(controls);
    return () => onControlsReady?.(null, controls);
  }, [onControlsReady]);
  useEffect(() => { setPoints([]); setPathDraft(createCadPathDraft()); }, [sketch.id, tool, cancelSignal]);
  const pathPending = tool === 'path' && pathDraft.kind !== 'idle';
  useLayoutEffect(() => { onPendingChange(points.length > 0 || pathPending || dragPreview !== null); }, [points.length, pathPending, dragPreview !== null, onPendingChange]);
  const getRawPoint = (event: { clientX: number; clientY: number }): SketchPoint | null => {
    const rect = svg.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return [center[0] + (event.clientX - rect.left - rect.width / 2) / rect.width * width, center[1] - (event.clientY - rect.top - rect.height / 2) / rect.height * span];
  };
  const snapPoint = (point: SketchPoint): SketchPoint => tool === 'path'
    ? snapSketchPathPoint(point, pathDraft.kind === 'idle' ? null : pathDraft.start, span / (svg.current?.getBoundingClientRect().height || Infinity), gridStep, snap)
    : snapSketchPoint(point, gridStep, snap);
  const getPoint = (event: { clientX: number; clientY: number }): SketchPoint => snapPoint(getRawPoint(event) ?? [0, 0]);
  const moveProfile = (event: { pointerId: number; clientX: number; clientY: number }) => {
    const active = profileDrag.current;
    if (!active || event.pointerId !== active.pointerId) return;
    if (!active.moved && Math.hypot(event.clientX - active.clientX, event.clientY - active.clientY) <= 4) return;
    active.moved = true; suppressProfileClick.current = true;
    const snapped = snapSketchPoint([(event.clientX - active.clientX) * active.mmPerPixelX, -(event.clientY - active.clientY) * active.mmPerPixelY], active.gridStep, active.snap);
    const translation: SketchPoint = [snapped[0] === 0 ? 0 : snapped[0], snapped[1] === 0 ? 0 : snapped[1]];
    try {
      const profile = translateCadSketchProfile({ profile: active.profile, translation, parameters: active.parameters });
      active.translation = translation;
      setDragPreview(current => current && current.translation[0] === translation[0] && current.translation[1] === translation[1] ? current : { profile, translation });
    } catch (error) { finishProfileDrag(); onError(error instanceof Error ? error.message : 'Unable to move this contour.'); }
  };
  const changePath = (action: CadPathDrawingAction, focus = false) => {
    if (interactionLocked) return;
    try { setPathDraft(updateCadPathDraft(pathDraft, action)); }
    catch (error) { onError(error instanceof Error ? error.message : 'Unable to draw this path.'); }
    if (action.kind === 'cancel' && curveCreation) onCancelCurve?.();
    if (focus) svg.current?.focus();
  };
  const closePath = () => {
    if (interactionLocked) return;
    try {
      if (sketch.kind === 'curve') {
        if (!onAddCurve || !curveCreation) throw new Error('Edit the existing curve dimensions in Properties.');
        onAddCurve(finishCadCurveDraft(pathDraft));
      } else onAddProfile(closeCadPathDraft(pathDraft));
      setPathDraft(updateCadPathDraft(pathDraft, { kind: 'cancel' }));
    }
    catch (error) { onError(error instanceof Error ? error.message : 'Unable to close this path.'); }
    svg.current?.focus();
  };
  const add = (geometry: CadProfile) => {
    try { onAddProfile(geometry); setPoints([]); }
    catch (error) { onError(error instanceof Error ? error.message : 'Unable to add this profile.'); }
  };
  const close = () => {
    try { add(closeSketchPolygon(points)); }
    catch (error) { onError(error instanceof Error ? error.message : 'Unable to close this profile.'); }
  };
  const fit = () => {
    const coordinates: SketchPoint[] = [];
    if (savedCurve) coordinates.push([savedCurve.bounds.minX, savedCurve.bounds.minY], [savedCurve.bounds.maxX, savedCurve.bounds.maxY]);
    for (const profile of profiles) {
      try {
        const { bounds } = cadProfileReferenceGeometry(profile.geometry, parameters);
        coordinates.push([bounds.minX, bounds.minY], [bounds.maxX, bounds.maxY]);
      } catch { /* Invalid profiles retain their diagnostic in the property editor. */ }
    }
    if (!coordinates.length) { setCenter([0, 0]); setSpan(160); return; }
    const xs = coordinates.map((point) => point[0]), ys = coordinates.map((point) => point[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const target: SketchPoint = [minX / 2 + maxX / 2, minY / 2 + maxY / 2];
    const viewport = host.current;
    const area = viewport ? readCadFitArea(viewport, getFitArea) : null;
    if (getFitArea && !area) return;
    const availableWidth = area && viewport ? area.width / viewport.clientWidth : 1;
    const availableHeight = area && viewport ? area.height / viewport.clientHeight : 1;
    const heightSpan = Math.max(20, (maxY - minY) / availableHeight, (maxX - minX) / (measuredAspect.current * availableWidth)) * 1.25;
    const framedCenter: SketchPoint = area && viewport ? [target[0] + (viewport.clientWidth / 2 - area.left - area.width / 2) * heightSpan / viewport.clientHeight,
      target[1] + (area.top + area.height / 2 - viewport.clientHeight / 2) * heightSpan / viewport.clientHeight] : target;
    setCenter(framedCenter); setSpan(heightSpan);
    if (initialCursorFit.current) {
      const snapped = snapSketchPoint(target, gridStep, snap);
      setCursor(Math.abs(snapped[0] - target[0]) <= heightSpan * measuredAspect.current / 2 && Math.abs(snapped[1] - target[1]) <= heightSpan / 2 ? snapped : target);
    }
  };
  fitView.current = fit;
  useLayoutEffect(() => {
    if (curveCreation) return;
    initialCursorFit.current = true; fitView.current?.(); initialCursorFit.current = false;
  }, [sketch.id, sketch.kind, curveCreation]);
  const pathPreview = useMemo(() => tool === 'path' ? previewCadPathDraft(pathDraft, cursor) : { kind: 'none' as const }, [tool, pathDraft, cursor]);
  const pathMode = pathDraft.kind === 'arc-through' ? 'arc' : pathDraft.mode;
  const pathEnd = pathDraft.kind === 'idle' ? null : cadPathDraftEndpoint(pathDraft);
  const pathNeedsClosingLine = pathDraft.kind === 'ready' && pathDraft.segments.length > 0 && pathEnd !== null
    && (pathEnd[0] !== pathDraft.start[0] || pathEnd[1] !== pathDraft.start[1]);
  const instruction = tool === 'path' ? pathDraft.kind === 'idle' ? sketch.kind === 'curve' ? 'Click the curve start.' : 'Click the path start.' : pathDraft.kind === 'arc-through' ? pathPreview.kind === 'invalid' ? pathPreview.message : 'Click a point on the arc.' : pathMode === 'arc' ? 'Click the arc endpoint.' : sketch.kind === 'curve' ? 'Click the next endpoint; Finish curve to save.' : 'Click the next endpoint; Close profile to finish.' : tool === 'select' ? sketch.kind === 'curve' ? 'Edit curve dimensions in Properties.' : 'Select a profile to edit dimensions' : tool === 'polygon' ? points.length ? 'Click vertices. Click the first point or Close profile to finish.' : 'Click the first vertex of a closed profile' : points.length ? tool === 'circle' ? 'Click to set the radius' : tool === 'slot' ? 'Click an axis endpoint. Edit the slot width in Properties.' : 'Click the opposite corner' : tool === 'circle' ? 'Click the circle center' : tool === 'slot' ? 'Click the slot center' : 'Click the first corner';
  let preview: CadProfile | null = null;
  const first = points[0];
  if (first && (tool === 'rectangle' || tool === 'circle' || tool === 'slot')) {
    try { preview = twoPointSketchProfile(tool, first, cursor); } catch { /* The preview starts at zero size. */ }
  }
  const placePoint = (point: SketchPoint) => {
    if (interactionLocked) return;
    if (tool === 'select') { onSelectProfile(null); return; }
    if (tool === 'path') { changePath({ kind: 'point', point }); return; }
    if (tool === 'polygon') {
      if (first && points.length >= 3 && Math.hypot(point[0] - first[0], point[1] - first[1]) < span * 0.018) { close(); return; }
      if (!points.some(([x, y]) => x === point[0] && y === point[1])) setPoints([...points, point]);
    } else if (first) {
      try { add(twoPointSketchProfile(tool, first, point)); }
      catch (error) { onError(error instanceof Error ? error.message : 'Unable to draw this profile.'); }
    } else setPoints([point]);
  };
  const dimensionProfile = dragPreview?.profile ?? (sketch.kind === 'sketch' ? sketch.profiles.find(profile => profile.id === selectedProfileId) : undefined);
  const dimensionBounds = useMemo(() => {
    if (!dimensionProfile) return null;
    try { return cadProfileReferenceGeometry(dimensionProfile.geometry, parameters).bounds; }
    catch { return null; }
  }, [dimensionProfile, parameters]);
  const dimensionAnchor = useMemo(() => {
    if (!dimensionBounds || !viewportSize.width || !viewportSize.height) return null;
    const x = ((dimensionBounds.minX + dimensionBounds.maxX) / 2 - center[0]) / width * viewportSize.width + viewportSize.width / 2;
    const y = (center[1] - dimensionBounds.minY) / span * viewportSize.height + viewportSize.height / 2 + 12;
    return { x: Math.max(125, Math.min(viewportSize.width - 125, x)), y: Math.max(60, Math.min(viewportSize.height - 220, y)) };
  }, [dimensionBounds, viewportSize, center, width, span]);
  return <div className={`cad-sketch-viewport ${sketch.kind === 'curve' ? 'cad-curve-viewport' : ''}`} ref={host}>
    <svg ref={svg} className={`cad-sketch-canvas ${tool !== 'select' ? 'is-drawing' : ''}`} role="application" tabIndex={interactionLocked ? -1 : 0} aria-label={sketch.kind === 'curve' ? 'Curve drawing canvas' : 'Sketch drawing canvas'} aria-describedby={instructionsId} viewBox={`${-width / 2} ${-span / 2} ${width} ${span}`} preserveAspectRatio="none"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (profileDrag.current) return;
        if (event.button === 0) suppressProfileClick.current = false;
        if (pan.current) { if (event.pointerId !== pan.current.pointerId) pan.current.moved = true; return; }
        if (event.isPrimary === false) return;
        if (event.button === 1 || event.button === 2) {
          if (viewLocked) return;
          event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
          pan.current = { x: event.clientX, y: event.clientY, center, pointerId: event.pointerId, button: event.button, buttonMask: event.button === 1 ? 4 : 2, moved: false, element: event.currentTarget };
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch { finishPan(); }
        } else if (event.button === 0 && !interactionLocked) {
          // SVG's native focus ring is measured in drawing units. Keep pointer
          // focus on the canvas rather than the profile's millimetre bounding box.
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          if (tool === 'select' && sketch.kind === 'sketch' && !viewLocked && !previewProfile && onTranslateProfile && selectedProfileId) {
            const point = getRawPoint(event), rect = event.currentTarget.getBoundingClientRect();
            const picked = point && rect.height ? profilePicker.pick(point, span / rect.height) : null;
            const profile = picked === selectedProfileId ? sketch.profiles.find(profile => profile.id === selectedProfileId && profile.geometry.kind !== 'plugin') : null;
            if (profile && rect.width && rect.height) {
              profileDrag.current = { profile, sketch, parameters, pointerId: event.pointerId, element: event.currentTarget,
                clientX: event.clientX, clientY: event.clientY, mmPerPixelX: width / rect.width, mmPerPixelY: span / rect.height,
                snap, gridStep, moved: false, translation: [0, 0] };
              try { event.currentTarget.setPointerCapture(event.pointerId); } catch { finishProfileDrag(); }
            }
          }
        }
      }}
      onPointerUp={(event) => {
        if (profileDrag.current) {
          if (event.pointerId !== profileDrag.current.pointerId) return;
          if (event.button === 0) moveProfile(event);
          const active = finishProfileDrag(event.pointerId);
          if (event.button === 0 && active?.moved && (active.translation[0] !== 0 || active.translation[1] !== 0)) {
            try { onTranslateProfile?.(active.profile.id, active.translation); }
            catch (error) { onError(error instanceof Error ? error.message : 'Unable to move this contour.'); }
          }
          return;
        }
        const active = pan.current;
        if (!active || active.pointerId !== event.pointerId) return;
        finishPan(event.pointerId);
        if (active.button !== 2 || event.button !== 2 || active.moved || Math.hypot(event.clientX - active.x, event.clientY - active.y) > 4 || interactionLocked || viewLocked || !onContextMenu) return;
        const point = getRawPoint(event), rect = event.currentTarget.getBoundingClientRect();
        if (point && rect.height) onContextMenu({ clientX: event.clientX, clientY: event.clientY, trigger: 'pointer', profileId: profilePicker.pick(point, span / rect.height), pointMm: point });
      }}
      onPointerCancel={(event) => { finishProfileDrag(event.pointerId); finishPan(event.pointerId); }}
      onLostPointerCapture={(event) => { finishProfileDrag(event.pointerId); finishPan(event.pointerId); }}
      onPointerMove={(event) => {
        if (profileDrag.current) {
          if (event.pointerId !== profileDrag.current.pointerId) return;
          if (!(event.buttons & 1)) { finishProfileDrag(event.pointerId); return; }
          moveProfile(event); return;
        }
        const active = pan.current;
        if (active) {
          if (event.pointerId !== active.pointerId) return;
          if (Math.hypot(event.clientX - active.x, event.clientY - active.y) > 4) active.moved = true;
          if (!(event.buttons & active.buttonMask)) { finishPan(event.pointerId); return; }
          const rect = event.currentTarget.getBoundingClientRect();
          if (!rect.width || !rect.height) { finishPan(event.pointerId); return; }
          setCenter([active.center[0] - (event.clientX - active.x) / rect.width * width, active.center[1] + (event.clientY - active.y) / rect.height * span]);
        } else setCursor(getPoint(event));
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && profileDrag.current) { event.preventDefault(); event.stopPropagation(); finishProfileDrag(); return; }
        if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) {
          event.preventDefault(); event.stopPropagation();
          if (interactionLocked || viewLocked || !onContextMenu) return;
          finishPan();
          const profileId = selectedProfileId && profilePicker.hasProfile(selectedProfileId) ? selectedProfileId : null;
          const rect = event.currentTarget.getBoundingClientRect();
          onContextMenu({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, trigger: 'keyboard', profileId, pointMm: center });
          return;
        }
        if (interactionLocked || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.target !== event.currentTarget) return;
        const step = gridStep * (event.shiftKey ? 10 : 1);
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          setCursor(([x, y]) => snapSketchPoint([x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), y + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0)], gridStep, snap));
        } else if ((event.key === 'Enter' || event.key === ' ') && tool !== 'select') {
          event.preventDefault();
          if (event.key === 'Enter' && tool === 'path' && pathDraft.kind === 'ready') closePath();
          else if (event.key === 'Enter' && tool === 'polygon' && points.length >= 3) close();
          else placePoint(cursor);
        } else if (tool === 'path' && pathPending && (event.key === 'Backspace' || event.key === 'Escape')) { event.preventDefault(); changePath({ kind: event.key === 'Backspace' ? 'undo-last' : 'cancel' }); }
        else if (event.key === 'Backspace' && points.length) { event.preventDefault(); setPoints((current) => current.slice(0, -1)); }
        else if (event.key === 'Escape' && points.length) { event.preventDefault(); setPoints([]); }
        else if (event.key.toLowerCase() === 'f' && !viewLocked) { event.preventDefault(); fit(); }
      }}
      onClick={(event) => {
        // Chromium's click PointerEvent reports isPrimary=false even for the
        // primary mouse; primary-pointer filtering belongs to pointerdown.
        if (event.button !== 0 || interactionLocked) return;
        if (event.detail > 0 && suppressProfileClick.current) { suppressProfileClick.current = false; event.preventDefault(); return; }
        if (tool === 'select') {
          const point = getRawPoint(event); const rect = svg.current?.getBoundingClientRect();
          if (point && rect?.height) onSelectProfile(profilePicker.pick(point, span / rect.height));
        } else placePoint(getPoint(event));
      }}>
      <defs><pattern id="cad-sketch-grid" x={-center[0] % gridStep} y={center[1] % gridStep} width={gridStep} height={gridStep} patternUnits="userSpaceOnUse"><path d={`M ${gridStep} 0 H 0 V ${gridStep}`} fill="none" stroke="#29373f" strokeWidth={span / 1000} /></pattern></defs>
      {grid && span / gridStep < 2000 && <rect x={-width / 2} y={-span / 2} width={width} height={span} fill="url(#cad-sketch-grid)" />}
      {Math.abs(center[1]) <= span / 2 && <path d={`M ${-width / 2} ${center[1]} H ${width / 2}`} className="cad-axis-x" strokeWidth={span / 700} />}
      {Math.abs(center[0]) <= width / 2 && <path d={`M ${-center[0]} ${-span / 2} V ${span / 2}`} className="cad-axis-y" strokeWidth={span / 700} />}
      <g transform="scale(1,-1)" strokeWidth={span / 450}>
        {savedCurve && <g className="cad-profile is-selected"><CadPathDraftGeometry segments={savedCurve.segments} preview={false} viewCenter={center} /></g>}
        {profiles.map((profile) => <g key={profile.id} role="button" aria-label={`Select ${profile.name} profile`} aria-pressed={profile.id === selectedProfileId} transform={dragPreview?.profile.id === profile.id ? `translate(${dragPreview.translation[0]} ${dragPreview.translation[1]})` : undefined} tabIndex={tool === 'select' && !interactionLocked ? 0 : -1} data-cad-parameter-highlight={inspection?.profileIds.includes(profile.id) ? profile.id : undefined} className={`cad-profile ${profile.construction ? 'is-construction' : ''} ${profile.id === selectedProfileId ? 'is-selected' : ''} ${inspection?.profileIds.includes(profile.id) ? 'is-parameter-highlighted' : ''}`} strokeDasharray={profile.construction ? `${span / 80} ${span / 120}` : undefined} onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && tool === 'select' && !interactionLocked) { event.preventDefault(); event.stopPropagation(); onSelectProfile(profile.id); } }} onClick={(event) => { if (event.detail === 0 && event.button === 0 && tool === 'select' && !interactionLocked) { event.stopPropagation(); onSelectProfile(profile.id); } }}><CadSketchProfileGeometry geometry={profile.geometry} parameters={parameters} viewCenter={center} /></g>)}
        {inspection?.gear && inspectedGear?.geometry.kind === 'plugin' && <CadGearInspectionOverlay profile={inspectedGear.geometry} parameters={parameters} inputName={inspection.gear.inputName} span={span} viewCenter={center} />}
        {preview && <g className="cad-profile cad-profile-preview"><CadSketchProfileGeometry geometry={preview} parameters={parameters} viewCenter={center} /></g>}
        {tool === 'polygon' && points.length > 0 && <polyline className="cad-profile cad-profile-preview" points={[...points, cursor].map(([x, y]) => `${x - center[0]},${y - center[1]}`).join(' ')} />}
        {tool === 'path' && pathDraft.kind !== 'idle' && <>
          <CadPathDraftGeometry segments={pathDraft.segments} viewCenter={center} />
          {(pathPreview.kind === 'line' || pathPreview.kind === 'arc') && <g className="cad-profile cad-profile-preview"><CadPathSegmentGeometry segment={pathPreview.segment} origin={center} /></g>}
          {pathDraft.kind === 'arc-through' && pathPreview.kind === 'invalid' && <polyline className="cad-path-invalid" points={[pathPreview.start, pathPreview.through, pathPreview.end].map(([x, y]) => `${x - center[0]},${y - center[1]}`).join(' ')} />}
          <circle cx={pathDraft.start[0] - center[0]} cy={pathDraft.start[1] - center[1]} r={span / 170} className="cad-sketch-vertex" />
          {pathDraft.kind === 'arc-through' && <circle cx={pathDraft.end[0] - center[0]} cy={pathDraft.end[1] - center[1]} r={span / 170} className="cad-sketch-vertex" />}
        </>}
        {points.map(([x, y], index) => <circle key={index} cx={x - center[0]} cy={y - center[1]} r={span / 170} className="cad-sketch-vertex" />)}
        {tool !== 'select' && <g className="cad-crosshair"><path d={`M ${cursor[0] - center[0] - span / 70} ${cursor[1] - center[1]} h ${span / 35} M ${cursor[0] - center[0]} ${cursor[1] - center[1] - span / 70} v ${span / 35}`} /></g>}
      </g>
    </svg>
    {dimensionControls && sketch.kind === 'sketch' && dimensionProfile && dimensionAnchor && tool === 'select' && !previewProfile && <CadSketchDimensionControls {...dimensionControls} interactionLocked={dimensionControls.interactionLocked || dragPreview !== null} sketch={sketch} profile={dimensionProfile} parameters={parameters} anchor={dimensionAnchor} project={point => ({ x: (point[0] - center[0]) / width * viewportSize.width + viewportSize.width / 2, y: (center[1] - point[1]) / span * viewportSize.height + viewportSize.height / 2 })} cancelSignal={cancelSignal} />}
    {previewProfile && <div className="cad-sketch-context" role="status">Preview · Apply to keep changes</div>}
    {!previewProfile && inspection && inspection.profileIds.length > 0 && <div className="cad-sketch-context" role="status">Highlighted geometry · {inspection.profileIds.length} {inspection.profileIds.length === 1 ? 'profile' : 'profiles'}</div>}
    <p id={instructionsId} className="cad-sr-only">{interactionLocked ? 'Drawing is paused while another edit or operation is active.' : instruction} Keyboard: arrow keys move the cursor, Shift moves ten grid steps, Space adds a point, Enter accepts an arc through-point or closes a ready path or polyline, Backspace undoes the last point or segment, Escape cancels drawing, F fits the sketch.</p>
    <CadViewTools label="Sketch controls"><span className="cad-plane-label">{placementLabel ?? (typeof sketch.plane === 'string' ? sketch.plane : 'Datum plane')}</span><Button aria-label={sketch.kind === 'curve' ? 'Fit curve' : 'Fit sketch'} disabled={viewLocked} onClick={fit}><Maximize2 size={14} /></Button><Button aria-label="Toggle sketch grid" disabled={viewLocked} aria-pressed={grid} onClick={() => setGrid(!grid)}><Grid2X2 size={14} /></Button><Button aria-label="Toggle grid snapping" disabled={viewLocked} aria-pressed={snap} onClick={() => setSnap(!snap)}><Magnet size={14} /></Button><label className="cad-grid-step">Grid <Input aria-label="Grid spacing" disabled={viewLocked} type="number" min="0.01" value={gridStep} onChange={(event) => { const value = Number(event.target.value); if (value > 0 && Number.isFinite(value)) setGridStep(value); }} /> mm</label><CadContextHelp label="Sketch navigation">{navigationMode === 'trackpad' ? 'Use two-finger scrolling to pan and pinch to zoom.' : 'Drag with the right mouse button to pan and use the wheel to zoom.'} Press F to fit the sketch and Escape to cancel unfinished drawing.</CadContextHelp></CadViewTools>
    {!interactionLocked && (tool !== 'select' || points.length > 0) && <div className={`cad-sketch-instruction ${tool === 'path' ? 'cad-path-instruction' : ''}`} onKeyDown={event => {
      if (tool !== 'path' || !pathPending || interactionLocked || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Backspace' || event.key === 'Escape') { event.preventDefault(); changePath({ kind: event.key === 'Backspace' ? 'undo-last' : 'cancel' }, true); }
    }}><span>{instruction}</span>
      {tool === 'path' && <>
        <div className="cad-path-modes" role="group" aria-label="Path segment mode"><Button disabled={interactionLocked || pathDraft.kind === 'arc-through'} aria-pressed={pathMode === 'line'} onClick={() => changePath({ kind: 'mode', mode: 'line' }, true)}>Line</Button><Button disabled={interactionLocked || pathDraft.kind === 'arc-through'} aria-pressed={pathMode === 'arc'} onClick={() => changePath({ kind: 'mode', mode: 'arc' }, true)}>3-point Arc</Button></div>
        {pathPending && <><Button aria-label={sketch.kind === 'curve' ? 'Finish curve' : 'Close profile'} title={sketch.kind === 'curve' ? 'Validate and save the open curve without a closing edge' : pathNeedsClosingLine ? 'Close the profile by adding a straight line to its start' : 'Validate and save the closed profile'} disabled={interactionLocked || pathDraft.kind !== 'ready' || !pathDraft.segments.length} onClick={closePath}><Check size={13} />{sketch.kind === 'curve' ? 'Finish curve' : pathNeedsClosingLine ? 'Close with line' : 'Close profile'}</Button><Button disabled={interactionLocked} onClick={() => changePath({ kind: 'undo-last' }, true)}><Undo2 size={13} /> Undo last</Button><Button disabled={interactionLocked} onClick={() => changePath({ kind: 'cancel' }, true)}><X size={13} /> Cancel drawing</Button></>}
      </>}
      {tool === 'polygon' && points.length >= 3 && <Button disabled={interactionLocked} onClick={close}><Check size={13} /> Close profile</Button>}{points.length > 0 && <Button onClick={() => setPoints([])}><X size={13} /> Cancel drawing</Button>}</div>}
    <div className="cad-view-caption">{cursor[0].toFixed(2)}, {cursor[1].toFixed(2)} mm</div>
  </div>;
}
