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
import { closeSketchPolygon, snapSketchPoint, twoPointSketchProfile, type SketchPoint, type SketchTool } from './cadSketchInteraction';
import { CadSketchProfileGeometry } from './CadSketchProfileGeometry';
import { createCadSketchHandlePicker, createCadSketchProfilePicker, type CadSketchHandlePick } from './cadSketchPicking';
import { cadPathDraftEndpoint, closeCadPathDraft, createCadPathDraft, finishCadCurveDraft, previewCadPathDraft, updateCadPathDraft, type CadPathDraft, type CadPathDrawingAction } from './cadPathDrawing';
import { prepareCadSketchGeometrySnaps, type CadSketchSnapCandidate } from './cadSketchGeometrySnaps';
import { prepareCadSketchProfilePositionSnaps } from './cadSketchProfilePositionSnaps';
import { cadSketchProfileSnapLabel } from './cadSketchSnapLabels';
import { CadSketchSnapHint } from './CadSketchSnapHint';
import { CadSketchSnapChooser } from './CadSketchSnapChooser';
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
import type { CadFreshSketchDrawing, CadFreshSketchPick } from '@/domain/cad/cadFreshSketchGraph';
import { CadSketchSplitPreview, prepareCadSketchSplitPreview, type CadSketchSplitPreview as SplitPreview } from './CadSketchSplitPreview';
import { CadSketchTrimPreview, prepareCadSketchTrimPreview, type CadSketchTrimPreview as TrimPreview,
  CadSketchExtendPreview, prepareCadSketchExtendPreview, prepareCadSketchExtendEndPreview, type CadSketchExtendPreview as ExtendPreview } from './CadSketchBoundaryPreview';

const NO_PROFILES: readonly CadSketchProfile[] = Object.freeze([]);
const snapDraftStart = prepareCadSketchGeometrySnaps();
type DrawingPick = { readonly point: SketchPoint } & (
  | { readonly candidates: readonly CadSketchSnapCandidate[]; readonly existingPointId?: never; readonly candidate?: never }
  | { readonly existingPointId?: string; readonly candidate?: CadSketchSnapCandidate; readonly candidates?: never }
);
interface DrawingSnapChoice {
  readonly owner: object;
  readonly candidates: readonly CadSketchSnapCandidate[];
  readonly clientX: number; readonly clientY: number; readonly frame: string;
}
interface DrawingCursor { readonly point: SketchPoint; readonly mode: 'pointer' | 'position'; readonly suppressed: boolean }
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
  readonly document: CadSketchGraphControls['document'];
  readonly version?: string; readonly cancelSignal: number; readonly filter: CadSketchGraphPickFilter; readonly frameKey: string; readonly frame: string;
  readonly clientX: number; readonly clientY: number; readonly toggle: boolean; readonly candidates: readonly CadSketchGraphSelection[];
  readonly target?: CadSketchGraphSelection;
  readonly split?: SplitPreview;
  readonly trim?: TrimPreview;
  readonly extend?: ExtendPreview;
  readonly extendEnds?: readonly { readonly end: 'start' | 'end'; readonly preview: ExtendPreview }[];
  readonly extendEnd?: 'start' | 'end';
  readonly action?: 'split' | 'trim' | 'extend';
}

