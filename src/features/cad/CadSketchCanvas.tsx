import { userFacingMessage } from '@/lib/userMessage';
import { flushSync } from 'react-dom';
import { cadSketchLinearPatternForSelection } from '@/domain/cad/cadSketchLinearPattern';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CloseIcon, ConfirmIcon, FitViewIcon, GridIcon, SnapIcon, UndoIcon } from '@wire-edm/icons-react';
import { CadContextHelp } from './CadContextHelp';
import { CadDrawingTools, CadViewTools } from './CadCommandDock';
import type { CadCurveFeature, CadPathSegment, CadProfile, CadSketchFeature, CadSketchProfile } from '@/domain/cad/cadDocument';
import { resolveCadCurveGeometry } from '@/domain/cad/cadCurve';
import { captureSvgPreview } from '@/features/editor/captureEditorPreview';
import { ToolError } from '@/features/webmcp/siteTools';
import type { CadRenderedViewControls, CadRenderedViewState } from './cadViewportControls';
import { DRAG_GRID_CATCH_PIXELS, magnetSketchPoint, slotSketchProfile, slotSketchWidth, snapSketchPoint, twoPointSketchProfile, type SketchPoint, type SketchTool } from './cadSketchInteraction';
import { CadSketchProfileGeometry } from './CadSketchProfileGeometry';
import { createCadSketchHandlePicker, createCadSketchProfilePicker, type CadSketchHandlePick } from './cadSketchPicking';
import { cadPathDraftEndpoint, cadPathDraftPicks, closeCadPolylineProfile, createCadPathDraft, finishCadCurveDraft, previewCadPathDraft, releaseCadPathDraftPicks, updateCadPathDraft, type CadPathDraft, type CadPathDrawingAction } from './cadPathDrawing';
import { cadSketchDrawingInference, cadSketchDrawingInferenceLabel, cadSketchSnapRelation, cadSketchSnapTargetLabel, prepareCadSketchGeometrySnaps, type CadSketchSnapCandidate } from './cadSketchGeometrySnaps';
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
import { formatCadLocalizedQuantity, formatCadQuantity } from './cadDisplayQuantity';
import { prepareCadSketchGraphInteraction } from './cadSketchGraphInteraction';
import { cadSketchExternalReferenceForSelection } from '@/domain/cad/cadSketchExternalReferences';
import { CadSketchLinearPatternPreview } from './CadSketchLinearPatternPreview';
import { CadSketchGraphLayer, type CadSketchGraphControls } from './CadSketchGraphLayer';
import { cadSketchGraphBoundary } from '@/domain/cad/compileCadSketchGeometry';
import { cadArcSvgPath } from './cadSketchSvg';
import { useCadEditSubmission, type CadEditCompletion } from './useCadEditSubmission';
import { useCadSketchBoxSelection } from './useCadSketchBoxSelection';
import { CAD_SKETCH_AXIS_PIXELS, CAD_SKETCH_DATUMS, cadSketchDatumLabels, cadSketchRelationDatum, cadSketchGeometryPickAllows, cadSketchGraphSelectionsEqual, pickCadSketchDatum, type CadSketchDatum, type CadSketchGraphPickFilter } from './cadSketchGraphSelection';
import { CadContextMenu, type CadContextMenuItem } from './CadContextMenu';
import type { CadSketchGraphSelection } from './cadSketchGraphSelection';
import { cadFreshSketchDatumAxes, type CadFreshSketchDrawing, type CadFreshSketchPick } from '@/domain/cad/cadFreshSketchGraph';
import { CadSketchSplitPreview, prepareCadSketchSplitPreview, type CadSketchSplitPreview as SplitPreview } from './CadSketchSplitPreview';
import { CadSketchTrimPreview, prepareCadSketchTrimPreview, type CadSketchTrimPreview as TrimPreview,
  CadSketchExtendPreview, prepareCadSketchExtendPreview, prepareCadSketchExtendEndPreview, type CadSketchExtendPreview as ExtendPreview } from './CadSketchBoundaryPreview';

const NO_PROFILES: readonly CadSketchProfile[] = Object.freeze([]);
const snapDraftStart = prepareCadSketchGeometrySnaps();
/** Snap targets that place a point along a curve or guide rather than at a point of its own. */
const SNAP_PLACEMENTS: ReadonlySet<CadSketchSnapCandidate['target']['kind']> = new Set(['on-entity', 'on-axis', 'aligned']);
const ACQUIRED_POINTS = 4;
/** A drawing press that travels farther than this is a drag, and a press this close to the last placed point grabs it. */
const DRAWING_DRAG_PIXELS = 8;
/** The plane references each selection filter reaches: the origin counts as a point and the axes as edges. */
const CAD_SKETCH_FILTER_DATUMS: Readonly<Record<CadSketchGraphPickFilter, readonly CadSketchDatum[]>> = { auto: CAD_SKETCH_DATUMS, points: ['origin'], edges: ['x-axis', 'y-axis'] };
/** Picks whose relations name source geometry, so the source must not change while they are pending. */
const referencesSource = (pick: CadFreshSketchPick) => pick.kind === 'coincident' || pick.kind === 'on-line' || pick.kind === 'on-curve';
type DrawingPick = { readonly point: SketchPoint } & (
  | { readonly candidates: readonly CadSketchSnapCandidate[]; readonly candidate?: never }
  | { readonly candidate?: CadSketchSnapCandidate; readonly candidates?: never }
);
/** A polyline click that returns to its start closes it once the closed chain can bound an area. */
function closesCadPolyline(draft: CadPathDraft): boolean {
  if (draft.kind !== 'ready' || draft.segments.length < 2) return false;
  const end = cadPathDraftEndpoint(draft);
  return end[0] === draft.start[0] && end[1] === draft.start[1] && (draft.segments.length > 2 || draft.segments.some(segment => segment.kind === 'arc'));
}
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
  readonly selection: readonly CadSketchGraphSelection[];
  readonly geometryPick?: CadSketchGraphControls['geometryPick'];
  readonly split?: SplitPreview;
  readonly trim?: TrimPreview;
  readonly extend?: ExtendPreview;
  readonly extendEnds?: readonly { readonly end: 'start' | 'end'; readonly preview: ExtendPreview }[];
  readonly extendEnd?: 'start' | 'end';
  readonly action?: 'split' | 'trim' | 'extend';
}

/**
 * The stretches of `[from, to]` more than `half` from `at`. The grid fills these, leaving out its zero lines, which the axes
 * draw over; half a grid step clears the zero line and keeps both neighbours.
 */
function gridBands(from: number, to: number, at: number, half: number): readonly (readonly [number, number])[] {
  return ([[from, Math.min(to, at - half)], [Math.max(from, at + half), to]] as const).filter(([start, end]) => end > start);
}

/**
 * CATIA-style H and V axes: thin lines through the sketch origin across the whole view, with fixed-size arrows naming each
 * direction. The view box spans `[-width / 2, width / 2]` across and `[-height / 2, height / 2]` down, in SVG units.
 */
function CadSketchAxes({ origin: [x, y], pixel, view: [width, height], datumProps }: { readonly origin: SketchPoint; readonly pixel: number; readonly view: SketchPoint;
  readonly datumProps: (datum: CadSketchDatum, className: string, onScreen: boolean) => Record<string, unknown> }) {
  const length = CAD_SKETCH_AXIS_PIXELS * pixel, head = 6 * pixel, text = 10 * pixel, ring = 4 * pixel;
  const left = -width / 2, right = width / 2, top = -height / 2, bottom = height / 2;
  // Datums panned out of view stay drawn but leave the keyboard order, so Tab and Enter never reach unseen operands.
  const originShown = x + ring >= left && x - ring <= right && y + ring >= top && y - ring <= bottom;
  return <g className="cad-sketch-axes">
    <g {...datumProps('x-axis', 'cad-axis-x', y >= top && y <= bottom)}>
      <line className="cad-sketch-axis-line" x1={left} y1={y} x2={right} y2={y} strokeWidth={pixel} />
      <path d={`M ${x} ${y} h ${length} m ${-head} ${-head / 2} l ${head} ${head / 2} l ${-head} ${head / 2}`} strokeWidth={pixel * 1.5} />
    </g>
    <g {...datumProps('y-axis', 'cad-axis-y', x >= left && x <= right)}>
      <line className="cad-sketch-axis-line" x1={x} y1={top} x2={x} y2={bottom} strokeWidth={pixel} />
      <path d={`M ${x} ${y} v ${-length} m ${-head / 2} ${head} l ${head / 2} ${-head} l ${head / 2} ${head}`} strokeWidth={pixel * 1.5} />
    </g>
    <circle cx={x} cy={y} r={ring} strokeWidth={pixel * 1.5} {...datumProps('origin', 'cad-sketch-origin', originShown)} />
    <text className="cad-sketch-axis-label" x={x + length + 3 * pixel} y={y + text / 3} fontSize={text} aria-hidden>H</text>
    <text className="cad-sketch-axis-label" x={x - text / 3} y={y - length - 3 * pixel} fontSize={text} aria-hidden>V</text>
  </g>;
}

