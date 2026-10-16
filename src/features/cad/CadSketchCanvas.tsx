import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CloseIcon, ConfirmIcon, FitViewIcon, GridIcon, SnapIcon, UndoIcon } from '@wire-edm/icons-react';
import { CadContextHelp } from './CadContextHelp';
import { CadDrawingTools, CadViewTools } from './CadCommandDock';
import type { CadCurveFeature, CadPathSegment, CadProfile, CadSketchFeature, CadSketchProfile } from '@/domain/cad/cadDocument';
import { resolveCadCurveGeometry } from '@/domain/cad/cadCurve';
import { captureSvgPreview } from '@/features/editor/captureEditorPreview';
import { ToolError } from '@/features/webmcp/siteTools';
import type { CadRenderedViewControls, CadRenderedViewState } from './cadViewportControls';
import { closeSketchPolygon, snapSketchPathPoint, snapSketchPoint, twoPointSketchProfile, type SketchPoint, type SketchTool } from './cadSketchInteraction';
import { CadSketchProfileGeometry } from './CadSketchProfileGeometry';
import { createCadSketchHandlePicker, createCadSketchProfilePicker, type CadSketchHandlePick } from './cadSketchPicking';
import { cadPathDraftEndpoint, closeCadPathDraft, createCadPathDraft, finishCadCurveDraft, previewCadPathDraft, updateCadPathDraft, type CadPathDraft, type CadPathDrawingAction } from './cadPathDrawing';
import { snapCadPathGraphPoint } from './cadPathPointSnap';
import { CadPathDraftGeometry, CadPathSegmentGeometry } from './CadPathDraftGeometry';
import { cadProfileReferenceGeometry } from './cadViewportReferences';
import { CadGearInspectionOverlay } from './CadGearInspectionOverlay';
import { CadSketchDimensionControls, type CadSketchDimensionControlsProps } from './CadSketchDimensionControls';
import { readCadFitArea, type CadFitAreaReader } from './cadFitArea';
import { translateCadSketchProfile } from '@/domain/cad/cadSketchConstraints';
import { cadSketchHandleKey, moveCadSketchHandle, type CadSketchHandle } from '@/domain/cad/cadSketchHandles';
import { formatCadQuantity } from './cadDisplayQuantity';
import { prepareCadSketchGraphInteraction } from './cadSketchGraphInteraction';
import { CadSketchGraphLayer, type CadSketchGraphControls } from './CadSketchGraphLayer';
import { cadSketchGraphBoundary } from '@/domain/cad/compileCadSketchGeometry';
import { cadArcSvgPath } from './cadSketchSvg';
import { useCadEditSubmission, type CadEditCompletion } from './useCadEditSubmission';
import { useCadSketchBoxSelection } from './useCadSketchBoxSelection';
import type { CadSketchGraphPickFilter } from './cadSketchGraphSelection';
import { CadContextMenu, type CadContextMenuItem } from './CadContextMenu';
import type { CadSketchGraphSelection } from './cadSketchGraphSelection';

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
  readonly handle: CadSketchHandle | null;
  readonly anchor: SketchPoint | null;
  moved: boolean;
  translation: SketchPoint;
}
type CadSketchDetailSelection = { readonly kind: 'none' | 'profile' } | { readonly kind: 'handle'; readonly target: CadSketchHandlePick };
interface CadSketchOverlapPick {
  readonly prepared: ReturnType<typeof prepareCadSketchGraphInteraction>;
  readonly version?: string; readonly cancelSignal: number; readonly filter: CadSketchGraphPickFilter; readonly frameKey: string; readonly frame: string;
  readonly clientX: number; readonly clientY: number; readonly toggle: boolean; readonly candidates: readonly CadSketchGraphSelection[];
}