export function CadSketchCanvas({ sketch: sourceSketch, parameters, documentVersion, placementLabel, tool, selectedProfileId, onSelectProfile, onAddProfile, onAddFreshSketch, onAddPath, onTranslateProfile, onMoveHandle, onAddCurve, onCancelCurve, curveCreation = false, onPendingChange, onError, cancelSignal, interactionLocked: externalInteractionLocked = false, onControlsReady, viewLocked = false, navigationMode = 'mouse', onContextMenu, previewProfile, previewSketch, graphControls, inspection, dimensionControls, getFitArea }: {
  sketch: CadSketchFeature | CadCurveFeature;
  parameters: Readonly<Record<string, number>>;
  documentVersion?: string;
  placementLabel?: string;
  tool: SketchTool;
  selectedProfileId: string | null;
  onSelectProfile(id: string | null): void;
  onAddProfile(geometry: CadProfile, signal?: AbortSignal): CadEditCompletion;
  onAddFreshSketch?(drawing: CadFreshSketchDrawing, signal?: AbortSignal): CadEditCompletion;
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
  const [snapChoice, setSnapChoice] = useState<DrawingSnapChoice | null>(null);
  const [choiceHighlight, setChoiceHighlight] = useState<CadSketchSnapCandidate | null>(null);
  const baseInteractionLocked = externalInteractionLocked || submission.applying || graphPending;
  const overlapPending = overlap !== null;
  const choicePending = snapChoice !== null;
  const interactionLocked = baseInteractionLocked || overlapPending || choicePending;
  const svg = useRef<SVGSVGElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const instructionsId = useId();
  const [picks, setPicks] = useState<readonly CadFreshSketchPick[]>([]);
  const points = useMemo(() => picks.map(pick => pick.point), [picks]);
  const [inferCoincidence, setInferCoincidence] = useState(false);
  const [pathDraft, setPathDraft] = useState(createCadPathDraft);
  const [cursorInput, setCursorInput] = useState<DrawingCursor>({ point: [0, 0], mode: 'position', suppressed: false });
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
  const edgeSubmission = useRef<CadSketchOverlapPick | null>(null);
  const cancelEdgeSubmission = useCallback(() => {
    if (!edgeSubmission.current) return;
    edgeSubmission.current = null; submission.cancel(); pendingChange.current(false);
  }, [submission.cancel]);
  useEffect(() => {
    window.addEventListener('blur', cancelEdgeSubmission);
    return () => window.removeEventListener('blur', cancelEdgeSubmission);
  }, [cancelEdgeSubmission]);
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
  const attachedSource = useRef<{ readonly sketch: typeof sourceSketch; readonly version: typeof documentVersion;
    readonly parameters: typeof graphSourceParameters; readonly document: CadSketchGraphControls['document'] | undefined } | null>(null);
  useLayoutEffect(() => { if (!picks.some(pick => pick.kind === 'coincident')) attachedSource.current = null; }, [picks]);
  const attachedSourceCurrent = () => {
    const owned = attachedSource.current;
    if (!owned || owned.sketch === sourceSketch && owned.version === documentVersion && owned.parameters === graphSourceParameters && owned.document === graphControls?.document) return true;
    onError('The sketch changed. Cancel this drawing or release its pending relations before continuing.');
    return false;
  };
  const sourceGraph = useMemo(() => sourceSketch.kind === 'sketch' && sourceSketch.graph ? prepareCadSketchGraphInteraction(sourceSketch.graph, graphSourceParameters) : null, [sourceSketch, graphSourceParameters]);
  const sourceProfiles = sourceSketch.kind === 'sketch' ? sourceSketch.profiles : NO_PROFILES;
  const profileSnapSources = useMemo(() => prepareCadSketchProfilePositionSnaps({ profiles: sourceProfiles, parameters: graphSourceParameters }), [sourceProfiles, graphSourceParameters]);
  const drawingSnaps = useMemo(() => prepareCadSketchGeometrySnaps(sourceGraph ? { graph: sourceGraph.graph, points: sourceGraph.points, segments: sourceGraph.geometry.segments } : undefined,
    profileSnapSources), [sourceGraph, profileSnapSources]);
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
  useEffect(() => { edgeSubmission.current = null; submission.cancel(); setHoverHandle(null); setDetailSelection({ kind: 'profile' }); ownedHandleEdit.current = null; setDragPreview(null); }, [sketch.id, tool, cancelSignal, submission.cancel]);
  const width = span * aspect;
  const drawingCandidate = (candidate: CadSketchSnapCandidate): DrawingPick => {
    const target = candidate.target;
    const existingPointId = tool === 'path' && sourceSketch.kind === 'sketch' && onAddPath && pathDraft.kind !== 'arc-through'
      ? 'pointId' in target ? target.pointId : target.kind === 'draft-start' && pathDraft.kind !== 'idle' ? pathDraft.startPointId : undefined : undefined;
    return { point: candidate.point, candidate, ...(existingPointId === undefined ? {} : { existingPointId }) };
  };
  const resolveDrawingPick = (raw: SketchPoint, suppressed: boolean, mode: DrawingCursor['mode'], mmPerPixel: SketchPoint = [width / viewportSize.width, span / viewportSize.height]): DrawingPick => {
    if (suppressed || mode === 'position') return { point: raw };
    const draftStart = tool === 'path' && pathDraft.kind !== 'idle' && pathDraft.kind !== 'arc-through'
      ? { point: pathDraft.start, ...(pathDraft.startPointId === undefined ? {} : { pointId: pathDraft.startPointId }) }
      : tool === 'polygon' && points.length >= 3 ? { point: points[0] } : undefined;
    if (tool !== 'select') {
      if (tool === 'polygon' && draftStart) {
        // Closing an owned draft is explicit topology intent, independent of
        // other saved points at that same position. It never borrows their IDs.
        const closure = snapDraftStart({ cursor: raw, mmPerPixel, draftStart });
        if (closure.kind === 'hit') return { point: closure.candidate.point, candidate: closure.candidate };
      }
      const result = (snap ? drawingSnaps : snapDraftStart)({ cursor: raw, mmPerPixel, draftStart });
      if (result.kind === 'hit') return drawingCandidate(result.candidate);
      if (result.kind === 'ambiguous') return { point: raw, candidates: result.candidates };
    }
    return { point: snapSketchPoint(raw, gridStep, snap) };
  };
  const cursorPick = resolveDrawingPick(cursorInput.point, cursorInput.suppressed, cursorInput.mode);
  const cursor = cursorPick.point;
  const snapHint = tool !== 'select' && !interactionLocked ? cursorPick.candidate : undefined;
  const freshDrawing = sourceSketch.kind === 'sketch' && (tool === 'rectangle' || tool === 'circle' || tool === 'polygon');
  const canInfer = freshDrawing && Boolean(onAddFreshSketch);
  const inferencePoint = canInfer && inferCoincidence && !(tool === 'circle' && picks.length) && snapHint && 'pointId' in snapHint.target ? snapHint.target.pointId : undefined;
  const snapLabel = inferencePoint ? `Coincident with Point ${(sourceGraph?.graph.points.findIndex(point => point.id === inferencePoint) ?? -1) + 1}`
    : snapHint ? snapHint.target.kind === 'profile-position' ? `${cadSketchProfileSnapLabel(snapHint.target, sourceProfiles)} · Position only · No relation`
    : snapHint.target.kind === 'draft-start' ? tool === 'polygon' ? 'Close profile' : 'Path start'
    : cursorPick.existingPointId ? `Join ${snapHint.target.kind}` : `${snapHint.target.kind[0].toUpperCase()}${snapHint.target.kind.slice(1)} position · No relation` : '';
  const snapHighlight: CadSketchGraphSelection | null = snapHint && 'pointId' in snapHint.target ? { kind: 'point', id: snapHint.target.pointId }
    : snapHint?.target.kind === 'midpoint' ? { kind: 'entity', id: snapHint.target.entityId } : null;
  useEffect(() => {
    if (tool === 'select') return;
    const modifiers = (event: KeyboardEvent) => {
      if (event.isComposing || event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      setCursorInput(current => current.suppressed === (event.ctrlKey || event.metaKey) ? current : { ...current, suppressed: event.ctrlKey || event.metaKey });
    };
    const blur = () => setCursorInput(current => ({ ...current, mode: 'position', suppressed: false }));
    window.addEventListener('keydown', modifiers); window.addEventListener('keyup', modifiers); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', modifiers); window.removeEventListener('keyup', modifiers); window.removeEventListener('blur', blur); };
  }, [tool]);
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
  const viewSignature = JSON.stringify([sketch.plane, center, span, aspect, grid, snap, gridStep, pickFilter, boxPending, graphPending, pickHighlight, choicePending,
    choiceHighlight ? [choiceHighlight.target, choiceHighlight.point, choiceHighlight.entityIds] : null,
    overlap ? [overlap.clientX, overlap.clientY, overlap.target, overlap.split, overlap.trim, overlap.extend, overlap.extendEnds, overlap.extendEnd, overlap.action] : null, tool !== 'select' ? [cursor, picks, pathDraft] : null,
    snapHint ? [snapHint.target, snapHint.point, snapLabel] : null, previewProfile?.geometry, previewSketch ? [previewSketch.profiles, previewSketch.graph] : null,
    graphControls ? [graphControls.selection, graphControls.relation, graphControls.inspection, graphControls.degreesOfFreedom, graphControls.showDimensions] : null, inspection, dragPreview?.translation]);
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
  useEffect(() => { setPicks([]); setPathDraft(createCadPathDraft()); }, [sketch.id, tool, cancelSignal]);
  useLayoutEffect(() => { setCursorInput(current => ({ ...current, mode: 'position' })); }, [sourceSketch, graphSourceParameters, tool, cancelSignal, center, span, aspect]);
  const pathPending = tool === 'path' && pathDraft.kind !== 'idle';
  useLayoutEffect(() => { onPendingChange(points.length > 0 || pathPending || dragPreview !== null || submission.applying || graphPending || boxPending || overlapPending || choicePending); }, [points.length, pathPending, dragPreview !== null, submission.applying, graphPending, boxPending, overlapPending, choicePending, onPendingChange]);
  const publishGraphPending = useCallback((value: boolean) => {
    setGraphPending(value); pendingChange.current(value || points.length > 0 || pathPending || dragPreview !== null || submission.applying || boxPending || overlapPending || choicePending);
  }, [points.length, pathPending, dragPreview !== null, submission.applying, boxPending, overlapPending, choicePending]);
  const publishBoxPending = useCallback((value: boolean) => {
    setBoxPending(value); pendingChange.current(value || points.length > 0 || pathPending || dragPreview !== null || submission.applying || graphPending || overlapPending || choicePending);
  }, [points.length, pathPending, dragPreview !== null, submission.applying, graphPending, overlapPending, choicePending]);
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
  // Identity pins the complete accepted source, unfinished drawing and camera.
  // Cursor movement over the menu does not change the captured drawing intent.
  const drawingOwner = useMemo(() => ({ sourceSketch, drawingSnaps, parameters: graphSourceParameters, document: graphControls?.document,
    documentVersion, tool, picks, pathDraft, inferCoincidence, snap, gridStep, cancelSignal, spatialFrameKey,
    pathAvailable: Boolean(onAddPath), freshAvailable: Boolean(onAddFreshSketch) }),
  [sourceSketch, drawingSnaps, graphSourceParameters, graphControls?.document, documentVersion, tool, picks, pathDraft, inferCoincidence, snap, gridStep, cancelSignal, spatialFrameKey, Boolean(onAddPath), Boolean(onAddFreshSketch)]);
  const choiceEnvironment = useRef({ owner: drawingOwner, locked: false });
  // Our own drawing pending locks navigation; viewLocked must not dismiss its chooser.
  choiceEnvironment.current = { owner: drawingOwner, locked: baseInteractionLocked || overlapPending || isPreview };
  const choiceIsCurrent = (choice: DrawingSnapChoice) => choice.owner === choiceEnvironment.current.owner && !choiceEnvironment.current.locked
    && projectSelection(choice)?.frame === choice.frame;
  const currentSnapChoice = snapChoice && choiceIsCurrent(snapChoice) ? snapChoice : null;
  const profileSnapTarget = (currentSnapChoice ? choiceHighlight : snapHint)?.target;
  const snapProfile = profileSnapTarget?.kind === 'profile-position' ? sourceProfiles.find(profile => profile.id === profileSnapTarget.profileId) : undefined;
  const choicePointId = choiceHighlight && 'pointId' in choiceHighlight.target ? choiceHighlight.target.pointId : undefined;
  const closeSnapChoice = useCallback(() => { setSnapChoice(null); setChoiceHighlight(null); svg.current?.focus({ preventScroll: true }); }, []);
  useLayoutEffect(() => { if (snapChoice && !currentSnapChoice) closeSnapChoice(); }, [snapChoice, currentSnapChoice, closeSnapChoice]);
  useLayoutEffect(() => {
    const owned = edgeSubmission.current;
    if (owned && (externalInteractionLocked || isPreview || owned.frameKey !== spatialFrameKey || projectSelection(owned)?.frame !== owned.frame)) cancelEdgeSubmission();
  });
  const boxSelection = useCadSketchBoxSelection({ prepared: sourceGraph, enabled: tool === 'select' && !isPreview && sketch.kind === 'sketch', locked: interactionLocked,
    version: documentVersion, cancelSignal, frameKey: spatialFrameKey, filter: pickFilter,
    selection: graphControls?.selection ?? [], onSelectSet: graphControls?.onSelectSet, onPendingChange: publishBoxPending, onError,
    onCancel: () => { suppressProfileClick.current = true; },
    project: projectSelection });
  const currentOverlap = overlap && overlap.prepared === sourceGraph && overlap.document === graphControls?.document && overlap.version === documentVersion && overlap.cancelSignal === cancelSignal
    && overlap.filter === pickFilter && overlap.frameKey === spatialFrameKey && tool === 'select' && !isPreview && !baseInteractionLocked ? overlap : null;
  const closeOverlap = useCallback(() => { setOverlap(null); setPickHighlight(null); }, []);
  useLayoutEffect(() => { if (overlap && !currentOverlap) closeOverlap(); }, [overlap, currentOverlap, closeOverlap]);
  const openOverlap = (event: { clientX: number; clientY: number; shiftKey?: boolean }, trigger: 'pointer' | 'keyboard' = 'pointer', focusedEntityId?: string) => {
    const projection = projectSelection(event), rect = svg.current?.getBoundingClientRect();
    if (!sourceGraph || !graphControls || !projection || !rect?.height || tool !== 'select' || isPreview || interactionLocked) return false;
    const candidates = sourceGraph.pick(projection.point, span / rect.height, pickFilter);
    const focused = focusedEntityId && trigger === 'keyboard' && pickFilter !== 'points' && sourceGraph.graph.entities.some(entity => entity.id === focusedEntityId && entity.kind === 'line')
      ? { kind: 'entity' as const, id: focusedEntityId } : undefined;
    if (!candidates.length && !focused) return false;
    const selected = graphControls.selection.length === 1 ? graphControls.selection[0] : null;
    const target = trigger === 'pointer' ? candidates.length === 1 && candidates[0].kind === 'entity' ? candidates[0]
      : selected?.kind === 'entity' && candidates.some(atom => atom.kind === 'entity' && atom.id === selected.id) ? selected : undefined : focused;
    setOverlap({ prepared: sourceGraph, document: graphControls.document, version: documentVersion, cancelSignal, filter: pickFilter, frameKey: spatialFrameKey, frame: projection.frame,
      clientX: event.clientX, clientY: event.clientY, toggle: Boolean(event.shiftKey), candidates, target,
      ...(focused ? { action: 'extend', extendEnd: 'start', extendEnds: (['start', 'end'] as const).map(end => ({ end,
        preview: prepareCadSketchExtendEndPreview(sourceGraph, sourceSketch.id, focused.id, end) })) }
        : target ? { action: 'split', split: prepareCadSketchSplitPreview(sourceGraph, sourceSketch.id, target.id, projection.point),
        trim: prepareCadSketchTrimPreview(sourceGraph, sourceSketch.id, target.id, projection.point),
        extend: prepareCadSketchExtendPreview(sourceGraph, sourceSketch.id, target.id, projection.point) } : {}) });
    return true;
  };
  const selectOverlap = (atom: CadSketchGraphSelection) => {
    if (!currentOverlap || projectSelection(currentOverlap)?.frame !== currentOverlap.frame || baseInteractionLocked) return;
    try { graphControls?.onSelect(atom, currentOverlap.toggle); }
    catch (cause) { onError(cause instanceof Error ? cause.message : 'Unable to select this geometry.'); return; }
    svg.current?.querySelector<SVGGElement>(`[data-cad-sketch-${atom.kind === 'point' ? 'point' : 'entity'}="${atom.id}"]`)?.focus({ preventScroll: true });
  };
  const overlapTarget = currentOverlap?.target;
  const highlightEdgeAction = (action?: CadSketchOverlapPick['action'], extendEnd?: 'start' | 'end') => {
    setPickHighlight(null); setOverlap(current => current && { ...current, action, extendEnd });
  };
  const activeExtend = currentOverlap?.extendEnds?.find(option => option.end === currentOverlap.extendEnd)?.preview ?? currentOverlap?.extend;
  const extendItems: readonly CadContextMenuItem[] = currentOverlap ? (currentOverlap.extendEnds ?? (currentOverlap.extend ? [{ end: undefined, preview: currentOverlap.extend }] : []))
    .map(({ end, preview }) => ({ label: preview.label, disabled: preview.kind !== 'ready', help: preview.kind === 'unavailable' ? preview.reason : preview.help,
      onHighlight: () => highlightEdgeAction('extend', end), onSelect: () => {
        if (projectSelection(currentOverlap)?.frame !== currentOverlap.frame || baseInteractionLocked || preview.kind !== 'ready' || !graphControls) return;
        const { edit } = preview, owned = currentOverlap; edgeSubmission.current = owned;
        submitEdit(signal => graphControls.onEditMany([edit], signal), () => {
          if (edgeSubmission.current !== owned) return;
          edgeSubmission.current = null;
          if (projectSelection(owned)?.frame === owned.frame) graphControls.onSelect({ kind: 'point', id: edit.extend.endPointId });
        }, 'Unable to extend this line.');
      } })) : [];
  const overlapItems: readonly CadContextMenuItem[] = currentOverlap && overlapTarget ? [
    ...(currentOverlap.extendEnds ? [] : [
    { label: 'Split here', disabled: currentOverlap.split?.kind !== 'ready', help: currentOverlap.split?.kind === 'unavailable' ? currentOverlap.split.reason : undefined,
      onHighlight: () => highlightEdgeAction('split'), onSelect: () => {
      if (projectSelection(currentOverlap)?.frame !== currentOverlap.frame || baseInteractionLocked || currentOverlap.split?.kind !== 'ready' || !graphControls) return;
      const { edit } = currentOverlap.split;
      const owned = currentOverlap; edgeSubmission.current = owned;
      submitEdit(signal => graphControls.onEditMany([edit], signal), () => {
        if (edgeSubmission.current !== owned) return;
        edgeSubmission.current = null;
        if (projectSelection(owned)?.frame === owned.frame) graphControls.onSelect({ kind: 'point', id: edit.split.splitPointId });
      }, 'Unable to split this edge.');
    } },
    { label: 'Trim here', disabled: currentOverlap.trim?.kind !== 'ready', danger: currentOverlap.trim?.kind === 'ready' && currentOverlap.trim.edit.trim.kind === 'delete',
      help: currentOverlap.trim?.kind === 'unavailable' ? currentOverlap.trim.reason : currentOverlap.trim?.help,
      onHighlight: () => highlightEdgeAction('trim'), onSelect: () => {
        if (projectSelection(currentOverlap)?.frame !== currentOverlap.frame || baseInteractionLocked || currentOverlap.trim?.kind !== 'ready' || !graphControls) return;
        const { edit } = currentOverlap.trim, owned = currentOverlap; edgeSubmission.current = owned;
        submitEdit(signal => graphControls.onEditMany([edit], signal), () => {
          if (edgeSubmission.current !== owned) return;
          edgeSubmission.current = null;
          if (projectSelection(owned)?.frame === owned.frame) {
            if (edit.trim.kind === 'end') graphControls.onSelect({ kind: 'point', id: edit.trim.cutPointId });
            else if (edit.trim.kind === 'middle') graphControls.onSelect({ kind: 'point', id: edit.trim.cutPointIds[0] });
            else graphControls.onSelectSet?.(graphControls.selection.filter(atom => atom.kind !== 'entity' || atom.id !== edit.trim.entityId));
          }
        }, 'Unable to trim this edge.');
      } }]),
    ...extendItems,
    { label: 'Select edge', onHighlight: () => { highlightEdgeAction(); setPickHighlight(overlapTarget); }, onSelect: () => selectOverlap(overlapTarget) },
    ...(currentOverlap.candidates.length > 1 ? [{ label: 'Select other', onSelect: () => setOverlap({ ...currentOverlap, target: undefined, split: undefined, trim: undefined, extend: undefined, extendEnds: undefined, extendEnd: undefined, action: undefined }) }] : [])
  ] : currentOverlap?.candidates.map(atom => {
    const point = atom.kind === 'point' ? sourceGraph?.points.find(point => point.id === atom.id) : null;
    const index = atom.kind === 'point' ? sourceGraph?.graph.points.findIndex(point => point.id === atom.id) : sourceGraph?.graph.entities.findIndex(entity => entity.id === atom.id);
    const entity = atom.kind === 'entity' ? sourceGraph?.graph.entities.find(entity => entity.id === atom.id) : null;
    const label = point ? `Point ${(index ?? -1) + 1} · ${point.position.map(value => formatCadQuantity(value)).join(', ')} mm`
      : `${entity?.kind === 'line' ? 'Line' : entity?.kind === 'circle' ? 'Circle' : 'Arc'} ${(index ?? -1) + 1}`;
    return { label, onHighlight: () => setPickHighlight(atom), onSelect: () => selectOverlap(atom) };
  }) ?? [];
  const getDrawingPick = (event: { clientX: number; clientY: number; ctrlKey: boolean; metaKey: boolean }): DrawingPick => {
    const raw = getRawPoint(event) ?? [0, 0], suppressed = event.ctrlKey || event.metaKey, rect = svg.current?.getBoundingClientRect();
    setCursorInput({ point: raw, suppressed, mode: 'pointer' });
    return resolveDrawingPick(raw, suppressed, 'pointer', [width / (rect?.width || 0), span / (rect?.height || 0)]);
  };
  const pickGrip = (event: { target: EventTarget | null }, point: SketchPoint, millimetersPerPixel: number) => {
    const key = event.target instanceof Element ? event.target.closest('[data-cad-sketch-grip]')?.getAttribute('data-cad-sketch-grip') : null;
    const owned = key ? handlePicker.handles.find(grip => `${grip.profileId}/${cadSketchHandleKey(grip.handle)}` === key) : null;
    return owned ?? handlePicker.pick(point, millimetersPerPixel, selectedProfileId);
  };
  const submitEdit = (apply: (signal: AbortSignal) => CadEditCompletion, accepted: () => void, fallback: string) => {
    pendingChange.current(true);
    submission.submit(apply, accepted, error => {
      edgeSubmission.current = null; ownedHandleEdit.current = null; setDragPreview(null);
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
    try { setPathDraft(updateCadPathDraft(pathDraft, action)); setCursorInput(current => ({ ...current, point: action.kind === 'point' ? action.point : cursor, mode: 'position' })); }
    catch (error) { onError(error instanceof Error ? error.message : 'Unable to draw this path.'); }
    if (action.kind === 'cancel' && curveCreation) onCancelCurve?.();
    if (focus) svg.current?.focus();
  };
  const cancelDrawing = () => {
    closeSnapChoice();
    edgeSubmission.current = null; submission.cancel(); ownedHandleEdit.current = null;
    setDragPreview(null); setPicks([]); setPathDraft(createCadPathDraft()); setCursorInput(current => ({ ...current, mode: 'position' }));
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
  const add = (geometry: CadProfile, drawing?: CadFreshSketchDrawing) => {
    try {
      if (!attachedSourceCurrent()) return;
      if (drawing && !onAddFreshSketch && picks.some(pick => pick.kind === 'coincident')) throw new Error('The attached drawing cannot be saved by this editor. Cancel or release its pending relations.');
      submitEdit(signal => drawing && onAddFreshSketch ? onAddFreshSketch(drawing, signal) : onAddProfile(geometry, signal), () => setPicks([]), 'Unable to add this profile.');
    }
    catch (error) { onError(error instanceof Error ? error.message : 'Unable to add this profile.'); }
  };
  const close = () => {
    try { add(closeSketchPolygon(points), { kind: 'polygon', vertices: picks }); }
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
      setCursorInput({ point: Math.abs(snapped[0] - target[0]) <= heightSpan * measuredAspect.current / 2 && Math.abs(snapped[1] - target[1]) <= heightSpan / 2 ? snapped : target, suppressed: false, mode: 'position' });
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
  const placePoint = (point: SketchPoint, existingPointId?: string, candidate?: CadSketchSnapCandidate) => {
    if (interactionLocked) return;
    if (tool === 'select') { onSelectProfile(null); return; }
    if (tool === 'path') { changePath({ kind: 'point', point, ...(existingPointId === undefined ? {} : { existingPointId }) }); return; }
    if (!attachedSourceCurrent()) return;
    const authoredPick = (): CadFreshSketchPick => canInfer && inferCoincidence && candidate && 'pointId' in candidate.target
      ? Object.freeze({ kind: 'coincident', point, sourcePointId: candidate.target.pointId, relationId: crypto.randomUUID() })
      : Object.freeze({ kind: 'position', point });
    const appendPick = (pick: CadFreshSketchPick) => {
      if (pick.kind === 'coincident' && !attachedSource.current) attachedSource.current = { sketch: sourceSketch, version: documentVersion, parameters: graphSourceParameters, document: graphControls?.document };
      setPicks([...picks, pick]);
    };
    if (tool === 'polygon') {
      if (first && points.length >= 3 && point[0] === first[0] && point[1] === first[1]) { close(); return; }
      if (!points.some(([x, y]) => x === point[0] && y === point[1])) appendPick(authoredPick());
    } else if (first) {
      try {
        const geometry = twoPointSketchProfile(tool, first, point);
        add(geometry, tool === 'rectangle' ? { kind: 'rectangle', first: picks[0], opposite: authoredPick() }
          : tool === 'circle' && geometry.kind === 'circle' && typeof geometry.radius === 'number' ? { kind: 'circle', center: picks[0], radius: geometry.radius } : undefined);
      }
      catch (error) { onError(error instanceof Error ? error.message : 'Unable to draw this profile.'); }
    } else appendPick(authoredPick());
  };
  // CadContextMenu closes synchronously before invoking a chosen item. Use the
  // post-close handler so normal foreign-workflow and submission guards remain active.
  const placeChosen = useRef<(candidate: CadSketchSnapCandidate) => void>(() => undefined);
  placeChosen.current = candidate => { const pick = drawingCandidate(candidate); placePoint(pick.point, pick.existingPointId, pick.candidate); };
  const acceptDrawingPick = (pick: DrawingPick, anchor?: { clientX: number; clientY: number }) => {
    if (interactionLocked) return;
    if (!pick.candidates) { placePoint(pick.point, pick.existingPointId, pick.candidate); return; }
    const bounds = svg.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height || !attachedSourceCurrent()) return;
    const at = anchor ?? { clientX: bounds.left + bounds.width / 2 + (pick.point[0] - center[0]) / width * bounds.width,
      clientY: bounds.top + bounds.height / 2 - (pick.point[1] - center[1]) / span * bounds.height };
    const projected = projectSelection(at); if (!projected) return;
    pendingChange.current(true);
    setSnapChoice({ owner: drawingOwner, candidates: pick.candidates, ...at, frame: projected.frame });
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
      onPointerDownCapture={event => {
        // A cancelled graph drag can release over empty canvas; its trailing click still belongs to the handle.
        if (event.button === 0 && event.target instanceof Element && event.target.closest('.cad-sketch-graph')) suppressProfileClick.current = true;
      }}
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
          getDrawingPick(event);
          if (tool === 'select' && onMoveHandle && !interactionLocked && !viewLocked) {
            const point = getRawPoint(event), rect = event.currentTarget.getBoundingClientRect();
            const graphHit = event.target instanceof Element && event.target.closest('[data-cad-sketch-point], [data-cad-sketch-entity]');
            setHoverHandle(!graphHit && point && rect.height ? pickGrip(event, point, span / rect.height) : null);
          }
        }
      }}
      onPointerLeave={() => { setHoverHandle(null); setCursorInput(current => ({ ...current, point: cursor, mode: 'position' })); }}
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
            clientY: bounds.top + bounds.height / 2 - (at[1] - center[1]) / span * bounds.height }, 'keyboard', entityId ?? undefined)) return;
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
          event.preventDefault();
          setCursorInput({ point: [cursor[0] + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), cursor[1] + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0)], suppressed: false, mode: 'position' });
        } else if ((event.key === 'Enter' || event.key === ' ') && tool !== 'select') {
          event.preventDefault();
          if (event.key === 'Enter' && tool === 'path' && pathDraft.kind === 'ready') finishPath(true);
          else if (event.key === 'Enter' && tool === 'polygon' && points.length >= 3) close();
          else acceptDrawingPick(cursorPick);
        } else if (tool === 'path' && pathPending && (event.key === 'Backspace' || event.key === 'Escape')) { event.preventDefault(); changePath({ kind: event.key === 'Backspace' ? 'undo-last' : 'cancel' }); }
        else if (event.key === 'Backspace' && points.length) { event.preventDefault(); setPicks((current) => current.slice(0, -1)); }
        else if (event.key === 'Escape' && points.length) { event.preventDefault(); setPicks([]); }
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
        } else acceptDrawingPick(getDrawingPick(event), event);
      }}>
      <defs><pattern id="cad-sketch-grid" x={-center[0] % gridStep} y={center[1] % gridStep} width={gridStep} height={gridStep} patternUnits="userSpaceOnUse"><path d={`M ${gridStep} 0 H 0 V ${gridStep}`} fill="none" stroke="#29373f" strokeWidth={span / 1000} /></pattern></defs>
      {grid && span / gridStep < 2000 && <rect x={-width / 2} y={-span / 2} width={width} height={span} fill="url(#cad-sketch-grid)" />}
      {Math.abs(center[1]) <= span / 2 && <path d={`M ${-width / 2} ${center[1]} H ${width / 2}`} className="cad-axis-x" strokeWidth={span / 700} />}
      {Math.abs(center[0]) <= width / 2 && <path d={`M ${-center[0]} ${-span / 2} V ${span / 2}`} className="cad-axis-y" strokeWidth={span / 700} />}
      <g transform="scale(1,-1)" strokeWidth={span / 450}>
        {savedCurve && <g className="cad-profile is-selected"><CadPathDraftGeometry segments={savedCurve.segments} preview={false} viewCenter={center} /></g>}
        {(!graphControls || !sourceGraph) && graphGeometry?.segments.map(segment => {
          const boundary = cadSketchGraphBoundary(segment);
          const construction = graphGeometry.constructionIds.has(segment.id);
          return <g key={segment.id} data-cad-sketch-entity={segment.id} className={`cad-profile${construction ? ' is-construction' : ''}`} strokeDasharray={construction ? `${span / 80} ${span / 120}` : undefined}>
            {boundary.type === 'line' ? <line x1={boundary.start.x - center[0]} y1={boundary.start.y - center[1]} x2={boundary.end.x - center[0]} y2={boundary.end.y - center[1]} />
              : boundary.type === 'circle' ? <circle cx={boundary.center.x - center[0]} cy={boundary.center.y - center[1]} r={boundary.radius} />
                : <path d={cadArcSvgPath(boundary, center)} />}
          </g>;
        })}
        {profiles.map((profile) => <g key={profile.id} role="button" aria-label={`Select ${profile.name} profile`} aria-pressed={profile.id === selectedProfileId && detailSelection.kind === 'profile'} transform={dragPreview?.profile.id === profile.id && !dragPreview.handle ? `translate(${dragPreview.translation[0]} ${dragPreview.translation[1]})` : undefined} tabIndex={tool === 'select' && pickFilter === 'auto' && !interactionLocked ? 0 : -1} data-cad-parameter-highlight={inspection?.profileIds.includes(profile.id) ? profile.id : undefined} data-cad-drawing-snap-profile={snapProfile?.id === profile.id ? profile.id : undefined}
          className={`cad-profile ${profile.construction ? 'is-construction' : ''} ${profile.id === selectedProfileId && detailSelection.kind === 'profile' ? 'is-selected' : ''} ${inspection?.profileIds.includes(profile.id) ? 'is-parameter-highlighted' : ''} ${snapProfile?.id === profile.id ? 'cad-sketch-entity is-pick-highlighted' : ''}`} strokeDasharray={profile.construction ? `${span / 80} ${span / 120}` : undefined} onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && tool === 'select' && pickFilter === 'auto' && !interactionLocked) { event.preventDefault(); event.stopPropagation(); setActiveHandle(null); onSelectProfile(profile.id); } }} onClick={(event) => { if (event.detail === 0 && event.button === 0 && tool === 'select' && pickFilter === 'auto' && !interactionLocked) { event.stopPropagation(); setActiveHandle(null); onSelectProfile(profile.id); } }}><CadSketchProfileGeometry geometry={dragPreview?.handle && dragPreview.profile.id === profile.id ? dragPreview.profile.geometry : profile.geometry} parameters={parameters} viewCenter={center} /></g>)}
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
          filter={pickFilter} highlighted={snapHighlight ?? pickHighlight} pickAt={event => { const point = getRawPoint(event), rect = svg.current?.getBoundingClientRect(); return point && rect?.height ? sourceGraph.pick(point, span / rect.height, pickFilter)[0] ?? null : null; }}
          locked={externalInteractionLocked || submission.applying || points.length > 0 || pathPending || dragPreview !== null || boxPending || overlapPending || choicePending} cancelSignal={cancelSignal} onPendingChange={publishGraphPending} onError={onError} />}
        {currentOverlap?.action === 'split' && currentOverlap.split?.kind === 'ready' && <CadSketchSplitPreview preview={currentOverlap.split} center={center} mmPerPixel={span / (viewportSize.height || 600)} />}
        {currentOverlap?.action === 'trim' && currentOverlap.trim?.kind === 'ready' && <CadSketchTrimPreview preview={currentOverlap.trim} center={center} mmPerPixel={span / (viewportSize.height || 600)} />}
        {currentOverlap?.action === 'extend' && activeExtend?.kind === 'ready' && <CadSketchExtendPreview preview={activeExtend} center={center} mmPerPixel={span / (viewportSize.height || 600)} />}
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
        {snapHint && viewportSize.height > 0 && <CadSketchSnapHint candidate={snapHint} center={center} scaleX={width / viewportSize.width} scaleY={span / viewportSize.height} label={snapLabel} />}
        {currentSnapChoice && choiceHighlight && <g pointerEvents="none" aria-hidden="true">
          {sourceGraph?.geometry.segments.filter(segment => choiceHighlight.entityIds.includes(segment.id)).map(segment => {
            const boundary = cadSketchGraphBoundary(segment);
            return <g key={segment.id} data-cad-drawing-snap-owner={segment.id} className="cad-profile cad-sketch-entity is-pick-highlighted" fill="none">
              {boundary.type === 'line' ? <line x1={boundary.start.x - center[0]} y1={boundary.start.y - center[1]} x2={boundary.end.x - center[0]} y2={boundary.end.y - center[1]} />
                : boundary.type === 'circle' ? <circle cx={boundary.center.x - center[0]} cy={boundary.center.y - center[1]} r={boundary.radius} />
                  : <path d={cadArcSvgPath(boundary, center)} />}</g>;
          })}
          <CadSketchSnapHint candidate={choiceHighlight} center={center} scaleX={width / (viewportSize.width || 800)} scaleY={span / (viewportSize.height || 600)}
            label={choiceHighlight.target.kind === 'profile-position' ? `${cadSketchProfileSnapLabel(choiceHighlight.target, sourceProfiles)} · Position only · No relation`
              : choicePointId === undefined ? 'Choose midpoint' : `Choose Point ${(sourceGraph?.graph.points.findIndex(point => point.id === choicePointId) ?? -1) + 1}`} />
        </g>}
        {points.map(([x, y], index) => <circle key={index} cx={x - center[0]} cy={y - center[1]} r={span / 170} className="cad-sketch-vertex" />)}
        {picks.filter(pick => pick.kind === 'coincident').map(pick => <circle key={pick.relationId} data-cad-sketch-attachment={pick.sourcePointId}
          cx={pick.point[0] - center[0]} cy={pick.point[1] - center[1]} r={6 * span / (viewportSize.height || 600)} className="cad-sketch-snap-target"><title>Pending coincidence with Point {(sourceGraph?.graph.points.findIndex(point => point.id === pick.sourcePointId) ?? -1) + 1}</title></circle>)}
        {tool !== 'select' && <g className="cad-crosshair"><path d={`M ${cursor[0] - center[0] - span / 70} ${cursor[1] - center[1]} h ${span / 35} M ${cursor[0] - center[0]} ${cursor[1] - center[1] - span / 70} v ${span / 35}`} /></g>}
      </g>
      {boxSelection.box && <rect className={`cad-sketch-selection-box is-${boxSelection.box.mode}`} pointerEvents="none"
        x={Math.min(boxSelection.box.start[0], boxSelection.box.end[0]) - center[0]} y={center[1] - Math.max(boxSelection.box.start[1], boxSelection.box.end[1])}
        width={Math.abs(boxSelection.box.end[0] - boxSelection.box.start[0])} height={Math.abs(boxSelection.box.end[1] - boxSelection.box.start[1])} />}
    </svg>
    {currentSnapChoice && <CadSketchSnapChooser anchor={{ x: currentSnapChoice.clientX, y: currentSnapChoice.clientY }} candidates={currentSnapChoice.candidates} graph={sourceGraph?.graph} profiles={sourceProfiles}
      onClose={closeSnapChoice} onHighlight={candidate => { if (choiceIsCurrent(currentSnapChoice)) setChoiceHighlight(candidate); }}
      onChoose={candidate => { if (choiceIsCurrent(currentSnapChoice)) placeChosen.current(candidate); }}
      onOutsidePointerDown={event => { suppressProfileClick.current = true; event.preventDefault(); event.stopPropagation(); }} />}
    {currentOverlap && <CadContextMenu anchor={{ x: currentOverlap.clientX + (currentOverlap.target ? 12 : 0), y: currentOverlap.clientY + (currentOverlap.target ? 12 : 0) }} title={currentOverlap.target ? 'Sketch edge' : 'Select other'} items={overlapItems} onClose={closeOverlap}
      onOutsidePointerDown={event => { event.preventDefault(); event.stopPropagation(); suppressProfileClick.current = true; }} />}
    {dimensionControls && sketch.kind === 'sketch' && dimensionProfile && dimensionAnchor && tool === 'select' && !isPreview && <CadSketchDimensionControls {...dimensionControls} interactionLocked={dimensionControls.interactionLocked || submission.applying || dragPreview !== null} sketch={sketch} profile={dimensionProfile} parameters={parameters} anchor={dimensionAnchor} project={point => ({ x: (point[0] - center[0]) / width * viewportSize.width + viewportSize.width / 2, y: (center[1] - point[1]) / span * viewportSize.height + viewportSize.height / 2 })} cancelSignal={cancelSignal} />}
    {isPreview && <div className="cad-sketch-context" role="status">Preview · Apply to keep changes</div>}
    {!isPreview && inspection && inspection.profileIds.length > 0 && <div className="cad-sketch-context" role="status">Highlighted geometry · {inspection.profileIds.length} {inspection.profileIds.length === 1 ? 'profile' : 'profiles'}</div>}
    <p id={instructionsId} className="cad-sr-only">{interactionLocked ? 'Drawing is paused while another edit or operation is active.' : instruction} Keyboard: arrow keys move the cursor, Shift moves ten grid steps, Space adds a point, Enter accepts an arc through-point or closes a ready path or polyline, Backspace undoes the last point or segment, Escape cancels drawing, F fits the sketch.</p>
    <CadViewTools label="Sketch controls">{sketch.kind === 'sketch' && <Select aria-label="Sketch selection filter" title="Auto includes points, edges and profiles. Points or Edges restrict direct picking and box selection; Shift toggles selection." density="compact" value={pickFilter} disabled={viewLocked || interactionLocked} onChange={event => setPickFilter(event.target.value as CadSketchGraphPickFilter)}><option value="auto">Auto</option><option value="points">Points</option><option value="edges">Edges</option></Select>}<span className="cad-plane-label">{placementLabel ?? (typeof sketch.plane === 'string' ? sketch.plane : 'Datum plane')}</span><Button aria-label={sketch.kind === 'curve' ? 'Fit curve' : 'Fit sketch'} disabled={viewLocked} onClick={fit}><FitViewIcon size={14} /></Button><Button aria-label="Toggle sketch grid" disabled={viewLocked} aria-pressed={grid} onClick={() => setGrid(!grid)}><GridIcon size={14} /></Button><Button aria-label="Toggle snapping" title="Snap to grid, endpoints, centers and midpoints. Hold Ctrl or Cmd to temporarily disable snapping." disabled={viewLocked} aria-pressed={snap} onClick={() => setSnap(!snap)}><SnapIcon size={14} /></Button><label className="cad-grid-step">Grid <Input aria-label="Grid spacing" disabled={viewLocked} type="number" min="0.01" value={gridStep} onChange={(event) => { const value = Number(event.target.value); if (value > 0 && Number.isFinite(value)) setGridStep(value); }} /> mm</label><CadContextHelp label="Sketch navigation">{navigationMode === 'trackpad' ? 'Use two-finger scrolling to pan and pinch to zoom.' : 'Drag with the right mouse button to pan and use the wheel to zoom.'} Press F to fit the sketch and Escape to cancel unfinished drawing.</CadContextHelp></CadViewTools>
    {!externalInteractionLocked && (tool !== 'select' || points.length > 0) && <CadDrawingTools active={points.length > 0 || pathPending}><div className={`cad-sketch-instruction ${tool === 'path' ? 'cad-path-instruction' : ''}`} onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'Escape' && submission.applying) { event.preventDefault(); event.stopPropagation(); cancelDrawing(); svg.current?.focus(); return; }
      if (tool !== 'path' || !pathPending || interactionLocked || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Backspace' || event.key === 'Escape') { event.preventDefault(); changePath({ kind: event.key === 'Backspace' ? 'undo-last' : 'cancel' }, true); }
    }}><span>{instruction}</span>
      {canInfer && <label className="cad-check"><Input type="checkbox" aria-label="Create coincident relations" checked={inferCoincidence} disabled={interactionLocked}
        title="Attach future snapped endpoints or centers with removable coincidence relations. Switching off releases pending attachments; accepted geometry is unchanged. Path uses its own shared-point joins."
        onChange={event => { const enabled = event.target.checked; setInferCoincidence(enabled); if (!enabled) setPicks(current => current.map(pick => ({ kind: 'position', point: pick.point }))); }} />Create relations</label>}
      {picks.some(pick => pick.kind === 'coincident') && <span aria-label="Pending coincident relations">{picks.filter(pick => pick.kind === 'coincident').length} attached</span>}
      {tool === 'path' && <>
        <div className="cad-path-modes" role="group" aria-label="Path segment mode"><Button disabled={interactionLocked || pathDraft.kind === 'arc-through'} aria-pressed={pathMode === 'line'} onClick={() => changePath({ kind: 'mode', mode: 'line' }, true)}>Line</Button><Button disabled={interactionLocked || pathDraft.kind === 'arc-through'} aria-pressed={pathMode === 'arc'} onClick={() => changePath({ kind: 'mode', mode: 'arc' }, true)}>3-point Arc</Button></div>
        {pathPending && <>{sketch.kind === 'sketch' && onAddPath && <Button aria-label="Finish path" title="Keep this path open without adding a closing edge" disabled={interactionLocked || pathDraft.kind !== 'ready' || !pathDraft.segments.length} onClick={() => finishPath(false)}><ConfirmIcon size={13} /> Finish path</Button>}<Button aria-label={sketch.kind === 'curve' ? 'Finish curve' : 'Close profile'} title={sketch.kind === 'curve' ? 'Validate and save the open curve without a closing edge' : pathNeedsClosingLine ? 'Close the profile by adding a straight line to its start' : 'Validate and save the closed profile'} disabled={interactionLocked || pathDraft.kind !== 'ready' || !pathDraft.segments.length} onClick={() => finishPath(true)}><ConfirmIcon size={13} />{sketch.kind === 'curve' ? 'Finish curve' : pathNeedsClosingLine ? 'Close with line' : 'Close profile'}</Button><Button disabled={interactionLocked} onClick={() => changePath({ kind: 'undo-last' }, true)}><UndoIcon size={13} /> Undo last</Button><Button onClick={() => changePath({ kind: 'cancel' }, true)}><CloseIcon size={13} /> Cancel drawing</Button></>}
      </>}
      {tool === 'polygon' && points.length >= 3 && <Button disabled={interactionLocked} onClick={close}><ConfirmIcon size={13} /> Close profile</Button>}{points.length > 0 && <Button onClick={cancelDrawing}><CloseIcon size={13} /> Cancel drawing</Button>}</div></CadDrawingTools>}
    <div className="cad-view-caption">{formatCadQuantity(cursor[0])}, {formatCadQuantity(cursor[1])} mm</div>
  </div>;
}