export function CadSketchCanvas({ sketch: sourceSketch, parameters, documentVersion, placementLabel, tool, selectedProfileId, onSelectProfile, onAddProfile, onAddFreshSketch, onAddPath, onTranslateProfile, onMoveHandle, onAddCurve, onCancelCurve, curveCreation = false, onPendingChange, onError, cancelSignal, interactionLocked: externalInteractionLocked = false, onControlsReady, viewLocked = false, navigationMode = 'mouse', onContextMenu, graphContextMenu, previewProfile, previewSketch, graphControls, inspection, dimensionControls, getFitArea }: {
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
  graphContextMenu?(selection: readonly CadSketchGraphSelection[]): readonly CadContextMenuItem[];
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
  /** Select and Trim pick existing geometry; every other tool places new points. */
  const drawing = tool !== 'select' && tool !== 'trim';
  /** Line and Arc draw one segment of the Polyline draft and save it at once. */
  const singleSegment = tool === 'line' || tool === 'arc';
  const pathTool = tool === 'path' || singleSegment;
  const idlePathDraft = () => createCadPathDraft(tool === 'arc' ? 'arc' : 'line');
  const svg = useRef<SVGSVGElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const instructionsId = useId();
  const [picks, setPicks] = useState<readonly CadFreshSketchPick[]>([]);
  const points = useMemo(() => picks.map(pick => pick.point), [picks]);
  const [inferCoincidence, setInferCoincidence] = useState(true);
  const [pathDraft, setPathDraft] = useState(createCadPathDraft);
  const [cursorInput, setCursorInput] = useState<DrawingCursor>({ point: [0, 0], mode: 'position', suppressed: false });
  const [center, setCenter] = useState<SketchPoint>([0, 0]);
  const [span, setSpan] = useState(160);
  const [aspect, setAspect] = useState(1.3);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const measuredAspect = useRef(aspect);
  const [snap, setSnap] = useState(true);
  // Sketching is free by default. The grid is a visual reference; snapping to it is an opt-in magnet.
  const [gridSnap, setGridSnap] = useState(false);
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
  const [datumHover, setDatumHover] = useState<CadSketchDatum | null>(null);
  // Points the pointer rested on while drawing; each one offers horizontal and vertical guides.
  const acquired = useRef<readonly SketchPoint[]>([]);
  // Trim previews the edge piece under the cursor against the exact accepted graph; a click removes it and Trim stays active.
  const [trimHover, setTrimHover] = useState<{ readonly prepared: CadSketchOverlapPick['prepared']; readonly preview: TrimPreview } | null>(null);
  const suppressProfileClick = useRef(false);
  /**
   * A primary press while drawing. The press places its pick at once; a drag past the slop then places the next pick on
   * release, so press-drag-release draws like two clicks. A press beside the last placed point is held until release:
   * a drag draws from that point, and a plain click places it then. `changes` is the draft change the press left.
   */
  const drawingPress = useRef<{ readonly pointerId: number; readonly clientX: number; readonly clientY: number; changes: number;
    readonly held: { readonly last: SketchPoint; readonly raw: SketchPoint; readonly scale: SketchPoint } | null; dragged: boolean } | null>(null);
  /**
   * A plain-selection press on the origin or an axis. It selects the reference on release, so a press that travels past the
   * drag slop first still boxes or moves a profile exactly as it would away from the axes.
   */
  const datumPress = useRef<{ readonly pointerId: number; readonly clientX: number; readonly clientY: number; readonly datum: CadSketchDatum; readonly additive: boolean; readonly documentVersion: string | undefined; readonly sketchId: string; readonly cancelSignal: number; readonly frame: string } | null>(null);
  // An abandoned press still ends in the browser's click, which must not select or clear what lies under it.
  const dropDatumPress = useCallback(() => { if (!datumPress.current) return; datumPress.current = null; suppressProfileClick.current = true; }, []);
  /**
   * Counts drawing draft changes and whether the latest one added a point. A press keeps its release only while its own
   * change is the latest, so a finished, rejected or ambiguous pick, or a cancel or keyboard pick during the press, ends it.
   */
  const draftChanges = useRef({ count: 0, added: false });
  const noteDraftChange = (added: boolean) => { draftChanges.current = { count: draftChanges.current.count + 1, added }; };
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
    // Losing the window ends a press on the origin or an axis without selecting it, as it ends a profile drag.
    const blurred = () => { dropDatumPress(); finishProfileDrag(); };
    window.addEventListener('blur', blurred);
    return () => { window.removeEventListener('blur', blurred); dropDatumPress(); finishProfileDrag(); };
  }, [dropDatumPress, finishProfileDrag]);
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
  const pendingPicks = useMemo(() => pathTool ? cadPathDraftPicks(pathDraft) : picks.filter(pick => pick.kind !== 'position'), [pathTool, pathDraft, picks]);
  useLayoutEffect(() => { if (!pendingPicks.some(referencesSource)) attachedSource.current = null; }, [pendingPicks]);
  const attachedSourceCurrent = () => {
    const owned = attachedSource.current;
    if (!owned || owned.sketch === sourceSketch && owned.version === documentVersion && owned.parameters === graphSourceParameters && owned.document === graphControls?.document) return true;
    onError('The sketch changed. Cancel this drawing or release its pending relations before continuing.');
    return false;
  };
  const sourceGraph = useMemo(() => sourceSketch.kind === 'sketch' && sourceSketch.graph ? prepareCadSketchGraphInteraction(sourceSketch.graph, graphSourceParameters) : null, [sourceSketch, graphSourceParameters]);
  const geometryPick = graphControls?.geometryPick;
  const positionPick = graphControls?.positionPick;
  const placement = graphControls?.placement;
  const placementAngle = placement ? `${placement.angleDegrees > 0 ? '+' : ''}${formatCadQuantity(placement.angleDegrees)}°` : '';
  const graphPickFilter = geometryPick
    ? geometryPick.eligiblePointIds.length ? geometryPick.eligibleEntityIds.length ? 'auto' : 'points' : 'edges'
    : pickFilter;
  const graphPicks = (point: SketchPoint, millimetersPerPixel: number) => {
    const hits = sourceGraph?.pick(point, millimetersPerPixel, graphPickFilter) ?? [];
    return geometryPick ? hits.filter(hit => cadSketchGeometryPickAllows(geometryPick, hit)) : hits;
  };
  // The plane origin and axes join a pick only when its owner accepts them.
  const datumPick = geometryPick?.onPickDatum && geometryPick.eligibleDatums?.length ? geometryPick : undefined;
  // In plain selection the origin and axes are selected like sketch geometry, as CATIA selects its H and V axes.
  const datumSelect = !geometryPick && !positionPick && tool === 'select' && graphControls?.onSelectDatum ? graphControls : undefined;
  const datumEligible = datumPick?.eligibleDatums ?? (datumSelect ? CAD_SKETCH_FILTER_DATUMS[pickFilter] : undefined);
  const datumAt = (point: SketchPoint, millimetersPerPixel: number) => datumEligible ? pickCadSketchDatum(point, millimetersPerPixel, datumEligible) : null;
  /**
   * Sketch geometry, profile grips and profile edges keep their picks where an axis crosses them; the axes take the rest of
   * their length. `covered` is what the caller already found under the pointer, so the reference test runs only when that
   * hit test found nothing, and only a pointer within reach of a reference measures the profile edges near it.
   */
  const datumUnder = (point: SketchPoint, millimetersPerPixel: number, covered: boolean) => {
    const datum = covered ? null : datumAt(point, millimetersPerPixel);
    return datum && datumSelect && pickFilter === 'auto' && profilePicker.edgeNear(point, millimetersPerPixel) ? null : datum;
  };
  const chooseDatum = (datum: CadSketchDatum, additive: boolean) => { if (datumPick) datumPick.onPickDatum?.(datum); else datumSelect?.onSelectDatum?.(datum, additive); };
  const selectGraphHit = (hit: CadSketchGraphSelection, additive = false) => {
    if (geometryPick) { if (cadSketchGeometryPickAllows(geometryPick, hit)) geometryPick.onPick(hit); }
    else graphControls?.onSelect(hit, additive);
  };
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
  useLayoutEffect(() => { dropDatumPress(); finishProfileDrag(); }, [documentVersion, sketch, parameters, tool, interactionLocked, cancelSignal, previewProfile, center, span, aspect, snap, gridSnap, gridStep, navigationMode, dropDatumPress, finishProfileDrag]);
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
  const drawingCandidate = (candidate: CadSketchSnapCandidate): DrawingPick => ({ point: candidate.point, candidate });
  const resolveDrawingPick = (raw: SketchPoint, suppressed: boolean, mode: DrawingCursor['mode'], mmPerPixel: SketchPoint = [width / viewportSize.width, span / viewportSize.height]): DrawingPick => {
    if (suppressed || mode === 'position') return { point: raw };
    const draftStart = !positionPick && tool === 'path' && pathDraft.kind === 'ready' ? { point: pathDraft.start } : undefined;
    if (drawing || positionPick) {
      if (draftStart && pathDraft.kind === 'ready' && pathDraft.segments.length) {
        // Returning to the polyline's own start is explicit closing intent,
        // independent of other saved points at that same position.
        const closure = snapDraftStart({ cursor: raw, mmPerPixel, draftStart });
        if (closure.kind === 'hit') return { point: closure.candidate.point, candidate: closure.candidate };
      }
      const result = (snap ? drawingSnaps : snapDraftStart)({ cursor: raw, mmPerPixel, draftStart, references: snap, alignTo: snap ? alignSources() : undefined });
      if (result.kind === 'ambiguous') return { point: raw, candidates: result.candidates };
      // A grid the user asked to snap to outranks positions along a curve or guide, never a point.
      if (result.kind === 'hit' && !(gridSnap && SNAP_PLACEMENTS.has(result.candidate.target.kind) && gridNode(raw, mmPerPixel))) return drawingCandidate(result.candidate);
    }
    return { point: gridNode(raw, mmPerPixel) ?? raw };
  };
  const gridNode = (raw: SketchPoint, mmPerPixel: SketchPoint): SketchPoint | null => {
    const point = magnetSketchPoint(raw, gridStep, gridSnap, DRAG_GRID_CATCH_PIXELS * Math.max(mmPerPixel[0], mmPerPixel[1]));
    return point === raw ? null : point;
  };
  // Inference guides start from the drawing's own placed points and the points the pointer recently rested on.
  const alignSources = (): readonly SketchPoint[] => {
    const own = positionPick ? [] : pathTool ? pathDraft.kind === 'idle' ? [] : [pathDraft.start, ...pathDraft.segments.map(segment => segment.end), ...(pathDraft.kind === 'arc-through' ? [pathDraft.end] : [])]
      // A rectangle's own first corner would only offer a zero-height or zero-width rectangle.
      : tool === 'rectangle' ? [] : points;
    return [...own, ...acquired.current];
  };
  const cursorPick = resolveDrawingPick(cursorInput.point, cursorInput.suppressed, cursorInput.mode);
  const cursor = cursorPick.point;
  const snapHint = (drawing || positionPick) && !interactionLocked ? cursorPick.candidate : undefined;
  // Snapped picks can become relations only where the drawing is saved as connected edges.
  const graphDrawing = sourceSketch.kind === 'sketch' && (pathTool ? Boolean(onAddPath) : (tool === 'rectangle' || tool === 'circle' || tool === 'slot') && Boolean(onAddFreshSketch));
  const canInfer = !positionPick && graphDrawing;
  // A circle's radius, a slot's width and an arc's through point only shape the drawing.
  const inferring = canInfer && inferCoincidence && !(tool === 'circle' && picks.length) && !(tool === 'slot' && picks.length > 1) && !(pathTool && pathDraft.kind === 'arc-through');
  const inferencePoint = inferring && snapHint && 'pointId' in snapHint.target ? snapHint.target.pointId : undefined;
  const inferenceRelation = inferring && snapHint ? cadSketchSnapRelation(snapHint.target) : null;
  // A line ending on its own start's guide keeps that relation; a return to the chain start closes it instead.
  const lineInference = (candidate: CadSketchSnapCandidate | undefined, point: SketchPoint) => inferring && pathTool && pathDraft.kind === 'ready' && pathDraft.mode === 'line'
    && candidate && (point[0] !== pathDraft.start[0] || point[1] !== pathDraft.start[1]) ? cadSketchDrawingInference(candidate.target, cadPathDraftEndpoint(pathDraft), point) : null;
  const inferredAxis = snapHint ? lineInference(snapHint, snapHint.point) : null;
  const snapLabel = inferencePoint ? `Coincident with Point ${(sourceGraph?.graph.points.findIndex(point => point.id === inferencePoint) ?? -1) + 1}`
    : snapHint ? snapHint.target.kind === 'profile-position' ? `${cadSketchProfileSnapLabel(snapHint.target, sourceProfiles)} · Position only · No relation`
    : snapHint.target.kind === 'draft-start' ? sketch.kind === 'curve' ? 'Curve start'
      : pathDraft.kind === 'ready' && pathDraft.segments.length > (pathDraft.mode === 'line' ? 1 : 0) ? 'Close polyline' : 'Polyline start'
    : 'pointId' in snapHint.target || snapHint.target.kind === 'midpoint' ? `${snapHint.target.kind[0].toUpperCase()}${snapHint.target.kind.slice(1)} position · No relation`
    : inferredAxis ? cadSketchDrawingInferenceLabel(snapHint.target, inferredAxis)
    : `${cadSketchSnapTargetLabel(snapHint.target)} · ${inferenceRelation ?? 'No relation'}` : '';
  const snapHighlight: CadSketchGraphSelection | null = snapHint && 'pointId' in snapHint.target ? { kind: 'point', id: snapHint.target.pointId }
    : snapHint && 'entityId' in snapHint.target ? { kind: 'entity', id: snapHint.target.entityId } : null;
  // The graph layer is memoized: its highlight keeps its identity while the cursor stays on the same target.
  const highlightKind = (snapHighlight ?? pickHighlight)?.kind, highlightId = (snapHighlight ?? pickHighlight)?.id;
  const graphHighlight = useMemo((): CadSketchGraphSelection | null => highlightKind && highlightId !== undefined ? { kind: highlightKind, id: highlightId } : null, [highlightKind, highlightId]);
  useEffect(() => {
    if (!drawing && !positionPick) return;
    const modifiers = (event: KeyboardEvent) => {
      if (event.isComposing || event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      setCursorInput(current => current.suppressed === (event.ctrlKey || event.metaKey) ? current : { ...current, suppressed: event.ctrlKey || event.metaKey });
    };
    const blur = () => setCursorInput(current => ({ ...current, mode: 'position', suppressed: false }));
    window.addEventListener('keydown', modifiers); window.addEventListener('keyup', modifiers); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', modifiers); window.removeEventListener('keyup', modifiers); window.removeEventListener('blur', blur); };
  }, [tool, positionPick]);
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
  const viewSignature = JSON.stringify([sketch.plane, center, span, aspect, grid, snap, gridSnap, gridStep, pickFilter, boxPending, graphPending, pickHighlight, choicePending,
    choiceHighlight ? [choiceHighlight.target, choiceHighlight.point, choiceHighlight.entityIds] : null,
    overlap ? [overlap.clientX, overlap.clientY, overlap.target, overlap.split, overlap.trim, overlap.extend, overlap.extendEnds, overlap.extendEnd, overlap.action] : null, drawing || positionPick ? [cursor, picks, pathDraft] : null, tool === 'trim' ? trimHover?.preview : null,
    snapHint ? [snapHint.target, snapHint.point, snapLabel] : null, previewProfile?.geometry, previewSketch ? [previewSketch.profiles, previewSketch.graph] : null,
    graphControls ? [graphControls.selection, graphControls.relation, graphControls.inspection, graphControls.degreesOfFreedom, graphControls.showDimensions, placement] : null, inspection, dragPreview?.translation]);
  if (viewRevision.current.signature !== viewSignature) { viewRevision.current = { signature: viewSignature, revision: viewRevision.current.revision + 1 }; }
  const currentView = useRef<CadRenderedViewState>({ mode: sketch.kind, available: false, plane: renderedPlane, gridVisible: grid, snapEnabled: snap, gridSnapEnabled: gridSnap, gridStepMm: gridStep, centerMm: center, heightSpanMm: span, revision: viewRevision.current.revision });
  currentView.current = Object.freeze({ mode: sketch.kind, available: Boolean(svg.current), plane: renderedPlane, gridVisible: grid, snapEnabled: snap, gridSnapEnabled: gridSnap, gridStepMm: gridStep, centerMm: Object.freeze([...center] satisfies [number, number]), heightSpanMm: span, revision: viewRevision.current.revision, ...(sketch.kind === 'sketch' ? { sketchPickFilter: pickFilter } : {}) });
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
  useEffect(() => { setPicks([]); setPathDraft(createCadPathDraft(tool === 'arc' ? 'arc' : 'line')); setTrimHover(null); }, [sketch.id, tool, cancelSignal]);
  useLayoutEffect(() => { setCursorInput(current => ({ ...current, mode: 'position' })); }, [sourceSketch, graphSourceParameters, tool, cancelSignal, center, span, aspect]);
  // Acquired points are positions, so a revision or a parameter change can move what they came from, also
  // where the sketch keeps its object.
  useEffect(() => { acquired.current = []; }, [sourceSketch, graphSourceParameters, documentVersion, tool, cancelSignal]);
  const pathPending = pathTool && pathDraft.kind !== 'idle';
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
  const trimAt = (event: { clientX: number; clientY: number }): TrimPreview | null => {
    const point = getRawPoint(event), rect = svg.current?.getBoundingClientRect();
    if (tool !== 'trim' || !sourceGraph || !graphControls || sourceSketch.kind !== 'sketch' || isPreview || !point || !rect?.height) return null;
    const edge = sourceGraph.pick(point, span / rect.height, 'edges').find(hit => hit.kind === 'entity');
    return edge ? prepareCadSketchTrimPreview(sourceGraph, sourceSketch.id, edge.id, point) : null;
  };
  const trimEdge = (event: { clientX: number; clientY: number }) => {
    const preview = interactionLocked || viewLocked ? null : trimAt(event);
    if (preview?.kind !== 'ready' || !graphControls) return;
    const { edit } = preview; setTrimHover(null);
    submitEdit(signal => graphControls.onEditMany([edit], signal), () => undefined, 'Unable to trim this edge.');
  };
  const spatialFrameKey = JSON.stringify([renderedPlane, center, span, aspect, viewportSize]);
  const projectSelection = (event: { clientX: number; clientY: number }) => {
    const point = getRawPoint(event), rect = svg.current?.getBoundingClientRect();
    return point && rect ? { point, frame: JSON.stringify([renderedPlane, center, span, rect.left, rect.top, rect.width, rect.height]) } : null;
  };
  // Identity pins the complete accepted source, unfinished drawing and camera.
  // Cursor movement over the menu does not change the captured drawing intent.
  const drawingOwner = useMemo(() => ({ sourceSketch, drawingSnaps, parameters: graphSourceParameters, document: graphControls?.document,
    documentVersion, tool, picks, pathDraft, inferCoincidence, snap, gridSnap, gridStep, cancelSignal, spatialFrameKey, positionPick,
    pathAvailable: Boolean(onAddPath), freshAvailable: Boolean(onAddFreshSketch) }),
  [sourceSketch, drawingSnaps, graphSourceParameters, graphControls?.document, documentVersion, tool, picks, pathDraft, inferCoincidence, snap, gridSnap, gridStep, cancelSignal, spatialFrameKey, positionPick, Boolean(onAddPath), Boolean(onAddFreshSketch)]);
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
  const boxSelection = useCadSketchBoxSelection({ prepared: sourceGraph, enabled: tool === 'select' && !geometryPick && !positionPick && !isPreview && sketch.kind === 'sketch', locked: interactionLocked,
    version: documentVersion, cancelSignal, frameKey: spatialFrameKey, filter: pickFilter,
    selection: graphControls?.selection ?? [], onSelectSet: graphControls?.onSelectSet, onPendingChange: publishBoxPending, onError,
    onCancel: () => { suppressProfileClick.current = true; },
    project: projectSelection });
  const boxSelections = boxSelection.box?.selections;
  const layerControls = useMemo(() => graphControls && boxSelections ? { ...graphControls, selection: boxSelections } : graphControls, [graphControls, boxSelections]);
  const graphPickAt = useRef<(event: { clientX: number; clientY: number }) => CadSketchGraphSelection | null>(() => null);
  graphPickAt.current = event => { const point = getRawPoint(event), rect = svg.current?.getBoundingClientRect(); return point && rect?.height ? graphPicks(point, span / rect.height)[0] ?? null : null; };
  const pickGraphAt = useCallback((event: { clientX: number; clientY: number }) => graphPickAt.current(event), []);
  const overlapEnvironment = useRef({ sourceGraph, document: graphControls?.document, documentVersion, cancelSignal, geometryPick, pickFilter, spatialFrameKey, selection: graphControls?.selection, allowed: false });
  overlapEnvironment.current = { sourceGraph, document: graphControls?.document, documentVersion, cancelSignal, geometryPick, pickFilter, spatialFrameKey, selection: graphControls?.selection,
    allowed: tool === 'select' && !positionPick && !isPreview && !baseInteractionLocked };
  const overlapIsCurrent = (owned: CadSketchOverlapPick) => {
    const current = overlapEnvironment.current;
    return current.allowed && owned.prepared === current.sourceGraph && owned.document === current.document && owned.version === current.documentVersion
      && owned.cancelSignal === current.cancelSignal && owned.geometryPick === current.geometryPick && owned.filter === current.pickFilter && owned.frameKey === current.spatialFrameKey
      && cadSketchGraphSelectionsEqual(owned.selection, current.selection ?? []) && projectSelection(owned)?.frame === owned.frame;
  };
  const currentOverlap = overlap && overlapIsCurrent(overlap) ? overlap : null;
  const closeOverlap = useCallback(() => { setOverlap(null); setPickHighlight(null); }, []);
  useLayoutEffect(() => { if (overlap && !currentOverlap) closeOverlap(); }, [overlap, currentOverlap, closeOverlap]);
  const openOverlap = (event: { clientX: number; clientY: number; shiftKey?: boolean }, trigger: 'pointer' | 'keyboard' = 'pointer', focusedAtom?: CadSketchGraphSelection) => {
    const projection = projectSelection(event), rect = svg.current?.getBoundingClientRect();
    if (!sourceGraph || !graphControls || !projection || !rect?.height || tool !== 'select' || isPreview || interactionLocked) return false;
    const candidates = graphPicks(projection.point, span / rect.height);
    const focused = focusedAtom && trigger === 'keyboard' && (geometryPick ? cadSketchGeometryPickAllows(geometryPick, focusedAtom)
      : focusedAtom.kind === 'point' ? graphContextMenu && pickFilter !== 'edges' && sourceGraph.graph.points.some(point => point.id === focusedAtom.id)
      : pickFilter !== 'points' && sourceGraph.graph.entities.some(entity => entity.id === focusedAtom.id && (entity.kind !== 'circle' || graphContextMenu || cadSketchLinearPatternForSelection(sourceGraph.graph, focusedAtom) || cadSketchExternalReferenceForSelection(sourceGraph.graph, focusedAtom)))) ? focusedAtom : undefined;
    if (!candidates.length && !focused) return false;
    const selected = graphControls.selection.length === 1 ? graphControls.selection[0] : null;
    const target = trigger === 'pointer' ? candidates.length === 1 && (candidates[0].kind === 'entity' || graphContextMenu && !geometryPick) ? candidates[0]
      : selected?.kind === 'entity' && candidates.some(atom => atom.kind === 'entity' && atom.id === selected.id) ? selected : undefined : focused;
    setOverlap({ prepared: sourceGraph, document: graphControls.document, version: documentVersion, cancelSignal, filter: pickFilter, frameKey: spatialFrameKey, frame: projection.frame, geometryPick,
      clientX: event.clientX, clientY: event.clientY, toggle: Boolean(event.shiftKey), candidates, target, selection: graphControls.selection,
      ...(geometryPick || target?.kind === 'point' ? {} : focused && sourceGraph.graph.entities.find(entity => entity.id === focused.id)?.kind === 'circle' ? { extendEnds: [] }
        : focused ? { action: 'extend', extendEnd: 'start', extendEnds: (['start', 'end'] as const).map(end => ({ end,
        preview: prepareCadSketchExtendEndPreview(sourceGraph, sourceSketch.id, focused.id, end) })) }
        : target ? { action: 'split', split: prepareCadSketchSplitPreview(sourceGraph, sourceSketch.id, target.id, projection.point),
        trim: prepareCadSketchTrimPreview(sourceGraph, sourceSketch.id, target.id, projection.point),
        extend: prepareCadSketchExtendPreview(sourceGraph, sourceSketch.id, target.id, projection.point) } : {}) });
    return true;
  };
  const selectOverlap = (atom: CadSketchGraphSelection) => {
    if (!currentOverlap || projectSelection(currentOverlap)?.frame !== currentOverlap.frame || baseInteractionLocked) return;
    try { selectGraphHit(atom, currentOverlap.toggle); }
    catch (cause) { onError(userFacingMessage(cause, 'Unable to select this geometry.')); return; }
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
  const patternOwner = sourceGraph && overlapTarget ? cadSketchLinearPatternForSelection(sourceGraph.graph,overlapTarget) : null;
  const actOnPattern = (action: () => void) => {
    if (!currentOverlap || !overlapIsCurrent(currentOverlap)) return;
    const owned = currentOverlap;
    flushSync(() => { closeOverlap(); pendingChange.current(false); });
    if (overlapIsCurrent(owned)) action();
  };
  const commandScope = currentOverlap && overlapTarget ? currentOverlap.selection.some(atom => atom.kind === overlapTarget.kind && atom.id === overlapTarget.id)
    ? currentOverlap.selection : [overlapTarget] : [];
  const graphCommandItems = currentOverlap && overlapTarget && !geometryPick && graphContextMenu ? graphContextMenu(commandScope).map(item => 'kind' in item ? item
    : { ...item, onHighlight: () => { highlightEdgeAction(); setPickHighlight(overlapTarget); item.onHighlight?.(); }, onSelect: () => actOnPattern(item.onSelect) }) : [];
  const referenceOwner = sourceGraph && overlapTarget ? cadSketchExternalReferenceForSelection(sourceGraph.graph, overlapTarget) : undefined;
  const overlapItems: readonly CadContextMenuItem[] = [...(currentOverlap && geometryPick ? (overlapTarget ? [overlapTarget] : currentOverlap.candidates).map(atom => ({
    label: overlapTarget ? geometryPick.label : `${geometryPick.label} · ${atom.kind === 'point' ? 'Point' : ({ line: 'Line', arc: 'Arc', circle: 'Circle' })[sourceGraph?.graph.entities.find(entity => entity.id === atom.id)?.kind ?? 'line']} ${(atom.kind === 'point' ? sourceGraph?.points.findIndex(point => point.id === atom.id) ?? -1 : sourceGraph?.geometry.segments.findIndex(entity => entity.id === atom.id) ?? -1) + 1}`,
    onHighlight: () => setPickHighlight(atom), onSelect: () => selectOverlap(atom)
  })) : currentOverlap && overlapTarget && patternOwner ? [
    {label:'Edit pattern',onSelect:()=>actOnPattern(()=>graphControls?.onEditPattern?.(patternOwner.relation.id))},
    {label:'Select seed',onSelect:()=>actOnPattern(()=>graphControls?.onSelect({kind:'entity',id:patternOwner.relation.seed.entityId}))},
    ...(patternOwner.index > 0 ? [{label:'Exclude occurrence',onSelect:()=>actOnPattern(()=>graphControls?.onDelete?.(overlapTarget))}] : [])
  ] : currentOverlap && overlapTarget ? [
    ...(referenceOwner ? [{ label: 'Detach reference', help: 'Keep this geometry and its local relations, and release its source link.', onSelect: () => {
      const owned = currentOverlap;
      if (projectSelection(owned)?.frame !== owned.frame || baseInteractionLocked || !graphControls || sourceSketch.kind !== 'sketch') return;
      edgeSubmission.current = owned;
      submitEdit(signal => graphControls.onEditMany([{ kind: 'remove-sketch-relation', sketchId: sourceSketch.id, relationId: referenceOwner.id }], signal), () => {
        if (edgeSubmission.current !== owned) return;
        edgeSubmission.current = null;
        if (projectSelection(owned)?.frame === owned.frame) graphControls.onSelect(overlapTarget);
      }, 'Unable to detach this reference.');
    } }] : []),
    ...(currentOverlap.extendEnds || overlapTarget.kind === 'point' ? [] : [
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
            else if ('cutPointIds' in edit.trim) graphControls.onSelect({ kind: 'point', id: edit.trim.cutPointIds[0] });
            else graphControls.onSelectSet?.(graphControls.selection.filter(atom => atom.kind !== 'entity' || atom.id !== edit.trim.entityId), true);
          }
        }, 'Unable to trim this edge.');
      } }]),
    ...extendItems,
    { label: overlapTarget.kind === 'point' ? 'Select point' : 'Select edge', onHighlight: () => { highlightEdgeAction(); setPickHighlight(overlapTarget); }, onSelect: () => selectOverlap(overlapTarget) },
    ...(currentOverlap.candidates.length > 1 ? [{ label: 'Select other', onSelect: () => setOverlap({ ...currentOverlap, target: undefined, split: undefined, trim: undefined, extend: undefined, extendEnds: undefined, extendEnd: undefined, action: undefined }) }] : [])
  ] : currentOverlap?.candidates.map(atom => {
    const point = atom.kind === 'point' ? sourceGraph?.points.find(point => point.id === atom.id) : null;
    const index = atom.kind === 'point' ? sourceGraph?.graph.points.findIndex(point => point.id === atom.id) : sourceGraph?.graph.entities.findIndex(entity => entity.id === atom.id);
    const entity = atom.kind === 'entity' ? sourceGraph?.graph.entities.find(entity => entity.id === atom.id) : null;
    const label = point ? `Point ${(index ?? -1) + 1} · ${point.position.map(value => formatCadQuantity(value)).join(', ')} mm`
      : `${entity?.kind === 'line' ? 'Line' : entity?.kind === 'circle' ? 'Circle' : 'Arc'} ${(index ?? -1) + 1}`;
    return { label, onHighlight: () => setPickHighlight(atom), onSelect: () => selectOverlap(atom) };
  }) ?? []), ...(graphCommandItems.length ? [{ kind: 'separator' } satisfies CadContextMenuItem, ...graphCommandItems] : [])];
  const getDrawingPick = (event: { clientX: number; clientY: number; ctrlKey: boolean; metaKey: boolean }): DrawingPick => {
    const raw = getRawPoint(event) ?? [0, 0], suppressed = event.ctrlKey || event.metaKey, rect = svg.current?.getBoundingClientRect();
    setCursorInput({ point: raw, suppressed, mode: 'pointer' });
    const pick = resolveDrawingPick(raw, suppressed, 'pointer', [width / (rect?.width || 0), span / (rect?.height || 0)]);
    const target = pick.candidate?.target;
    if (pick.candidate && target && !SNAP_PLACEMENTS.has(target.kind) && target.kind !== 'draft-start'
      && !acquired.current.some(point => point[0] === pick.point[0] && point[1] === pick.point[1])) acquired.current = [pick.candidate.point, ...acquired.current].slice(0, ACQUIRED_POINTS);
    return pick;
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
      onError(userFacingMessage(error, fallback));
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
    const snapped = magnetSketchPoint([anchor[0] + (event.clientX - active.clientX) * active.mmPerPixelX, anchor[1] - (event.clientY - active.clientY) * active.mmPerPixelY], active.gridStep, active.snap,
      DRAG_GRID_CATCH_PIXELS * Math.max(active.mmPerPixelX, active.mmPerPixelY));
    const translation: SketchPoint = [snapped[0] - anchor[0], snapped[1] - anchor[1]];
    try {
      const profile = active.handle ? moveCadSketchHandle({ profile: active.profile, handle: active.handle, translation, parameters: active.parameters })
        : translateCadSketchProfile({ profile: active.profile, translation, parameters: active.parameters });
      active.translation = translation;
      setDragPreview(current => current && current.translation[0] === translation[0] && current.translation[1] === translation[1] ? current : { profile, translation, handle: active.handle });
    } catch (error) { finishProfileDrag(); onError(userFacingMessage(error, 'Unable to move this contour.')); }
  };
  /**
   * Line and Arc save their one segment, and a polyline click returning to its start saves it closed. The draft keeps
   * its earlier state until the save is accepted, so a rejected save leaves the last click to repeat.
   */
  const changePath = (action: CadPathDrawingAction, focus = false) => {
    if (interactionLocked && action.kind !== 'cancel') return;
    if (action.kind === 'cancel') submission.cancel();
    try {
      const next = updateCadPathDraft(pathDraft, action);
      if (action.kind === 'point' && action.pick && referencesSource(action.pick) && !attachedSource.current)
        attachedSource.current = { sketch: sourceSketch, version: documentVersion, parameters: graphSourceParameters, document: graphControls?.document };
      setCursorInput(current => ({ ...current, point: action.kind === 'point' ? action.point : cursor, mode: 'position' }));
      if (action.kind === 'point' && next.kind === 'ready' && (singleSegment ? next.segments.length > 0 : sketch.kind === 'sketch' && closesCadPolyline(next))) finishPath(!singleSegment, next);
      else { setPathDraft(next); noteDraftChange(action.kind === 'point'); }
    }
    catch (error) { onError(userFacingMessage(error, 'Unable to draw this path.')); }
    if (action.kind === 'cancel' && curveCreation) onCancelCurve?.();
    if (focus) svg.current?.focus();
  };
  const cancelDrawing = () => {
    noteDraftChange(false); closeSnapChoice();
    edgeSubmission.current = null; submission.cancel(); ownedHandleEdit.current = null;
    setDragPreview(null); setPicks([]); setPathDraft(idlePathDraft()); setCursorInput(current => ({ ...current, mode: 'position' }));
    if (curveCreation) onCancelCurve?.();
  };
  const finishPath = (closed: boolean, draft: CadPathDraft = pathDraft) => {
    if (interactionLocked) return;
    noteDraftChange(false);
    const reset = () => setPathDraft(idlePathDraft());
    try {
      if (sketch.kind === 'curve') {
        if (!onAddCurve || !curveCreation) throw new Error('Edit the existing curve dimensions in Properties.');
        const segments = finishCadCurveDraft(draft);
        submitEdit(signal => onAddCurve(segments, signal), reset, 'Unable to finish this curve.');
      } else if (onAddPath) {
        if (!attachedSourceCurrent()) return;
        submitEdit(signal => onAddPath(draft, closed, signal), reset, singleSegment ? `Unable to add this ${tool}.` : 'Unable to finish this polyline.');
      } else if (singleSegment) {
        throw new Error('This sketch keeps closed profiles only. Draw a closed shape with Polyline.');
      } else {
        const profile = closeCadPolylineProfile(draft);
        submitEdit(signal => onAddProfile(profile, signal), reset, 'Unable to close this path.');
      }
    }
    catch (error) { onError(userFacingMessage(error, 'Unable to close this path.')); }
    svg.current?.focus();
  };
  const add = (geometry: CadProfile, drawing?: CadFreshSketchDrawing) => {
    noteDraftChange(false);
    try {
      if (!attachedSourceCurrent()) return;
      if (drawing && !onAddFreshSketch && picks.some(pick => pick.kind !== 'position')) throw new Error('The attached drawing cannot be saved by this editor. Cancel or release its pending relations.');
      submitEdit(signal => drawing && onAddFreshSketch ? onAddFreshSketch(drawing, signal) : onAddProfile(geometry, signal), () => setPicks([]), 'Unable to add this profile.');
    }
    catch (error) { onError(userFacingMessage(error, 'Unable to add this profile.')); }
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
      const snapped = snapSketchPoint(target, gridStep, gridSnap);
      setCursorInput({ point: Math.abs(snapped[0] - target[0]) <= heightSpan * measuredAspect.current / 2 && Math.abs(snapped[1] - target[1]) <= heightSpan / 2 ? snapped : target, suppressed: false, mode: 'position' });
    }
  };
  fitView.current = fit;
  useLayoutEffect(() => {
    if (curveCreation) return;
    initialCursorFit.current = true; fitView.current?.(); initialCursorFit.current = false;
  }, [sketch.id, sketch.kind, curveCreation]);
  const pathPreview = useMemo(() => pathTool ? previewCadPathDraft(pathDraft, cursor) : { kind: 'none' as const }, [pathTool, pathDraft, cursor]);
  const pathMode = pathDraft.kind === 'arc-through' ? 'arc' : pathDraft.mode;
  const pathEnd = pathDraft.kind === 'idle' ? null : cadPathDraftEndpoint(pathDraft);
  const pathNeedsClosingLine = pathDraft.kind === 'ready' && pathDraft.segments.length > 0 && pathEnd !== null
    && (pathEnd[0] !== pathDraft.start[0] || pathEnd[1] !== pathDraft.start[1]);
  const currentTrim = tool === 'trim' && trimHover?.prepared === sourceGraph && !interactionLocked ? trimHover.preview : null;
  // An inspected relation or diagnostic that holds a point on the origin or an axis lights that reference up with its geometry.
  const relationDatum = graphControls?.relation ? cadSketchRelationDatum(graphControls.relation) : null;
  const relatedDatums: readonly CadSketchDatum[] = graphControls?.inspection ? graphControls.inspection.datums ?? [] : relationDatum ? [relationDatum] : [];
  const datumProps = (datum: CadSketchDatum, className: string, onScreen: boolean) => {
    const eligible = onScreen && Boolean(datumEligible?.includes(datum)) && !interactionLocked, picked = Boolean((geometryPick ? geometryPick.pickedDatums : graphControls?.datumSelection)?.includes(datum));
    const state = `${className}${eligible ? ' is-pick-eligible' : ''}${eligible && datumHover === datum ? ' is-pick-highlighted' : ''}${picked ? ' is-selected' : ''}${relatedDatums.includes(datum) ? ' is-relation-highlighted' : ''}`;
    return eligible ? { className: state, role: 'button', tabIndex: 0, 'aria-label': `${datumPick ? 'Use' : 'Select'} ${cadSketchDatumLabels[datum].toLowerCase()}`, 'aria-pressed': datumPick ? undefined : picked, 'data-cad-sketch-datum': datum,
      onKeyDown: (event: ReactKeyboardEvent<SVGElement>) => {
        if (event.key === 'Escape' && !datumPick && graphControls && (graphControls.selection.length || graphControls.datumSelection?.length)) { event.preventDefault(); event.stopPropagation(); graphControls.onSelect(null); return; }
        if (event.key !== 'Enter' && event.key !== ' ') return; event.preventDefault(); event.stopPropagation(); chooseDatum(datum, event.shiftKey); } }
      : { className: state, 'aria-hidden': true, 'data-cad-sketch-datum': datum };
  };
  const instruction = positionPick ? `${positionPick.label} · Escape cancels` : geometryPick ? `${geometryPick.label} · Escape cancels`
    : tool === 'trim' ? currentTrim?.kind === 'ready' ? 'Click to remove the red piece · Escape returns to Select' : currentTrim?.reason ?? 'Point at the piece of an edge to remove · Escape returns to Select'
    : pathTool && pathDraft.kind === 'arc-through' ? pathPreview.kind === 'invalid' ? pathPreview.message : 'Click a point on the arc.'
    : tool === 'line' ? pathDraft.kind === 'idle' ? 'Click the line start.' : 'Click the line end.'
    : tool === 'arc' ? pathDraft.kind === 'idle' ? 'Click the arc start.' : 'Click the arc end.'
    : tool === 'path' ? pathDraft.kind === 'idle' ? sketch.kind === 'curve' ? 'Click the curve start.' : 'Click the polyline start.' : pathMode === 'arc' ? 'Click the arc endpoint.' : sketch.kind === 'curve' ? 'Click the next endpoint; Finish curve to save.' : onAddPath ? 'Click the next point. Click the start to close, or press Enter to finish open.' : 'Click the next endpoint; Close profile to finish.'
    : tool === 'select' ? sketch.kind === 'curve' ? 'Edit curve dimensions in Properties.' : 'Select a profile to edit dimensions'
    : tool === 'slot' ? points.length > 1 ? 'Click to set the slot width' : points.length ? 'Click the second arc center' : 'Click the first arc center'
    : points.length ? tool === 'circle' ? 'Click to set the radius' : 'Click the opposite corner' : tool === 'circle' ? 'Click the circle center' : 'Click the first corner';
  let preview: CadProfile | null = null;
  const first = points[0];
  // Until the width click, the slot previews half as wide as its centers are apart.
  const slotCenters = tool === 'slot' && first ? [first, points[1] ?? cursor] as const : null;
  const slotLength = slotCenters ? Math.hypot(slotCenters[1][0] - slotCenters[0][0], slotCenters[1][1] - slotCenters[0][1]) : 0;
  try {
    if (slotCenters) preview = slotSketchProfile(...slotCenters, points.length > 1 ? slotSketchWidth(...slotCenters, cursor) : slotLength / 2);
    else if (first && (tool === 'rectangle' || tool === 'circle')) preview = twoPointSketchProfile(tool, first, cursor);
  } catch { /* The preview starts at zero size. */ }
  // The unfinished shape's size follows the cursor; the accepted geometry keeps the exact picked positions.
  const readout = (value: number) => formatCadLocalizedQuantity(value, 2);
  const segmentReadout = (from: SketchPoint) => {
    const dx = cursor[0] - from[0], dy = cursor[1] - from[1];
    return `${readout(Math.hypot(dx, dy))} mm · ${readout(Math.atan2(dy, dx) * 180 / Math.PI)}°`;
  };
  const drawingReadout = interactionLocked || positionPick ? null
    : preview?.kind === 'rectangle' && typeof preview.width === 'number' && typeof preview.height === 'number' ? `${readout(Math.abs(preview.width))} × ${readout(Math.abs(preview.height))} mm`
    : preview?.kind === 'circle' && typeof preview.radius === 'number' ? `Ø ${readout(preview.radius * 2)} mm`
    : preview?.kind === 'slot' && typeof preview.width === 'number' && typeof preview.angle === 'number'
      ? points.length > 1 ? `${readout(slotLength)} mm · width ${readout(preview.width)} mm` : `${readout(slotLength)} mm · ${readout(preview.angle)}°`
    : pathTool && pathPreview.kind === 'line' && pathEnd ? segmentReadout(pathEnd) : null;
  const placePoint = (point: SketchPoint, candidate?: CadSketchSnapCandidate) => {
    if (interactionLocked) return;
    if (positionPick) {
      if (!isPreview && !viewLocked) positionPick.onPick(Object.freeze([...point] satisfies [number, number]));
      return;
    }
    if (tool === 'select') { onSelectProfile(null); return; }
    if (tool === 'trim') return;
    if (!attachedSourceCurrent()) return;
    const authoredPick = (): CadFreshSketchPick => {
      const target = canInfer && inferCoincidence ? candidate?.target : undefined;
      if (target && 'pointId' in target) return Object.freeze({ kind: 'coincident', point, sourcePointId: target.pointId, relationId: crypto.randomUUID() });
      if (target?.kind === 'on-entity' && target.entityKind === 'line') return Object.freeze({ kind: 'on-line', point, lineId: target.entityId, relationId: crypto.randomUUID() });
      if (target?.kind === 'on-entity') return Object.freeze({ kind: 'on-curve', point, curveId: target.entityId, relationId: crypto.randomUUID() });
      const datum = target?.kind === 'origin' ? 'origin' as const : target?.kind === 'on-axis' ? target.axis === 'x' ? 'x-axis' as const : 'y-axis' as const : null;
      return datum ? Object.freeze({ kind: 'datum', point, datum, relationIds: Object.freeze(cadFreshSketchDatumAxes(datum).map(() => crypto.randomUUID())) })
        : Object.freeze({ kind: 'position', point });
    };
    if (pathTool) {
      // An arc's through point only shapes the arc.
      const pick = canInfer && pathDraft.kind !== 'arc-through' ? authoredPick() : undefined, axis = lineInference(candidate, point);
      changePath({ kind: 'point', point, ...(pick && pick.kind !== 'position' ? { pick } : {}), ...(axis ? { inferred: { kind: axis, relationId: crypto.randomUUID() } } : {}) }); return;
    }
    const appendPick = (pick: CadFreshSketchPick) => {
      if (referencesSource(pick) && !attachedSource.current) attachedSource.current = { sketch: sourceSketch, version: documentVersion, parameters: graphSourceParameters, document: graphControls?.document };
      setPicks([...picks, pick]); noteDraftChange(true);
    };
    try {
      if (tool === 'slot' && points.length > 1) {
        // The width click only shapes the slot; both centers keep their own picks.
        noteDraftChange(false);
        const width = slotSketchWidth(points[0], points[1], point);
        add(slotSketchProfile(points[0], points[1], width), { kind: 'slot', first: picks[0], second: picks[1], width });
      } else if (tool === 'slot' && first) {
        if (Math.hypot(point[0] - first[0], point[1] - first[1]) < 0.001) throw new Error('Click a different point for the second arc center.');
        appendPick(authoredPick());
      } else if (first && (tool === 'rectangle' || tool === 'circle')) {
        // A completing pick ends the press even when its geometry is rejected.
        noteDraftChange(false);
        const geometry = twoPointSketchProfile(tool, first, point);
        add(geometry, tool === 'rectangle' ? { kind: 'rectangle', first: picks[0], opposite: authoredPick() }
          : geometry.kind === 'circle' && typeof geometry.radius === 'number' ? { kind: 'circle', center: picks[0], radius: geometry.radius } : undefined);
      } else appendPick(authoredPick());
    }
    catch (error) { onError(userFacingMessage(error, 'Unable to draw this profile.')); }
  };
  // CadContextMenu closes synchronously before invoking a chosen item. Use the
  // post-close handler so normal foreign-workflow and submission guards remain active.
  const placeChosen = useRef<(candidate: CadSketchSnapCandidate) => void>(() => undefined);
  placeChosen.current = candidate => placePoint(candidate.point, candidate);
  const acceptDrawingPick = (pick: DrawingPick, anchor?: { clientX: number; clientY: number }) => {
    if (interactionLocked) return;
    if (!pick.candidates) { placePoint(pick.point, pick.candidate); return; }
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
  // The view toolbar does not follow the cursor, so drawing moves reuse it instead of rendering its controls again.
  const latestFit = useRef(fit); latestFit.current = fit;
  const pickLocked = viewLocked || interactionLocked || Boolean(geometryPick || positionPick);
  const planeLabel = placementLabel ?? (typeof sketch.plane === 'string' ? sketch.plane : 'Datum plane');
  const viewTools = useMemo(() => <CadViewTools label="Sketch controls">{sketch.kind === 'sketch' && <Select aria-label="Sketch selection filter" title="Auto includes points, edges and profiles. Points or Edges restrict direct picking and box selection; Shift toggles selection." density="compact" value={pickFilter} disabled={pickLocked} onChange={event => setPickFilter(event.target.value as CadSketchGraphPickFilter)}><option value="auto">Auto</option><option value="points">Points</option><option value="edges">Edges</option></Select>}<span className="cad-plane-label">{planeLabel}</span><Button aria-label={sketch.kind === 'curve' ? 'Fit curve' : 'Fit sketch'} disabled={viewLocked} onClick={() => latestFit.current()}><FitViewIcon size={14} /></Button><Button aria-label="Toggle sketch grid" disabled={viewLocked} aria-pressed={grid} onClick={() => setGrid(!grid)}><GridIcon size={14} /></Button><Button aria-label="Toggle snapping" title="Snap to endpoints, centers, midpoints and other geometry. Hold Ctrl or Cmd to temporarily disable snapping." disabled={viewLocked} aria-pressed={snap} onClick={() => setSnap(!snap)}><SnapIcon size={14} /></Button><label className="cad-grid-step">Grid <Input aria-label="Grid spacing" disabled={viewLocked} type="number" min="0.01" value={gridStep} onChange={(event) => { const value = Number(event.target.value); if (value > 0 && Number.isFinite(value)) setGridStep(value); }} /> mm</label><label className="cad-check"><Input type="checkbox" aria-label="Snap to grid" title="Catch the pointer at grid nodes it passes close to. Off, the grid is only a visual reference." disabled={viewLocked} checked={gridSnap} onChange={event => setGridSnap(event.target.checked)} />Snap to grid</label><CadContextHelp label="Sketch navigation">{navigationMode === 'trackpad' ? 'Use two-finger scrolling to pan and pinch to zoom.' : 'Drag with the right mouse button to pan and use the wheel to zoom.'} Press F to fit the sketch and Escape to cancel unfinished drawing.</CadContextHelp></CadViewTools>, [sketch.kind, pickFilter, pickLocked, planeLabel, viewLocked, grid, snap, gridStep, gridSnap, navigationMode]);
  return <div className={`cad-sketch-viewport ${sketch.kind === 'curve' ? 'cad-curve-viewport' : ''}`} ref={host}>
    <svg ref={svg} className={`cad-sketch-canvas ${drawing ? 'is-drawing' : tool === 'trim' ? 'is-trimming' : ''}`} role="application" tabIndex={interactionLocked ? -1 : 0} aria-label={sketch.kind === 'curve' ? 'Curve drawing canvas' : 'Sketch drawing canvas'} aria-describedby={instructionsId} viewBox={`${-width / 2} ${-span / 2} ${width} ${span}`} preserveAspectRatio="none"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDownCapture={event => {
        if (positionPick && event.button === 0) {
          event.preventDefault(); event.stopPropagation(); suppressProfileClick.current = true;
          if (event.isPrimary === false || interactionLocked || viewLocked || isPreview || pan.current || profileDrag.current) return;
          event.currentTarget.focus({ preventScroll: true });
          // A position pick that also takes the origin uses it exactly, unless an eligible sketch point lies under the pointer.
          const point = datumPick && getRawPoint(event), rect = event.currentTarget.getBoundingClientRect();
          const datum = point && rect.height ? datumUnder(point, span / rect.height, graphPicks(point, span / rect.height).length > 0) : null;
          if (datum) { chooseDatum(datum, false); return; }
          acceptDrawingPick(getDrawingPick(event), event); return;
        }
        // A cancelled graph drag can release over empty canvas; its trailing click still belongs to the handle.
        if (event.button === 0 && event.target instanceof Element && event.target.closest('.cad-sketch-graph')) suppressProfileClick.current = true;
      }}
      onClickCapture={event => { if (positionPick && event.button === 0 && event.detail > 0) { event.preventDefault(); event.stopPropagation(); } }}
      onPointerDown={(event) => {
        // Another contact while an axis is held abandons the press and its trailing click; the same pointer pressing again replaces it.
        if (datumPress.current && datumPress.current.pointerId !== event.pointerId) dropDatumPress(); else datumPress.current = null;
        if (boxSelection.active()) { boxSelection.begin(event); return; }
        if (profileDrag.current) return;
        // Only the primary pointer owns the trailing click; a second contact must not release its suppression.
        if (event.button === 0 && event.isPrimary !== false) suppressProfileClick.current = false;
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
          if (tool === 'trim') { suppressProfileClick.current = true; trimEdge(event); return; }
          if (drawing && !geometryPick && !positionPick) {
            // The press places the pick, so its trailing click must not place another.
            suppressProfileClick.current = true;
            const last = pathTool ? pathDraft.kind === 'arc-through' ? pathDraft.end : pathDraft.kind === 'ready' ? cadPathDraftEndpoint(pathDraft) : null : points.at(-1);
            const bounds = event.currentTarget.getBoundingClientRect(), pick = getDrawingPick(event);
            // A tap followed by a tap-drag can arrive as a second press on the point the tap placed, so wait for the release.
            const beside = last && bounds.width && bounds.height && Math.hypot(event.clientX - (bounds.left + bounds.width / 2 + (last[0] - center[0]) / width * bounds.width),
              event.clientY - (bounds.top + bounds.height / 2 - (last[1] - center[1]) / span * bounds.height)) <= DRAWING_DRAG_PIXELS;
            const press = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, changes: draftChanges.current.count,
              held: beside && last ? { last, raw: getRawPoint(event) ?? [0, 0], scale: [width / bounds.width, span / bounds.height] as SketchPoint } : null, dragged: false };
            drawingPress.current = press;
            try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* The release still ends the press over the canvas. */ }
            if (beside) return;
            acceptDrawingPick(pick, event);
            // Only a press that added a point draws on release; a finished, rejected or ambiguous pick ends the gesture.
            const change = draftChanges.current;
            if (change.count !== press.changes && change.added) press.changes = change.count; else drawingPress.current = null;
            return;
          }
          if (tool === 'select' && sketch.kind === 'sketch' && !viewLocked && !isPreview) {
            const point = getRawPoint(event), rect = event.currentTarget.getBoundingClientRect();
            const graphHit = point && rect.height ? graphPicks(point, span / rect.height)[0] : null;
            if (graphHit) { selectGraphHit(graphHit, event.shiftKey); suppressProfileClick.current = true; return; }
            if (geometryPick) {
              // A pick takes the origin or an axis at once, since a press in a pick never drags.
              const datum = datumPick && point && rect.height ? datumUnder(point, span / rect.height, false) : null;
              if (datum) { chooseDatum(datum, false); suppressProfileClick.current = true; } else geometryPick.onConfirm?.();
              return;
            }
            const grip = pickFilter === 'auto' && onMoveHandle && point && rect.height ? pickGrip(event, point, span / rect.height) : null;
            const datum = datumSelect && point && rect.height ? datumUnder(point, span / rect.height, Boolean(grip)) : null;
            const frame = datum ? projectSelection(event)?.frame : undefined;
            if (datum && frame) datumPress.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, datum, additive: event.shiftKey, documentVersion, sketchId: sketch.id, cancelSignal, frame };
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
                snap: gridSnap, gridStep, handle: grip?.handle ?? null, anchor: grip?.point ?? null, moved: false, translation: [0, 0] };
              try { event.currentTarget.setPointerCapture(event.pointerId); } catch { finishProfileDrag(); }
            }
          }
        }
      }}
      onPointerUp={(event) => {
        const press = drawingPress.current;
        if (press && event.pointerId === press.pointerId) {
          drawingPress.current = null;
          // Nothing more once the draft changed again during the press, for example by a cancel or a keyboard pick.
          if (event.button !== 0 || interactionLocked || draftChanges.current.count !== press.changes || !(points.length > 0 || pathPending)) return;
          if (press.dragged) acceptDrawingPick(getDrawingPick(event), event);
          // A held press that did not drag is a deliberate short pick, unless it repeats the last point exactly.
          // It resolves again at the pressed sketch position so Ctrl or Cmd pressed during the hold still releases snaps and relations.
          else if (press.held) {
            const pick = resolveDrawingPick(press.held.raw, event.ctrlKey || event.metaKey, 'pointer', press.held.scale);
            if (pick.point[0] !== press.held.last[0] || pick.point[1] !== press.held.last[1]) acceptDrawingPick(pick, { clientX: press.clientX, clientY: press.clientY });
          }
          return;
        }
        const reference = datumPress.current;
        if (reference && event.pointerId === reference.pointerId) {
          datumPress.current = null;
          // A press that stayed within the drag slop is a click on the reference; the box or profile drag it started ends unapplied.
          if (event.button === 0 && Math.hypot(event.clientX - reference.clientX, event.clientY - reference.clientY) <= 4) {
            if (boxSelection.active()) boxSelection.cancel(false);
            finishProfileDrag(event.pointerId); suppressProfileClick.current = true;
            // It selects only in the document, sketch, cancellation and canvas frame it began in.
            const current = reference.documentVersion === documentVersion && reference.sketchId === sketch.id && reference.cancelSignal === cancelSignal
              && projectSelection(event)?.frame === reference.frame;
            if (current && datumSelect && !interactionLocked) chooseDatum(reference.datum, reference.additive);
            return;
          }
        }
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
        if (!geometryPick && !positionPick && pickFilter === 'auto' && point && rect.height) onContextMenu?.({ clientX: event.clientX, clientY: event.clientY, trigger: 'pointer', profileId: profilePicker.pick(point, span / rect.height), pointMm: point });
      }}
      onPointerCancel={(event) => { if (drawingPress.current?.pointerId === event.pointerId) drawingPress.current = null; if (datumPress.current?.pointerId === event.pointerId) dropDatumPress(); boxSelection.cancelPointer(event); finishProfileDrag(event.pointerId); finishPan(event.pointerId); }}
      onLostPointerCapture={(event) => { if (drawingPress.current?.pointerId === event.pointerId) drawingPress.current = null; if (datumPress.current?.pointerId === event.pointerId) dropDatumPress(); boxSelection.cancelPointer(event); finishProfileDrag(event.pointerId); finishPan(event.pointerId); }}
      onPointerMove={(event) => {
        const press = drawingPress.current;
        if (press && event.pointerId === press.pointerId) {
          if (!(event.buttons & 1)) drawingPress.current = null;
          else if (!press.dragged && Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY) > DRAWING_DRAG_PIXELS) press.dragged = true;
        }
        const reference = datumPress.current;
        if (reference && event.pointerId === reference.pointerId && (!(event.buttons & 1) || Math.hypot(event.clientX - reference.clientX, event.clientY - reference.clientY) > 4)) datumPress.current = null;
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
          if (tool === 'trim') {
            const preview = interactionLocked || viewLocked ? null : trimAt(event);
            setTrimHover(preview && sourceGraph ? { prepared: sourceGraph, preview } : null);
          }
          const gripHover = tool === 'select' && !geometryPick && !positionPick && Boolean(onMoveHandle);
          if ((datumEligible || gripHover) && !interactionLocked && !viewLocked) {
            const point = getRawPoint(event), rect = event.currentTarget.getBoundingClientRect(), millimetersPerPixel = rect.height ? span / rect.height : 0;
            // The graph layer's hit areas already say which sketch point or edge is under the pointer, so hover never searches the graph.
            const graphTarget = event.target instanceof Element ? event.target.closest('[data-cad-sketch-point], [data-cad-sketch-entity]') : null;
            const grip = gripHover && !graphTarget && point && millimetersPerPixel ? pickGrip(event, point, millimetersPerPixel) : null;
            if (gripHover) setHoverHandle(grip);
            if (datumEligible) {
              const covered = Boolean(graphTarget && graphTarget.getAttribute('aria-disabled') !== 'true' || grip && pickFilter === 'auto');
              const next = point && millimetersPerPixel ? datumUnder(point, millimetersPerPixel, covered) : null;
              if (next !== datumHover) setDatumHover(next);
            }
          }
        }
      }}
      onPointerLeave={() => { setHoverHandle(null); setDatumHover(null); setTrimHover(null); setCursorInput(current => ({ ...current, point: cursor, mode: 'position' })); }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') dropDatumPress();
        if (positionPick && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); positionPick.onCancel(); return; }
        if (geometryPick && !interactionLocked && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); geometryPick.onCancel(); return; }
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
            clientY: bounds.top + bounds.height / 2 - (at[1] - center[1]) / span * bounds.height }, 'keyboard', pointId ? { kind: 'point', id: pointId } : entityId ? { kind: 'entity', id: entityId } : undefined)) return;
          const profileId = selectedProfileId && profilePicker.hasProfile(selectedProfileId) ? selectedProfileId : null;
          const rect = event.currentTarget.getBoundingClientRect();
          if (!geometryPick && !positionPick && pickFilter === 'auto') onContextMenu?.({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, trigger: 'keyboard', profileId, pointMm: center });
          return;
        }
        if (event.ctrlKey || event.metaKey || event.altKey || event.target !== event.currentTarget) return;
        if (event.key.toLowerCase() === 'f') { if (!viewLocked) { event.preventDefault(); fit(); } return; }
        if (geometryPick?.onConfirm && !positionPick && !interactionLocked && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); geometryPick.onConfirm(); return; }
        if (interactionLocked || geometryPick && !positionPick) return;
        if (event.key === 'Delete' && !positionPick && tool === 'select' && graphControls?.selection.length && graphControls.onDelete) {
          event.preventDefault(); event.stopPropagation(); graphControls.onDelete(graphControls.selection[graphControls.selection.length - 1]); return;
        }
        const step = gridStep * (event.shiftKey ? 10 : 1);
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          setCursorInput({ point: [cursor[0] + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), cursor[1] + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0)], suppressed: false, mode: 'position' });
        } else if ((event.key === 'Enter' || event.key === ' ') && (drawing || positionPick)) {
          event.preventDefault();
          if (positionPick) acceptDrawingPick(cursorPick);
          // Enter keeps a polyline open; a sketch without connected edges can only close it.
          else if (event.key === 'Enter' && tool === 'path' && pathDraft.kind === 'ready') finishPath(sketch.kind === 'sketch' && !onAddPath);
          else acceptDrawingPick(cursorPick);
        } else if (pathTool && pathPending && (event.key === 'Backspace' || event.key === 'Escape')) { event.preventDefault(); changePath({ kind: event.key === 'Backspace' ? 'undo-last' : 'cancel' }); }
        else if (event.key === 'Backspace' && points.length) { event.preventDefault(); setPicks((current) => current.slice(0, -1)); noteDraftChange(false); }
        else if (event.key === 'Escape' && points.length) { event.preventDefault(); setPicks([]); noteDraftChange(false); }
        else if (event.key === 'Escape' && tool === 'select' && (graphControls?.selection.length || graphControls?.datumSelection?.length)) { event.preventDefault(); event.stopPropagation(); graphControls.onSelect(null); }
      }}
      onClick={(event) => {
        // Chromium's click PointerEvent reports isPrimary=false even for the
        // primary mouse; primary-pointer filtering belongs to pointerdown.
        if (event.button !== 0 || interactionLocked || geometryPick || positionPick) return;
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
        } else if (drawing) acceptDrawingPick(getDrawingPick(event), event);
      }}>
      <defs><pattern id="cad-sketch-grid" x={-center[0] % gridStep} y={center[1] % gridStep} width={gridStep} height={gridStep} patternUnits="userSpaceOnUse"><path d={`M ${gridStep} 0 H 0 V ${gridStep}`} fill="none" className="cad-sketch-grid-line" strokeWidth={span / 1000} /></pattern></defs>
      {grid && span / gridStep < 2000 && gridBands(-width / 2, width / 2, -center[0], gridStep / 2).flatMap(([left, right]) => gridBands(-span / 2, span / 2, center[1], gridStep / 2)
        .map(([top, bottom]) => <rect key={`${left} ${top}`} x={left} y={top} width={right - left} height={bottom - top} fill="url(#cad-sketch-grid)" />))}
      <CadSketchAxes origin={[-center[0], center[1]]} pixel={span / (viewportSize.height || 600)} view={[width, span]} datumProps={datumProps} />
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
        {profiles.map((profile) => <g key={profile.id} role="button" aria-disabled={Boolean(geometryPick || positionPick) || undefined} aria-label={`Select ${profile.name} profile`} aria-pressed={profile.id === selectedProfileId && detailSelection.kind === 'profile'} transform={dragPreview?.profile.id === profile.id && !dragPreview.handle ? `translate(${dragPreview.translation[0]} ${dragPreview.translation[1]})` : undefined} tabIndex={tool === 'select' && !geometryPick && !positionPick && pickFilter === 'auto' && !interactionLocked ? 0 : -1} data-cad-parameter-highlight={inspection?.profileIds.includes(profile.id) ? profile.id : undefined} data-cad-drawing-snap-profile={snapProfile?.id === profile.id ? profile.id : undefined}
          className={`cad-profile ${profile.construction ? 'is-construction' : ''} ${profile.id === selectedProfileId && detailSelection.kind === 'profile' ? 'is-selected' : ''} ${inspection?.profileIds.includes(profile.id) ? 'is-parameter-highlighted' : ''} ${snapProfile?.id === profile.id ? 'cad-sketch-entity is-pick-highlighted' : ''}`} strokeDasharray={profile.construction ? `${span / 80} ${span / 120}` : undefined} onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && tool === 'select' && !geometryPick && !positionPick && pickFilter === 'auto' && !interactionLocked) { event.preventDefault(); event.stopPropagation(); setActiveHandle(null); onSelectProfile(profile.id); } }} onClick={(event) => { if (event.detail === 0 && event.button === 0 && tool === 'select' && !geometryPick && !positionPick && pickFilter === 'auto' && !interactionLocked) { event.stopPropagation(); setActiveHandle(null); onSelectProfile(profile.id); } }}><CadSketchProfileGeometry geometry={dragPreview?.handle && dragPreview.profile.id === profile.id ? dragPreview.profile.geometry : profile.geometry} parameters={parameters} viewCenter={center} /></g>)}
        {tool === 'select' && !geometryPick && !positionPick && pickFilter === 'auto' && onMoveHandle && !isPreview && !externalInteractionLocked && <g className="cad-sketch-handles">
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
        {graphControls && sourceSketch.kind === 'sketch' && sourceGraph && layerControls && <CadSketchGraphLayer controls={layerControls} sketch={sourceSketch} version={documentVersion} prepared={sourceGraph} visual={visualGraph ?? undefined}
          center={center} scaleX={width / (viewportSize.width || 800)} scaleY={span / (viewportSize.height || 600)} gridStep={gridStep} snap={snap} gridSnap={gridSnap} active={tool === 'select'}
          filter={graphPickFilter} highlighted={graphHighlight} pickAt={pickGraphAt}
          locked={externalInteractionLocked || Boolean(positionPick && !geometryPick) || submission.applying || points.length > 0 || pathPending || dragPreview !== null || boxPending || overlapPending || choicePending} cancelSignal={cancelSignal} onPendingChange={publishGraphPending} onError={onError} />}
        {graphControls?.patternInteraction && sourceSketch.kind === 'sketch' && (previewSketch ?? sourceSketch).graph && <CadSketchLinearPatternPreview graph={(previewSketch ?? sourceSketch).graph!} parameters={parameters} interaction={graphControls.patternInteraction} center={center} mmPerPixel={span / (viewportSize.height || 600)} />}
        {currentOverlap?.action === 'split' && currentOverlap.split?.kind === 'ready' && <CadSketchSplitPreview preview={currentOverlap.split} center={center} mmPerPixel={span / (viewportSize.height || 600)} />}
        {currentTrim?.kind === 'ready' && <CadSketchTrimPreview preview={currentTrim} center={center} mmPerPixel={span / (viewportSize.height || 600)} />}
        {currentOverlap?.action === 'trim' && currentOverlap.trim?.kind === 'ready' && <CadSketchTrimPreview preview={currentOverlap.trim} center={center} mmPerPixel={span / (viewportSize.height || 600)} />}
        {currentOverlap?.action === 'extend' && activeExtend?.kind === 'ready' && <CadSketchExtendPreview preview={activeExtend} center={center} mmPerPixel={span / (viewportSize.height || 600)} />}
        {inspection?.gear && inspectedGear?.geometry.kind === 'plugin' && <CadGearInspectionOverlay profile={inspectedGear.geometry} parameters={parameters} inputName={inspection.gear.inputName} span={span} viewCenter={center} />}
        {preview && <g className="cad-profile cad-profile-preview"><CadSketchProfileGeometry geometry={preview} parameters={parameters} viewCenter={center} /></g>}
        {pathTool && pathDraft.kind !== 'idle' && <>
          <CadPathDraftGeometry segments={pathDraft.segments} viewCenter={center} />
          {(pathPreview.kind === 'line' || pathPreview.kind === 'arc') && <g className="cad-profile cad-profile-preview"><CadPathSegmentGeometry segment={pathPreview.segment} origin={center} /></g>}
          {pathDraft.kind === 'arc-through' && pathPreview.kind === 'invalid' && <polyline className="cad-path-invalid" points={[pathPreview.start, pathPreview.through, pathPreview.end].map(([x, y]) => `${x - center[0]},${y - center[1]}`).join(' ')} />}
          <circle cx={pathDraft.start[0] - center[0]} cy={pathDraft.start[1] - center[1]} r={span / 170} className="cad-sketch-vertex" />
          {pathDraft.kind === 'arc-through' && <circle cx={pathDraft.end[0] - center[0]} cy={pathDraft.end[1] - center[1]} r={span / 170} className="cad-sketch-vertex" />}
        </>}
        {drawingReadout && viewportSize.height > 0 && <g data-cad-drawing-readout="" pointerEvents="none" aria-hidden="true"
          transform={`translate(${cursor[0] - center[0]},${cursor[1] - center[1]}) scale(${width / viewportSize.width},${-span / viewportSize.height})`}>
          <rect className="cad-sketch-snap-label-bg" x="12" y="10" width={drawingReadout.length * 5.6 + 12} height="19" rx="3" />
          <text className="cad-sketch-snap-label" x="18" y="23">{drawingReadout}</text>
        </g>}
        {snapHint && viewportSize.height > 0 && <CadSketchSnapHint candidate={snapHint} center={center} scaleX={width / viewportSize.width} scaleY={span / viewportSize.height} label={snapLabel} />}
        {placement && <g data-cad-sketch-placement="" pointerEvents="none" aria-hidden="true">
          {placement.anchor && placement.target && <line className="cad-sketch-snap-target"
            x1={placement.anchor[0] - center[0]} y1={placement.anchor[1] - center[1]} x2={placement.target[0] - center[0]} y2={placement.target[1] - center[1]} />}
          {placement.anchor && <g transform={`translate(${placement.anchor[0] - center[0]},${placement.anchor[1] - center[1]}) scale(${width / (viewportSize.width || 800)},${-span / (viewportSize.height || 600)})`}>
            <path className="cad-sketch-snap-target" d="M -7 0 H 7 M 0 -7 V 7" /><rect className="cad-sketch-snap-target" x="-4" y="-4" width="8" height="8" />
          </g>}
          {placement.target && <g transform={`translate(${placement.target[0] - center[0]},${placement.target[1] - center[1]}) scale(${width / (viewportSize.width || 800)},${-span / (viewportSize.height || 600)})`}>
            <circle className="cad-sketch-snap-target" r="5" />
            <rect className="cad-sketch-snap-label-bg" x="9" y="-25" width={placementAngle.length * 5.5 + 12} height="19" rx="3" />
            <text className="cad-sketch-snap-label" x="15" y="-12">{placementAngle}</text>
          </g>}
        </g>}
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
        {pendingPicks.map((pick, index) => <circle key={index} data-cad-sketch-attachment={pick.kind === 'coincident' ? pick.sourcePointId : pick.kind === 'on-line' ? pick.lineId : pick.kind === 'on-curve' ? pick.curveId : pick.datum}
          cx={pick.point[0] - center[0]} cy={pick.point[1] - center[1]} r={6 * span / (viewportSize.height || 600)} className="cad-sketch-snap-target"><title>{pick.kind === 'coincident'
            ? `Pending coincidence with Point ${(sourceGraph?.graph.points.findIndex(point => point.id === pick.sourcePointId) ?? -1) + 1}`
            : pick.kind === 'on-line' ? 'Pending point on line' : pick.kind === 'on-curve' ? 'Pending point on curve' : `Pending ${pick.datum === 'origin' ? 'fix at the origin' : `point on the ${pick.datum === 'x-axis' ? 'X' : 'Y'} axis`}`}</title></circle>)}
      </g>
      {boxSelection.box && <rect className={`cad-sketch-selection-box is-${boxSelection.box.mode}`} pointerEvents="none"
        x={Math.min(boxSelection.box.start[0], boxSelection.box.end[0]) - center[0]} y={center[1] - Math.max(boxSelection.box.start[1], boxSelection.box.end[1])}
        width={Math.abs(boxSelection.box.end[0] - boxSelection.box.start[0])} height={Math.abs(boxSelection.box.end[1] - boxSelection.box.start[1])} />}
    </svg>
    {currentSnapChoice && <CadSketchSnapChooser anchor={{ x: currentSnapChoice.clientX, y: currentSnapChoice.clientY }} candidates={currentSnapChoice.candidates} graph={sourceGraph?.graph} profiles={sourceProfiles}
      onClose={closeSnapChoice} onHighlight={candidate => { if (choiceIsCurrent(currentSnapChoice)) setChoiceHighlight(candidate); }}
      onChoose={candidate => { if (choiceIsCurrent(currentSnapChoice)) placeChosen.current(candidate); }}
      onOutsidePointerDown={event => { suppressProfileClick.current = true; event.preventDefault(); event.stopPropagation(); }} />}
    {currentOverlap && <CadContextMenu anchor={{ x: currentOverlap.clientX + (currentOverlap.target ? 12 : 0), y: currentOverlap.clientY + (currentOverlap.target ? 12 : 0) }} title={currentOverlap.target ? currentOverlap.target.kind === 'point' ? 'Sketch point' : 'Sketch edge' : 'Select other'} items={overlapItems} onClose={closeOverlap}
      onOutsidePointerDown={event => { event.preventDefault(); event.stopPropagation(); suppressProfileClick.current = true; }} />}
    {dimensionControls && sketch.kind === 'sketch' && dimensionProfile && dimensionAnchor && tool === 'select' && !isPreview && <CadSketchDimensionControls {...dimensionControls} interactionLocked={dimensionControls.interactionLocked || submission.applying || dragPreview !== null} sketch={sketch} profile={dimensionProfile} parameters={parameters} anchor={dimensionAnchor} project={point => ({ x: (point[0] - center[0]) / width * viewportSize.width + viewportSize.width / 2, y: (center[1] - point[1]) / span * viewportSize.height + viewportSize.height / 2 })} cancelSignal={cancelSignal} />}
    {!isPreview && inspection && inspection.profileIds.length > 0 && <div className="cad-sketch-context" role="status">Highlighted geometry · {inspection.profileIds.length} {inspection.profileIds.length === 1 ? 'profile' : 'profiles'}</div>}
    <p id={instructionsId} className="cad-sr-only">{interactionLocked ? 'Drawing is paused while another edit or operation is active.' : currentTrim?.kind === 'ready' ? `${instruction}. ${currentTrim.help}` : instruction} Keyboard: arrow keys move the cursor, Shift moves ten grid steps, Space adds a point, Enter adds a point or finishes a ready polyline, Backspace undoes the last point or segment, Escape cancels drawing, F fits the sketch.</p>
    {viewTools}
    {!externalInteractionLocked && (tool !== 'select' || points.length > 0) && <CadDrawingTools active={points.length > 0 || pathPending}><div className={`cad-sketch-instruction ${tool === 'path' ? 'cad-path-instruction' : ''}`} onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'Escape' && submission.applying) { event.preventDefault(); event.stopPropagation(); cancelDrawing(); svg.current?.focus(); return; }
      if (!pathTool || !pathPending || interactionLocked || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Backspace' || event.key === 'Escape') { event.preventDefault(); changePath({ kind: event.key === 'Backspace' ? 'undo-last' : 'cancel' }, true); }
    }}><span>{instruction}</span>
      {canInfer && <label className="cad-check"><Input type="checkbox" aria-label="Create relations" checked={inferCoincidence} disabled={interactionLocked}
        title="Attach future snapped points with removable relations: coincident with endpoints and centers, on a line, arc or circle, or on the origin and axes. A line drawn along its start's horizontal or vertical guide stays horizontal or vertical. Switching off releases pending relations; accepted geometry is unchanged."
        onChange={event => { const enabled = event.target.checked; setInferCoincidence(enabled); if (!enabled) { setPicks(current => current.map(pick => ({ kind: 'position', point: pick.point }))); setPathDraft(releaseCadPathDraftPicks); } }} />Create relations</label>}
      {pendingPicks.length > 0 && <span aria-label="Pending relations">{pendingPicks.length} attached</span>}
      {tool === 'path' && <>
        <div className="cad-path-modes" role="group" aria-label="Segment mode"><Button disabled={interactionLocked || pathDraft.kind === 'arc-through'} aria-label="Line segment" aria-pressed={pathMode === 'line'} onClick={() => changePath({ kind: 'mode', mode: 'line' }, true)}>Line</Button><Button disabled={interactionLocked || pathDraft.kind === 'arc-through'} aria-pressed={pathMode === 'arc'} onClick={() => changePath({ kind: 'mode', mode: 'arc' }, true)}>3-point Arc</Button></div>
        {pathPending && <>{sketch.kind === 'sketch' && onAddPath && <Button aria-label="Finish polyline" title="Keep this polyline open without adding a closing edge (Enter)" disabled={interactionLocked || pathDraft.kind !== 'ready' || !pathDraft.segments.length} onClick={() => finishPath(false)}><ConfirmIcon size={13} /> Finish polyline</Button>}<Button aria-label={sketch.kind === 'curve' ? 'Finish curve' : 'Close profile'} title={sketch.kind === 'curve' ? 'Validate and save the open curve without a closing edge' : pathNeedsClosingLine ? 'Close the profile by adding a straight line to its start' : 'Validate and save the closed profile'} disabled={interactionLocked || pathDraft.kind !== 'ready' || !pathDraft.segments.length} onClick={() => finishPath(true)}><ConfirmIcon size={13} />{sketch.kind === 'curve' ? 'Finish curve' : pathNeedsClosingLine ? 'Close with line' : 'Close profile'}</Button><Button disabled={interactionLocked} onClick={() => changePath({ kind: 'undo-last' }, true)}><UndoIcon size={13} /> Undo last</Button><Button onClick={() => changePath({ kind: 'cancel' }, true)}><CloseIcon size={13} /> Cancel drawing</Button></>}
      </>}
      {(points.length > 0 || singleSegment && pathPending) && <Button onClick={cancelDrawing}><CloseIcon size={13} /> Cancel drawing</Button>}</div></CadDrawingTools>}
    <div className="cad-view-caption">{formatCadQuantity(Number(cursor[0].toFixed(3)))}, {formatCadQuantity(Number(cursor[1].toFixed(3)))} mm</div>
  </div>;
}