export function CadSketchCanvas({ sketch: sourceSketch, parameters, documentVersion, placementLabel, tool, selectedProfileId, onSelectProfile, onAddProfile, onAddPath, onTranslateProfile, onMoveHandle, onAddCurve, onCancelCurve, curveCreation = false, onPendingChange, onError, cancelSignal, interactionLocked: externalInteractionLocked = false, onControlsReady, viewLocked = false, navigationMode = 'mouse', onContextMenu, previewProfile, previewSketch, graphControls, inspection, dimensionControls, getFitArea }: {
  sketch: CadSketchFeature | CadCurveFeature;
  parameters: Readonly<Record<string, number>>;
  documentVersion?: string;
  placementLabel?: string;
  tool: SketchTool;
  selectedProfileId: string | null;
  onSelectProfile(id: string | null): void;
  onAddProfile(geometry: CadProfile, signal?: AbortSignal): CadEditCompletion;
  onAddPath?(draft: CadPathDraft, closed: boolean, signal?: AbortSignal): CadEditCompletion;
  onTranslateProfile?(profileId: string, translation: SketchPoint, signal?: AbortSignal): CadEditCompletion;
  onMoveHandle?(profileId: string, handle: CadSketchHandle, translation: SketchPoint, signal?: AbortSignal): CadEditCompletion;
  onAddCurve?(segments: readonly CadPathSegment[], signal?: AbortSignal): CadEditCompletion;
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
  previewSketch?: CadSketchFeature | null;
  graphControls?: CadSketchGraphControls;
  inspection?: { profileIds: readonly string[]; gear?: { profileId: string; inputName: string } };
  dimensionControls?: Pick<CadSketchDimensionControlsProps, 'document' | 'onEditMany' | 'onPendingChange' | 'interactionLocked' | 'onInspectInput' | 'onConfigure'>;
  getFitArea?: CadFitAreaReader;
}) {
  const sketch = previewSketch && sourceSketch.kind === 'sketch' && previewSketch.id === sourceSketch.id ? previewSketch : sourceSketch;
  const isPreview = Boolean(previewProfile || sketch !== sourceSketch);
  const submission = useCadEditSubmission();
  const [graphPending, setGraphPending] = useState(false);
  const [boxPending, setBoxPending] = useState(false);
  const [pickFilter, setPickFilter] = useState<CadSketchGraphPickFilter>('auto');
  const [overlap, setOverlap] = useState<CadSketchOverlapPick | null>(null);
  const [pickHighlight, setPickHighlight] = useState<CadSketchGraphSelection | null>(null);
  const baseInteractionLocked = externalInteractionLocked || submission.applying || graphPending;
  const overlapPending = overlap !== null;
  const interactionLocked = baseInteractionLocked || overlapPending;
  const svg = useRef<SVGSVGElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const instructionsId = useId();
  const [points, setPoints] = useState<readonly SketchPoint[]>([]);
  const [pathDraft, setPathDraft] = useState(createCadPathDraft);
  const [cursor, setCursor] = useState<SketchPoint>([0, 0]);
  const [cursorPointId, setCursorPointId] = useState<string | null>(null);
  const [center, setCenter] = useState<SketchPoint>([0, 0]);
  const [span, setSpan] = useState(160);
  const [aspect, setAspect] = useState(1.3);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const measuredAspect = useRef(aspect);
  const [snap, setSnap] = useState(true);
  const [grid, setGrid] = useState(true);
  const [gridStep, setGridStep] = useState(5);
  const profileDrag = useRef<CadSketchProfileDrag | null>(null);
  const [dragPreview, setDragPreview] = useState<{ profile: CadSketchProfile; translation: SketchPoint; handle: CadSketchHandle | null } | null>(null);
  const [detailSelection, setDetailSelection] = useState<CadSketchDetailSelection>({ kind: 'profile' });
  const activeHandle = detailSelection.kind === 'handle' ? detailSelection.target : null;
  const setActiveHandle = (target: CadSketchHandlePick | null) => setDetailSelection(target ? { kind: 'handle', target } : { kind: 'profile' });
  const ownedHandleEdit = useRef<{ readonly profileId: string; readonly handle: CadSketchHandle; readonly expectedText: string } | null>(null);
  const selectionRevision = useRef({ version: documentVersion, sketch });
  const [hoverHandle, setHoverHandle] = useState<CadSketchHandlePick | null>(null);
  const suppressProfileClick = useRef(false);
  const pendingChange = useRef(onPendingChange);
  pendingChange.current = onPendingChange;
  const finishProfileDrag = useCallback((pointerId?: number, retainPreview = false) => {
    const active = profileDrag.current;
    if (!active || pointerId !== undefined && pointerId !== active.pointerId) return null;
    profileDrag.current = null;
    if (!retainPreview) {
      setDragPreview(null);
      if (active.moved) pendingChange.current(false);
    }
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
  const graphSourceParameters = graphControls?.document.parameters ?? parameters;
  const sourceGraph = useMemo(() => sourceSketch.kind === 'sketch' && sourceSketch.graph ? prepareCadSketchGraphInteraction(sourceSketch.graph, graphSourceParameters) : null, [sourceSketch, graphSourceParameters]);
  const visualGraph = useMemo(() => sketch === sourceSketch && parameters === graphSourceParameters ? sourceGraph
    : sketch.kind === 'sketch' && sketch.graph ? prepareCadSketchGraphInteraction(sketch.graph, parameters) : null, [sketch, sourceSketch, parameters, graphSourceParameters, sourceGraph]);
  const graphGeometry = useMemo(() => visualGraph && sketch.kind === 'sketch' ? { ...visualGraph.geometry, constructionIds: new Set(sketch.graph?.entities.filter(entity => entity.construction).map(entity => entity.id)) } : null, [visualGraph, sketch]);
  const inspectedGear = inspection?.gear ? profiles.find(profile => profile.id === inspection.gear?.profileId) : null;
  const savedCurve = useMemo(() => {
    if (sketch.kind !== 'curve' || !sketch.segments.length) return null;
    try { return resolveCadCurveGeometry(sketch, parameters); } catch { return null; }
  }, [sketch, parameters]);
  const profilePicker = useMemo(() => createCadSketchProfilePicker(profiles, parameters), [profiles, parameters]);
  const handlePicker = useMemo(() => createCadSketchHandlePicker(profiles, parameters), [profiles, parameters]);
  const handleProfile = dragPreview?.profile ?? profiles.find(profile => profile.id === selectedProfileId);
  const previewHandlePicker = useMemo(() => dragPreview ? createCadSketchHandlePicker([dragPreview.profile], parameters) : handlePicker, [dragPreview, parameters, handlePicker]);
  const visibleHandles = previewHandlePicker.handles.filter(handle => handle.profileId === handleProfile?.id);
  const displayHandles = hoverHandle && hoverHandle.profileId !== handleProfile?.id ? [...visibleHandles, hoverHandle] : visibleHandles;
  useLayoutEffect(() => { finishPan(); }, [documentVersion, interactionLocked, cancelSignal, sketch.id, profilePicker, finishPan]);
  useLayoutEffect(() => { finishProfileDrag(); }, [documentVersion, sketch, parameters, tool, interactionLocked, cancelSignal, previewProfile, center, span, aspect, snap, gridStep, navigationMode, finishProfileDrag]);
  useLayoutEffect(() => {
    if (profileDrag.current && profileDrag.current.profile.id !== selectedProfileId) finishProfileDrag();
    setDetailSelection(current => current.kind === 'handle' && current.target.profileId === selectedProfileId ? current : { kind: 'profile' });
  }, [selectedProfileId, finishProfileDrag]);
  useLayoutEffect(() => {
    const previous = selectionRevision.current;
    if (previous.version === documentVersion && previous.sketch === sketch) return;
    selectionRevision.current = { version: documentVersion, sketch };
    const owned = ownedHandleEdit.current;
    ownedHandleEdit.current = null; setHoverHandle(null);
    const profile = owned && profiles.find(profile => profile.id === owned.profileId);
    const next = owned && profile && JSON.stringify(profile) === owned.expectedText
      ? handlePicker.handles.find(grip => grip.profileId === owned.profileId && cadSketchHandleKey(grip.handle) === cadSketchHandleKey(owned.handle)) : null;
    setDetailSelection(next ? { kind: 'handle', target: next } : { kind: 'none' });
  }, [documentVersion, sketch, profiles, handlePicker]);
  useEffect(() => { submission.cancel(); setHoverHandle(null); setDetailSelection({ kind: 'profile' }); ownedHandleEdit.current = null; setDragPreview(null); }, [sketch.id, tool, cancelSignal, submission.cancel]);
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
  const viewSignature = JSON.stringify([sketch.plane, center, span, aspect, grid, snap, gridStep, pickFilter, boxPending, pickHighlight, previewProfile?.geometry, previewSketch ? [previewSketch.profiles, previewSketch.graph] : null, graphControls ? [graphControls.selection, graphControls.relation, graphControls.inspection, graphControls.degreesOfFreedom, graphControls.showDimensions] : null, inspection, dragPreview?.translation]);
  if (viewRevision.current.signature !== viewSignature) { viewRevision.current = { signature: viewSignature, revision: viewRevision.current.revision + 1 }; }
  const currentView = useRef<CadRenderedViewState>({ mode: sketch.kind, available: false, plane: renderedPlane, gridVisible: grid, snapEnabled: snap, gridStepMm: gridStep, centerMm: center, heightSpanMm: span, revision: viewRevision.current.revision });
  currentView.current = Object.freeze({ mode: sketch.kind, available: Boolean(svg.current), plane: renderedPlane, gridVisible: grid, snapEnabled: snap, gridStepMm: gridStep, centerMm: Object.freeze([...center] satisfies [number, number]), heightSpanMm: span, revision: viewRevision.current.revision, ...(sketch.kind === 'sketch' ? { sketchPickFilter: pickFilter } : {}) });
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
      ...(sketch.kind === 'sketch' ? { setSketchPickFilter: setPickFilter } : {}),
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
  useEffect(() => { setCursorPointId(null); }, [sourceSketch, graphSourceParameters, tool, cancelSignal, snap]);
  const pathPending = tool === 'path' && pathDraft.kind !== 'idle';
  useLayoutEffect(() => { onPendingChange(points.length > 0 || pathPending || dragPreview !== null || submission.applying || graphPending || boxPending || overlapPending); }, [points.length, pathPending, dragPreview !== null, submission.applying, graphPending, boxPending, overlapPending, onPendingChange]);
  const publishGraphPending = useCallback((value: boolean) => {
    setGraphPending(value); pendingChange.current(value || points.length > 0 || pathPending || dragPreview !== null || submission.applying || boxPending || overlapPending);
  }, [points.length, pathPending, dragPreview !== null, submission.applying, boxPending, overlapPending]);
  const publishBoxPending = useCallback((value: boolean) => {
    setBoxPending(value); pendingChange.current(value || points.length > 0 || pathPending || dragPreview !== null || submission.applying || graphPending || overlapPending);
  }, [points.length, pathPending, dragPreview !== null, submission.applying, graphPending, overlapPending]);
  const getRawPoint = (event: { clientX: number; clientY: number }): SketchPoint | null => {
    const rect = svg.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return [center[0] + (event.clientX - rect.left - rect.width / 2) / rect.width * width, center[1] - (event.clientY - rect.top - rect.height / 2) / rect.height * span];
  };
  const spatialFrameKey = JSON.stringify([renderedPlane, center, span, aspect, viewportSize]);
  const projectSelection = (event: { clientX: number; clientY: number }) => {
    const point = getRawPoint(event), rect = svg.current?.getBoundingClientRect();
    return point && rect ? { point, frame: JSON.stringify([renderedPlane, center, span, rect.left, rect.top, rect.width, rect.height]) } : null;
  };
  const boxSelection = useCadSketchBoxSelection({ prepared: sourceGraph, enabled: tool === 'select' && !isPreview && sketch.kind === 'sketch', locked: interactionLocked,
    version: documentVersion, cancelSignal, frameKey: spatialFrameKey, filter: pickFilter,
    selection: graphControls?.selection ?? [], onSelectSet: graphControls?.onSelectSet, onPendingChange: publishBoxPending, onError,
    onCancel: () => { suppressProfileClick.current = true; },
    project: projectSelection });
  const currentOverlap = overlap && overlap.prepared === sourceGraph && overlap.version === documentVersion && overlap.cancelSignal === cancelSignal
    && overlap.filter === pickFilter && overlap.frameKey === spatialFrameKey && tool === 'select' && !isPreview && !baseInteractionLocked ? overlap : null;
  const closeOverlap = useCallback(() => { setOverlap(null); setPickHighlight(null); }, []);
  useLayoutEffect(() => { if (overlap && !currentOverlap) closeOverlap(); }, [overlap, currentOverlap, closeOverlap]);
  const openOverlap = (event: { clientX: number; clientY: number; shiftKey?: boolean }) => {
    const projection = projectSelection(event), rect = svg.current?.getBoundingClientRect();
    if (!sourceGraph || !graphControls || !projection || !rect?.height || tool !== 'select' || isPreview || interactionLocked) return false;
    const candidates = sourceGraph.pick(projection.point, span / rect.height, pickFilter);
    if (!candidates.length) return false;
    setOverlap({ prepared: sourceGraph, version: documentVersion, cancelSignal, filter: pickFilter, frameKey: spatialFrameKey, frame: projection.frame,
      clientX: event.clientX, clientY: event.clientY, toggle: Boolean(event.shiftKey), candidates });
    return true;
  };
  const overlapItems: readonly CadContextMenuItem[] = currentOverlap?.candidates.map(atom => {
    const point = atom.kind === 'point' ? sourceGraph?.points.find(point => point.id === atom.id) : null;
    const index = atom.kind === 'point' ? sourceGraph?.graph.points.findIndex(point => point.id === atom.id) : sourceGraph?.graph.entities.findIndex(entity => entity.id === atom.id);
    const entity = atom.kind === 'entity' ? sourceGraph?.graph.entities.find(entity => entity.id === atom.id) : null;
    const label = point ? `Point ${(index ?? -1) + 1} · ${point.position.map(value => formatCadQuantity(value)).join(', ')} mm`
      : `${entity?.kind === 'line' ? 'Line' : entity?.kind === 'circle' ? 'Circle' : 'Arc'} ${(index ?? -1) + 1}`;
    return { label, onHighlight: () => setPickHighlight(atom), onSelect: () => {
      if (projectSelection(currentOverlap)?.frame !== currentOverlap.frame || baseInteractionLocked) return;
      try { graphControls?.onSelect(atom, currentOverlap.toggle); }
      catch (cause) { onError(cause instanceof Error ? cause.message : 'Unable to select this geometry.'); return; }
      svg.current?.querySelector<SVGGElement>(`[data-cad-sketch-${atom.kind === 'point' ? 'point' : 'entity'}="${atom.id}"]`)?.focus({ preventScroll: true });
    } };
  }) ?? [];
  const snapPoint = (point: SketchPoint): SketchPoint => tool === 'path'
    ? snapSketchPathPoint(point, pathDraft.kind === 'idle' ? null : pathDraft.start, span / (svg.current?.getBoundingClientRect().height || Infinity), gridStep, snap)
    : snapSketchPoint(point, gridStep, snap);
  const getDrawingPick = (event: { clientX: number; clientY: number }): { point: SketchPoint; existingPointId?: string } => {
    const raw = getRawPoint(event) ?? [0, 0], snapped = snapPoint(raw);
    if (tool !== 'path' || sourceSketch.kind !== 'sketch' || !onAddPath || pathDraft.kind === 'arc-through') return { point: snapped };
    if (pathDraft.kind !== 'idle' && snapped === pathDraft.start)
      return { point: snapped, ...(pathDraft.startPointId === undefined ? {} : { existingPointId: pathDraft.startPointId }) };
    return snap && sourceGraph ? snapCadPathGraphPoint(sourceGraph.points, raw, span / (svg.current?.getBoundingClientRect().height || Infinity)) ?? { point: snapped } : { point: snapped };
  };
  const pickGrip = (event: { target: EventTarget | null }, point: SketchPoint, millimetersPerPixel: number) => {
    const key = event.target instanceof Element ? event.target.closest('[data-cad-sketch-grip]')?.getAttribute('data-cad-sketch-grip') : null;
    const owned = key ? handlePicker.handles.find(grip => `${grip.profileId}/${cadSketchHandleKey(grip.handle)}` === key) : null;
    return owned ?? handlePicker.pick(point, millimetersPerPixel, selectedProfileId);
  };
  const submitEdit = (apply: (signal: AbortSignal) => CadEditCompletion, accepted: () => void, fallback: string) => {
    pendingChange.current(true);
    submission.submit(apply, accepted, error => {
      ownedHandleEdit.current = null; setDragPreview(null);
      pendingChange.current(points.length > 0 || pathPending);
      onError(error instanceof Error ? error.message : fallback);
    });
  };
  const commitHandle = (profileId: string, handle: CadSketchHandle, translation: SketchPoint, signal?: AbortSignal) => {
    const profile = profiles.find(profile => profile.id === profileId);
    if (!profile || !onMoveHandle) return;
    const expected = moveCadSketchHandle({ profile, handle, translation, parameters });
    if (JSON.stringify(profile) === JSON.stringify(expected)) return;
    ownedHandleEdit.current = { profileId, handle, expectedText: JSON.stringify(expected) };
    try { return onMoveHandle(profileId, handle, translation, signal); }
    catch (error) { ownedHandleEdit.current = null; throw error; }
  };
  const moveProfile = (event: { pointerId: number; clientX: number; clientY: number }) => {
    const active = profileDrag.current;
    if (!active || event.pointerId !== active.pointerId) return;
    if (!active.moved && Math.hypot(event.clientX - active.clientX, event.clientY - active.clientY) <= 4) return;
    active.moved = true; suppressProfileClick.current = true;
    const anchor = active.anchor ?? [0, 0];
    const snapped = snapSketchPoint([anchor[0] + (event.clientX - active.clientX) * active.mmPerPixelX, anchor[1] - (event.clientY - active.clientY) * active.mmPerPixelY], active.gridStep, active.snap);
    const translation: SketchPoint = [snapped[0] - anchor[0], snapped[1] - anchor[1]];
    try {
      const profile = active.handle ? moveCadSketchHandle({ profile: active.profile, handle: active.handle, translation, parameters: active.parameters })
        : translateCadSketchProfile({ profile: active.profile, translation, parameters: active.parameters });
      active.translation = translation;
      setDragPreview(current => current && current.translation[0] === translation[0] && current.translation[1] === translation[1] ? current : { profile, translation, handle: active.handle });
    } catch (error) { finishProfileDrag(); onError(error instanceof Error ? error.message : 'Unable to move this contour.'); }
  };
  const changePath = (action: CadPathDrawingAction, focus = false) => {
    if (interactionLocked && action.kind !== 'cancel') return;
    if (action.kind === 'cancel') submission.cancel();
    try { setPathDraft(updateCadPathDraft(pathDraft, action)); setCursorPointId(null); }
    catch (error) { onError(error instanceof Error ? error.message : 'Unable to draw this path.'); }
    if (action.kind === 'cancel' && curveCreation) onCancelCurve?.();
    if (focus) svg.current?.focus();
  };
  const cancelDrawing = () => {
    submission.cancel(); ownedHandleEdit.current = null;
    setDragPreview(null); setPoints([]); setPathDraft(createCadPathDraft());
    if (curveCreation) onCancelCurve?.();
  };
  const finishPath = (closed: boolean) => {
    if (interactionLocked) return;
    try {
      if (sketch.kind === 'curve') {
        if (!onAddCurve || !curveCreation) throw new Error('Edit the existing curve dimensions in Properties.');
        const segments = finishCadCurveDraft(pathDraft);
        submitEdit(signal => onAddCurve(segments, signal), () => setPathDraft(createCadPathDraft()), 'Unable to finish this curve.');
      } else if (onAddPath) {
        submitEdit(signal => onAddPath(pathDraft, closed, signal), () => setPathDraft(createCadPathDraft()), 'Unable to finish this path.');
      } else {
        const profile = closeCadPathDraft(pathDraft);
        submitEdit(signal => onAddProfile(profile, signal), () => setPathDraft(createCadPathDraft()), 'Unable to close this path.');
      }
    }
    catch (error) { onError(error instanceof Error ? error.message : 'Unable to close this path.'); }
    svg.current?.focus();
  };
  const add = (geometry: CadProfile) => {
    try { submitEdit(signal => onAddProfile(geometry, signal), () => setPoints([]), 'Unable to add this profile.'); }
    catch (error) { onError(error instanceof Error ? error.message : 'Unable to add this profile.'); }
  };
  const close = () => {
    try { add(closeSketchPolygon(points)); }
    catch (error) { onError(error instanceof Error ? error.message : 'Unable to close this profile.'); }
  };
  const fit = () => {
    const coordinates: SketchPoint[] = [];
    if (savedCurve) coordinates.push([savedCurve.bounds.minX, savedCurve.bounds.minY], [savedCurve.bounds.maxX, savedCurve.bounds.maxY]);
    for (const segment of graphGeometry?.segments ?? []) coordinates.push([segment.bounds.minX, segment.bounds.minY], [segment.bounds.maxX, segment.bounds.maxY]);
    for (const point of visualGraph?.points ?? []) coordinates.push(point.position);
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
  const instruction = tool === 'path' ? pathDraft.kind === 'idle' ? sketch.kind === 'curve' ? 'Click the curve start.' : 'Click the path start.' : pathDraft.kind === 'arc-through' ? pathPreview.kind === 'invalid' ? pathPreview.message : 'Click a point on the arc.' : pathMode === 'arc' ? 'Click the arc endpoint.' : sketch.kind === 'curve' ? 'Click the next endpoint; Finish curve to save.' : onAddPath ? 'Click the next endpoint; finish open or close the path.' : 'Click the next endpoint; Close profile to finish.' : tool === 'select' ? sketch.kind === 'curve' ? 'Edit curve dimensions in Properties.' : 'Select a profile to edit dimensions' : tool === 'polygon' ? points.length ? 'Click vertices. Click the first point or Close profile to finish.' : 'Click the first vertex of a closed profile' : points.length ? tool === 'circle' ? 'Click to set the radius' : tool === 'slot' ? 'Click an axis endpoint. Edit the slot width in Properties.' : 'Click the opposite corner' : tool === 'circle' ? 'Click the circle center' : tool === 'slot' ? 'Click the slot center' : 'Click the first corner';
  let preview: CadProfile | null = null;
  const first = points[0];
  if (first && (tool === 'rectangle' || tool === 'circle' || tool === 'slot')) {
    try { preview = twoPointSketchProfile(tool, first, cursor); } catch { /* The preview starts at zero size. */ }
  }
  const placePoint = (point: SketchPoint, existingPointId?: string) => {
    if (interactionLocked) return;
    if (tool === 'select') { onSelectProfile(null); return; }
    if (tool === 'path') { changePath({ kind: 'point', point, ...(existingPointId === undefined ? {} : { existingPointId }) }); return; }
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
        if (boxSelection.active()) { boxSelection.begin(event); return; }
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
          if (tool === 'select' && sketch.kind === 'sketch' && !viewLocked && !isPreview) {
            const point = getRawPoint(event), rect = event.currentTarget.getBoundingClientRect();
            const graphHit = point && rect.height ? sourceGraph?.pick(point, span / rect.height, pickFilter)[0] : null;
            if (graphHit) { graphControls?.onSelect(graphHit, event.shiftKey); suppressProfileClick.current = true; return; }
            const grip = pickFilter === 'auto' && onMoveHandle && point && rect.height ? pickGrip(event, point, span / rect.height) : null;
            if (grip) {
              setActiveHandle(grip);
              if (selectedProfileId !== grip.profileId) onSelectProfile(grip.profileId);
              if (!grip.draggable) return;
            } else setActiveHandle(null);
            const picked = pickFilter === 'auto' && point && rect.height ? profilePicker.pick(point, span / rect.height) : null;
            if (!grip && !picked && boxSelection.begin(event)) return;
            const id = grip?.profileId ?? (onTranslateProfile && picked === selectedProfileId ? selectedProfileId : null);
            const profile = id ? sketch.profiles.find(profile => profile.id === id && profile.geometry.kind !== 'plugin') : null;
            if (profile && rect.width && rect.height) {
              profileDrag.current = { profile, sketch, parameters, pointerId: event.pointerId, element: event.currentTarget,
                clientX: event.clientX, clientY: event.clientY, mmPerPixelX: width / rect.width, mmPerPixelY: span / rect.height,
                snap, gridStep, handle: grip?.handle ?? null, anchor: grip?.point ?? null, moved: false, translation: [0, 0] };
              try { event.currentTarget.setPointerCapture(event.pointerId); } catch { finishProfileDrag(); }
            }
          }
        }
      }}
      onPointerUp={(event) => {
        if (boxSelection.active()) { if (boxSelection.end(event)) suppressProfileClick.current = true; return; }
        if (profileDrag.current) {
          if (event.pointerId !== profileDrag.current.pointerId) return;
          if (event.button === 0) moveProfile(event);
          const retain = event.button === 0 && profileDrag.current.moved && profileDrag.current.translation.some(value => value !== 0);
          const active = finishProfileDrag(event.pointerId, retain);
          if (event.button === 0 && active?.moved && (active.translation[0] !== 0 || active.translation[1] !== 0)) {
            submitEdit(signal => active.handle ? commitHandle(active.profile.id, active.handle, active.translation, signal)
              : onTranslateProfile?.(active.profile.id, active.translation, signal), () => setDragPreview(null), 'Unable to move this contour.');
          }
          return;
        }
        const active = pan.current;
        if (!active || active.pointerId !== event.pointerId) return;
        finishPan(event.pointerId);
        if (active.button !== 2 || event.button !== 2 || active.moved || Math.hypot(event.clientX - active.x, event.clientY - active.y) > 4 || interactionLocked || viewLocked) return;
        if (openOverlap(event)) return;
        const point = getRawPoint(event), rect = event.currentTarget.getBoundingClientRect();
        if (pickFilter === 'auto' && point && rect.height) onContextMenu?.({ clientX: event.clientX, clientY: event.clientY, trigger: 'pointer', profileId: profilePicker.pick(point, span / rect.height), pointMm: point });
      }}
      onPointerCancel={(event) => { boxSelection.cancelPointer(event); finishProfileDrag(event.pointerId); finishPan(event.pointerId); }}
      onLostPointerCapture={(event) => { boxSelection.cancelPointer(event); finishProfileDrag(event.pointerId); finishPan(event.pointerId); }}
      onPointerMove={(event) => {
        if (boxSelection.active()) { boxSelection.move(event); return; }
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
        } else {
          const pick = getDrawingPick(event); setCursor(pick.point); setCursorPointId(pick.existingPointId ?? null);
          if (tool === 'select' && onMoveHandle && !interactionLocked && !viewLocked) {
            const point = getRawPoint(event), rect = event.currentTarget.getBoundingClientRect();
            const graphHit = event.target instanceof Element && event.target.closest('[data-cad-sketch-point], [data-cad-sketch-entity]');
            setHoverHandle(!graphHit && point && rect.height ? pickGrip(event, point, span / rect.height) : null);
          }
        }
      }}
      onPointerLeave={() => { setHoverHandle(null); setCursorPointId(null); }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape' && boxSelection.active()) { event.preventDefault(); event.stopPropagation(); suppressProfileClick.current = true; boxSelection.cancel(); return; }
        if (event.key === 'Escape' && submission.applying) {
          event.preventDefault(); event.stopPropagation(); cancelDrawing(); return;
        }
        if (event.key === 'Escape' && profileDrag.current) { event.preventDefault(); event.stopPropagation(); finishProfileDrag(); return; }
        if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) {
          event.preventDefault(); event.stopPropagation();
          if (interactionLocked || viewLocked) return;
          finishPan();
          const element = event.target instanceof Element ? event.target.closest('[data-cad-sketch-point], [data-cad-sketch-entity]') : null;
          const pointId = element?.getAttribute('data-cad-sketch-point'), entityId = element?.getAttribute('data-cad-sketch-entity');
          const point = pointId ? sourceGraph?.points.find(point => point.id === pointId)?.position : null;
          const segment = entityId ? sourceGraph?.geometry.segments.find(segment => segment.id === entityId) : null;
          const at = point ?? (segment ? [segment.start.x, segment.start.y] : center);
          const bounds = event.currentTarget.getBoundingClientRect();
          if (openOverlap({ clientX: bounds.left + bounds.width / 2 + (at[0] - center[0]) / width * bounds.width,
            clientY: bounds.top + bounds.height / 2 - (at[1] - center[1]) / span * bounds.height })) return;
          const profileId = selectedProfileId && profilePicker.hasProfile(selectedProfileId) ? selectedProfileId : null;
          const rect = event.currentTarget.getBoundingClientRect();
          if (pickFilter === 'auto') onContextMenu?.({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, trigger: 'keyboard', profileId, pointMm: center });
          return;
        }
        if (interactionLocked || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.target !== event.currentTarget) return;
        if (event.key === 'Delete' && tool === 'select' && graphControls?.selection.length && graphControls.onDelete) {
          event.preventDefault(); event.stopPropagation(); graphControls.onDelete(graphControls.selection[graphControls.selection.length - 1]); return;
        }
        const step = gridStep * (event.shiftKey ? 10 : 1);
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault(); setCursorPointId(null);
          setCursor(([x, y]) => snapSketchPoint([x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), y + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0)], gridStep, snap));
        } else if ((event.key === 'Enter' || event.key === ' ') && tool !== 'select') {
          event.preventDefault();
          if (event.key === 'Enter' && tool === 'path' && pathDraft.kind === 'ready') finishPath(true);
          else if (event.key === 'Enter' && tool === 'polygon' && points.length >= 3) close();
          else placePoint(cursor, cursorPointId ?? undefined);
        } else if (tool === 'path' && pathPending && (event.key === 'Backspace' || event.key === 'Escape')) { event.preventDefault(); changePath({ kind: event.key === 'Backspace' ? 'undo-last' : 'cancel' }); }
        else if (event.key === 'Backspace' && points.length) { event.preventDefault(); setPoints((current) => current.slice(0, -1)); }
        else if (event.key === 'Escape' && points.length) { event.preventDefault(); setPoints([]); }
        else if (event.key === 'Escape' && tool === 'select' && graphControls?.selection.length) { event.preventDefault(); event.stopPropagation(); graphControls.onSelect(null); }
        else if (event.key.toLowerCase() === 'f' && !viewLocked) { event.preventDefault(); fit(); }
      }}
      onClick={(event) => {
        // Chromium's click PointerEvent reports isPrimary=false even for the
        // primary mouse; primary-pointer filtering belongs to pointerdown.
        if (event.button !== 0 || interactionLocked) return;
        if (event.detail > 0 && suppressProfileClick.current) { suppressProfileClick.current = false; event.preventDefault(); return; }
        if (tool === 'select') {
          if (event.shiftKey && graphControls) return;
          graphControls?.onSelect(null);
          const point = getRawPoint(event); const rect = svg.current?.getBoundingClientRect();
          if (point && rect?.height) {
            if (pickFilter !== 'auto') { setActiveHandle(null); onSelectProfile(null); return; }
            const grip = onMoveHandle ? pickGrip(event, point, span / rect.height) : null;
            setActiveHandle(grip);
            onSelectProfile(grip?.profileId ?? profilePicker.pick(point, span / rect.height));
          }
        } else { const pick = getDrawingPick(event); setCursor(pick.point); placePoint(pick.point, pick.existingPointId); }
      }}>
      <defs><pattern id="cad-sketch-grid" x={-center[0] % gridStep} y={center[1] % gridStep} width={gridStep} height={gridStep} patternUnits="userSpaceOnUse"><path d={`M ${gridStep} 0 H 0 V ${gridStep}`} fill="none" stroke="#29373f" strokeWidth={span / 1000} /></pattern></defs>
      {grid && span / gridStep < 2000 && <rect x={-width / 2} y={-span / 2} width={width} height={span} fill="url(#cad-sketch-grid)" />}
      {Math.abs(center[1]) <= span / 2 && <path d={`M ${-width / 2} ${center[1]} H ${width / 2}`} className="cad-axis-x" strokeWidth={span / 700} />}
      {Math.abs(center[0]) <= width / 2 && <path d={`M ${-center[0]} ${-span / 2} V ${span / 2}`} className="cad-axis-y" strokeWidth={span / 700} />}
      <g transform="scale(1,-1)" strokeWidth={span / 450}>
        {savedCurve && <g className="cad-profile is-selected"><CadPathDraftGeometry segments={savedCurve.segments} preview={false} viewCenter={center} /></g>}
        {!graphControls && graphGeometry?.segments.map(segment => {
          const boundary = cadSketchGraphBoundary(segment);
          const construction = graphGeometry.constructionIds.has(segment.id);
          return <g key={segment.id} data-cad-sketch-entity={segment.id} className={`cad-profile${construction ? ' is-construction' : ''}`} strokeDasharray={construction ? `${span / 80} ${span / 120}` : undefined}>
            {boundary.type === 'line' ? <line x1={boundary.start.x - center[0]} y1={boundary.start.y - center[1]} x2={boundary.end.x - center[0]} y2={boundary.end.y - center[1]} />
              : boundary.type === 'circle' ? <circle cx={boundary.center.x - center[0]} cy={boundary.center.y - center[1]} r={boundary.radius} />
                : <path d={cadArcSvgPath(boundary, center)} />}
          </g>;
        })}
        {profiles.map((profile) => <g key={profile.id} role="button" aria-label={`Select ${profile.name} profile`} aria-pressed={profile.id === selectedProfileId && detailSelection.kind === 'profile'} transform={dragPreview?.profile.id === profile.id && !dragPreview.handle ? `translate(${dragPreview.translation[0]} ${dragPreview.translation[1]})` : undefined} tabIndex={tool === 'select' && pickFilter === 'auto' && !interactionLocked ? 0 : -1} data-cad-parameter-highlight={inspection?.profileIds.includes(profile.id) ? profile.id : undefined} className={`cad-profile ${profile.construction ? 'is-construction' : ''} ${profile.id === selectedProfileId && detailSelection.kind === 'profile' ? 'is-selected' : ''} ${inspection?.profileIds.includes(profile.id) ? 'is-parameter-highlighted' : ''}`} strokeDasharray={profile.construction ? `${span / 80} ${span / 120}` : undefined} onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && tool === 'select' && pickFilter === 'auto' && !interactionLocked) { event.preventDefault(); event.stopPropagation(); setActiveHandle(null); onSelectProfile(profile.id); } }} onClick={(event) => { if (event.detail === 0 && event.button === 0 && tool === 'select' && pickFilter === 'auto' && !interactionLocked) { event.stopPropagation(); setActiveHandle(null); onSelectProfile(profile.id); } }}><CadSketchProfileGeometry geometry={dragPreview?.handle && dragPreview.profile.id === profile.id ? dragPreview.profile.geometry : profile.geometry} parameters={parameters} viewCenter={center} /></g>)}
        {tool === 'select' && pickFilter === 'auto' && onMoveHandle && !isPreview && !externalInteractionLocked && <g className="cad-sketch-handles">
          {displayHandles.map(grip => {
            const key = `${grip.profileId}/${cadSketchHandleKey(grip.handle)}`;
            const selected = activeHandle?.profileId === grip.profileId && cadSketchHandleKey(activeHandle.handle) === cadSketchHandleKey(grip.handle);
            return <circle key={key} data-cad-sketch-grip={key} cx={grip.point[0] - center[0]} cy={grip.point[1] - center[1]} r={4 * span / (viewportSize.height || 600)}
              role="button" tabIndex={interactionLocked ? -1 : 0} aria-label={`${grip.label} of ${grip.profileName}${grip.draggable ? '' : grip.unavailableReason ? ', unavailable' : ', constrained'}`} aria-pressed={selected} aria-disabled={interactionLocked || !grip.draggable}
              className={`cad-sketch-handle${selected ? ' is-active' : ''}${grip.draggable ? '' : ' is-locked'}`}
              onClick={event => { if (!interactionLocked && event.detail === 0) { event.stopPropagation(); setActiveHandle(grip); onSelectProfile(grip.profileId); } }}
              onKeyDown={event => {
                if (interactionLocked || viewLocked || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault(); event.stopPropagation(); setActiveHandle(grip); onSelectProfile(grip.profileId); return;
                }
                const step = gridStep * (event.shiftKey ? 10 : 1);
                const delta: SketchPoint | null = event.key === 'ArrowLeft' ? [-step, 0] : event.key === 'ArrowRight' ? [step, 0] : event.key === 'ArrowUp' ? [0, step] : event.key === 'ArrowDown' ? [0, -step] : null;
                if (!delta) return;
                event.preventDefault(); event.stopPropagation();
                if (!grip.draggable) return;
                setActiveHandle(grip); onSelectProfile(grip.profileId);
                submitEdit(signal => commitHandle(grip.profileId, grip.handle, delta, signal), () => undefined, 'Unable to edit this point.');
              }}>
              <title>{grip.label}{grip.draggable ? ' · Drag to edit, or use arrow keys' : ` · ${grip.unavailableReason ?? 'Controlled by dimensions or expressions'}`}</title>
            </circle>;
          })}
        </g>}
        {graphControls && sourceSketch.kind === 'sketch' && sourceGraph && <CadSketchGraphLayer controls={boxSelection.box ? { ...graphControls, selection: boxSelection.box.selections } : graphControls} sketch={sourceSketch} version={documentVersion} prepared={sourceGraph} visual={visualGraph ?? undefined}
          center={center} scaleX={width / (viewportSize.width || 800)} scaleY={span / (viewportSize.height || 600)} gridStep={gridStep} snap={snap} active={tool === 'select'}
          filter={pickFilter} highlighted={pickHighlight} pickAt={event => { const point = getRawPoint(event), rect = svg.current?.getBoundingClientRect(); return point && rect?.height ? sourceGraph.pick(point, span / rect.height, pickFilter)[0] ?? null : null; }}
          locked={externalInteractionLocked || submission.applying || points.length > 0 || pathPending || dragPreview !== null || boxPending || overlapPending} cancelSignal={cancelSignal} onPendingChange={publishGraphPending} onError={onError} />}
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
        {tool === 'path' && snap && cursorPointId && !interactionLocked && viewportSize.height > 0 && <rect data-cad-sketch-snap={cursorPointId} x={cursor[0] - center[0] - span / viewportSize.height * 5} y={cursor[1] - center[1] - span / viewportSize.height * 5} width={span / viewportSize.height * 10} height={span / viewportSize.height * 10} className="cad-sketch-snap-target"><title>Join existing point</title></rect>}
        {points.map(([x, y], index) => <circle key={index} cx={x - center[0]} cy={y - center[1]} r={span / 170} className="cad-sketch-vertex" />)}
        {tool !== 'select' && <g className="cad-crosshair"><path d={`M ${cursor[0] - center[0] - span / 70} ${cursor[1] - center[1]} h ${span / 35} M ${cursor[0] - center[0]} ${cursor[1] - center[1] - span / 70} v ${span / 35}`} /></g>}
      </g>
      {boxSelection.box && <rect className={`cad-sketch-selection-box is-${boxSelection.box.mode}`} pointerEvents="none"
        x={Math.min(boxSelection.box.start[0], boxSelection.box.end[0]) - center[0]} y={center[1] - Math.max(boxSelection.box.start[1], boxSelection.box.end[1])}
        width={Math.abs(boxSelection.box.end[0] - boxSelection.box.start[0])} height={Math.abs(boxSelection.box.end[1] - boxSelection.box.start[1])} />}
    </svg>
    {currentOverlap && <CadContextMenu anchor={{ x: currentOverlap.clientX, y: currentOverlap.clientY }} title="Select other" items={overlapItems} onClose={closeOverlap}
      onOutsidePointerDown={event => { event.preventDefault(); event.stopPropagation(); suppressProfileClick.current = true; }} />}
    {dimensionControls && sketch.kind === 'sketch' && dimensionProfile && dimensionAnchor && tool === 'select' && !isPreview && <CadSketchDimensionControls {...dimensionControls} interactionLocked={dimensionControls.interactionLocked || submission.applying || dragPreview !== null} sketch={sketch} profile={dimensionProfile} parameters={parameters} anchor={dimensionAnchor} project={point => ({ x: (point[0] - center[0]) / width * viewportSize.width + viewportSize.width / 2, y: (center[1] - point[1]) / span * viewportSize.height + viewportSize.height / 2 })} cancelSignal={cancelSignal} />}
    {isPreview && <div className="cad-sketch-context" role="status">Preview · Apply to keep changes</div>}
    {!isPreview && inspection && inspection.profileIds.length > 0 && <div className="cad-sketch-context" role="status">Highlighted geometry · {inspection.profileIds.length} {inspection.profileIds.length === 1 ? 'profile' : 'profiles'}</div>}
    <p id={instructionsId} className="cad-sr-only">{interactionLocked ? 'Drawing is paused while another edit or operation is active.' : instruction} Keyboard: arrow keys move the cursor, Shift moves ten grid steps, Space adds a point, Enter accepts an arc through-point or closes a ready path or polyline, Backspace undoes the last point or segment, Escape cancels drawing, F fits the sketch.</p>
    <CadViewTools label="Sketch controls">{sketch.kind === 'sketch' && <Select aria-label="Sketch selection filter" title="Auto includes points, edges and profiles. Points or Edges restrict direct picking and box selection; Shift toggles selection." density="compact" value={pickFilter} disabled={viewLocked || interactionLocked} onChange={event => setPickFilter(event.target.value as CadSketchGraphPickFilter)}><option value="auto">Auto</option><option value="points">Points</option><option value="edges">Edges</option></Select>}<span className="cad-plane-label">{placementLabel ?? (typeof sketch.plane === 'string' ? sketch.plane : 'Datum plane')}</span><Button aria-label={sketch.kind === 'curve' ? 'Fit curve' : 'Fit sketch'} disabled={viewLocked} onClick={fit}><FitViewIcon size={14} /></Button><Button aria-label="Toggle sketch grid" disabled={viewLocked} aria-pressed={grid} onClick={() => setGrid(!grid)}><GridIcon size={14} /></Button><Button aria-label="Toggle snapping" title="Snap to the grid; Path mode also joins existing graph points" disabled={viewLocked} aria-pressed={snap} onClick={() => setSnap(!snap)}><SnapIcon size={14} /></Button><label className="cad-grid-step">Grid <Input aria-label="Grid spacing" disabled={viewLocked} type="number" min="0.01" value={gridStep} onChange={(event) => { const value = Number(event.target.value); if (value > 0 && Number.isFinite(value)) setGridStep(value); }} /> mm</label><CadContextHelp label="Sketch navigation">{navigationMode === 'trackpad' ? 'Use two-finger scrolling to pan and pinch to zoom.' : 'Drag with the right mouse button to pan and use the wheel to zoom.'} Press F to fit the sketch and Escape to cancel unfinished drawing.</CadContextHelp></CadViewTools>
    {!externalInteractionLocked && (tool !== 'select' || points.length > 0) && <CadDrawingTools active={points.length > 0 || pathPending}><div className={`cad-sketch-instruction ${tool === 'path' ? 'cad-path-instruction' : ''}`} onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'Escape' && submission.applying) { event.preventDefault(); event.stopPropagation(); cancelDrawing(); svg.current?.focus(); return; }
      if (tool !== 'path' || !pathPending || interactionLocked || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Backspace' || event.key === 'Escape') { event.preventDefault(); changePath({ kind: event.key === 'Backspace' ? 'undo-last' : 'cancel' }, true); }
    }}><span>{instruction}</span>
      {tool === 'path' && <>
        <div className="cad-path-modes" role="group" aria-label="Path segment mode"><Button disabled={interactionLocked || pathDraft.kind === 'arc-through'} aria-pressed={pathMode === 'line'} onClick={() => changePath({ kind: 'mode', mode: 'line' }, true)}>Line</Button><Button disabled={interactionLocked || pathDraft.kind === 'arc-through'} aria-pressed={pathMode === 'arc'} onClick={() => changePath({ kind: 'mode', mode: 'arc' }, true)}>3-point Arc</Button></div>
        {pathPending && <>{sketch.kind === 'sketch' && onAddPath && <Button aria-label="Finish path" title="Keep this path open without adding a closing edge" disabled={interactionLocked || pathDraft.kind !== 'ready' || !pathDraft.segments.length} onClick={() => finishPath(false)}><ConfirmIcon size={13} /> Finish path</Button>}<Button aria-label={sketch.kind === 'curve' ? 'Finish curve' : 'Close profile'} title={sketch.kind === 'curve' ? 'Validate and save the open curve without a closing edge' : pathNeedsClosingLine ? 'Close the profile by adding a straight line to its start' : 'Validate and save the closed profile'} disabled={interactionLocked || pathDraft.kind !== 'ready' || !pathDraft.segments.length} onClick={() => finishPath(true)}><ConfirmIcon size={13} />{sketch.kind === 'curve' ? 'Finish curve' : pathNeedsClosingLine ? 'Close with line' : 'Close profile'}</Button><Button disabled={interactionLocked} onClick={() => changePath({ kind: 'undo-last' }, true)}><UndoIcon size={13} /> Undo last</Button><Button onClick={() => changePath({ kind: 'cancel' }, true)}><CloseIcon size={13} /> Cancel drawing</Button></>}
      </>}
      {tool === 'polygon' && points.length >= 3 && <Button disabled={interactionLocked} onClick={close}><ConfirmIcon size={13} /> Close profile</Button>}{points.length > 0 && <Button onClick={cancelDrawing}><CloseIcon size={13} /> Cancel drawing</Button>}</div></CadDrawingTools>}
    <div className="cad-view-caption">{formatCadQuantity(cursor[0])}, {formatCadQuantity(cursor[1])} mm</div>
  </div>;
}
