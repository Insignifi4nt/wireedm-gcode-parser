import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import type { CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import type { CadSketchDimensionPartPlacement } from '@/domain/cad/cadSketchPlacedDimensions';
import { cadSketchDimensionArcPath, cadSketchDimensionMove, cadSketchGraphDimensionLabel, layoutCadSketchGraphDimensions, type CadSketchDimensionGrab, type CadSketchDimensionMove,
  type CadSketchDimensionRelation, type CadSketchGraphDimensionLayout } from './cadSketchGraphDimensionLayout';
import { cadSketchDimensionPickOf, createCadSketchDimensionKeys, type CadSketchDimensionPick, type CadSketchHighlightStore } from './cadSketchDimensionSelection';
import type { SketchPoint } from './cadSketchInteraction';
import './cad-sketch-graph-dimensions.css';

export interface CadSketchGraphDimensionsProps {
  readonly graph: CadSketchGraph;
  readonly parameters: Readonly<Record<string, number>>;
  readonly center: SketchPoint;
  readonly mmPerPixel: number;
  /** The relation open in the editor; it draws like a selected dimension. */
  readonly selectedRelationId?: string | null;
  /** Relation IDs of the selected dimensions. */
  readonly selectedIds?: readonly string[];
  readonly interactive: boolean;
  /** Opens the dimension editor: double-click or Enter. */
  onConfigure(relation: CadSketchDimensionRelation): void;
  /**
   * A plain click selects one dimension, Shift toggles it and Escape clears with `null`. Each command names the dimension the label
   * was drawn for, so its owner can refuse a label that a replacement under the same ID has since taken over.
   */
  onSelect?(dimension: CadSketchDimensionPick | null, additive: boolean): void;
  /** Delete or Backspace on a focused label. Focus never selects, so the owner removes its selection and this dimension only while nothing is selected. */
  onDelete?(dimension: CadSketchDimensionPick, key: 'Delete' | 'Backspace'): void;
  onMenu?(dimension: CadSketchDimensionPick, at: { readonly clientX: number; readonly clientY: number }): void;
  /**
   * Dragging a label or dimension line past the point-drag threshold moves the dimension; release calls this once with the relation
   * storing its new placement. It returns whether the move was submitted: the drag is drawn where it was released until the graph
   * changes or the canvas takes picks again. Without it dimensions are not moved.
   */
  onMove?(dimension: CadSketchDimensionPick, relation: CadSketchDimensionRelation): boolean;
  /** Hovering a dimension highlights the geometry it measures. */
  readonly highlight?: CadSketchHighlightStore;
  /**
   * The group beneath the sketch points and edges where dimension lines and arrows take the pointer, so the geometry they end on or
   * cross keeps its own picks. Without it only the value labels take the pointer.
   */
  readonly hitLayer?: SVGGElement | null;
  /** Whether a datum, profile grip or profile edge under the pointer keeps the pick from a dimension line or arrow. Labels always keep theirs. */
  covered?(event: { readonly clientX: number; readonly clientY: number; readonly target: EventTarget | null; readonly nativeEvent: Event }): boolean;
}

const NO_IDS: readonly string[] = Object.freeze([]);
/** A press moves this many screen pixels before it drags, as a point drag does. */
const DRAG_THRESHOLD_PIXELS = 4;

type Pair = readonly [SketchPoint, SketchPoint];
const segment = (points: Pair, center: SketchPoint, className?: string) => <line className={className} x1={points[0][0] - center[0]} y1={points[0][1] - center[1]}
  x2={points[1][0] - center[0]} y2={points[1][1] - center[1]} />;
const measureOf = (dimension: CadSketchGraphDimensionLayout, center: SketchPoint, className?: string) => dimension.kind === 'angle' && dimension.arc
  ? <path className={className} d={cadSketchDimensionArcPath(dimension.arc, center)} /> : segment(dimension.line, center, className);
const arrowsOf = (dimension: CadSketchGraphDimensionLayout, center: SketchPoint, className?: string) => dimension.arrows.map((arrow, index) => <polygon key={index} className={className}
  points={arrow.map(point => `${point[0] - center[0]},${point[1] - center[1]}`).join(' ')} />);
const labelTransform = (dimension: CadSketchGraphDimensionLayout, center: SketchPoint, mmPerPixel: number) =>
  `translate(${dimension.label[0] - center[0]} ${dimension.label[1] - center[1]}) scale(${mmPerPixel} ${-mmPerPixel})${dimension.labelAngle ? ` rotate(${-dimension.labelAngle * 180 / Math.PI})` : ''}`;
const labelOf = (dimension: CadSketchGraphDimensionLayout) => cadSketchGraphDimensionLabel(dimension.kind === 'angle' ? dimension.valueDegrees : dimension.valueMm, dimension.kind,
  dimension.relation.kind === 'reference-dimension');

/** The dimension being dragged, drawn above the others with its own colour; the drawn one is hidden until the drag ends. */
type Moving = { readonly key: string; readonly tone: string; readonly layout: CadSketchGraphDimensionLayout } | null;
function createMovingStore() {
  let value: Moving = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: Moving) { if (next === value) return; value = next; for (const listener of listeners) listener(); },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
type MovingStore = ReturnType<typeof createMovingStore>;
/** Only this overlay renders while a dimension is dragged; it takes no pointer events, so the drag keeps its own. */
function MovingDimension({ store, center, mmPerPixel }: { store: MovingStore; center: SketchPoint; mmPerPixel: number }) {
  const moving = useSyncExternalStore(store.subscribe, store.get);
  if (!moving) return null;
  const { layout } = moving, { text } = labelOf(layout);
  return <g className={`cad-sketch-graph-dimension is-moving-preview${moving.tone}`} data-cad-sketch-dimension-moving={layout.relation.id} pointerEvents="none" aria-hidden="true">
    <g className="cad-sketch-graph-dimension-lines">
      {layout.extensions.map((extension, index) => <g key={index}>{segment(extension, center, 'cad-sketch-graph-dimension-extension')}</g>)}
      {measureOf(layout, center, 'cad-sketch-graph-dimension-line')}
      {arrowsOf(layout, center, 'cad-sketch-graph-dimension-arrow')}
    </g>
    <g className="cad-sketch-graph-dimension-label" transform={labelTransform(layout, center, mmPerPixel)}>
      <text className="cad-sketch-graph-dimension-text" x={0} y={0} dominantBaseline="central" textAnchor="middle">{text}</text>
    </g>
  </g>;
}

/** A press on a dimension that may become a drag; the drag computes its frame only once it passes the threshold. */
interface DimensionDrag {
  readonly pointerId: number; readonly element: Element; readonly clientX: number; readonly clientY: number;
  readonly grab: CadSketchDimensionGrab; readonly key: string; readonly tone: string; readonly pick: CadSketchDimensionPick; readonly side: 0 | 1;
  /** The sketch position pressed, and the drawing it was pressed in. */
  readonly from: { readonly x: number; readonly y: number };
  readonly graph: CadSketchGraph; readonly parameters: Readonly<Record<string, number>>; readonly mmPerPixel: number;
  move: CadSketchDimensionMove | null; placement: CadSketchDimensionPartPlacement | null; moved: boolean;
}

/** The parent owns scale(1,-1); labels undo that flip and retain screen-pixel sizing. */
export function CadSketchGraphDimensions({ graph, parameters, center, mmPerPixel, selectedRelationId, selectedIds = NO_IDS, interactive, onConfigure, onSelect, onDelete, onMenu, onMove, highlight, hitLayer, covered }: CadSketchGraphDimensionsProps) {
  const dimensions = useMemo(() => layoutCadSketchGraphDimensions(graph, parameters, mmPerPixel), [graph, parameters, mmPerPixel]);
  const pointNumbers = useMemo(() => new Map(graph.points.map((point, index) => [point.id, index + 1])), [graph.points]);
  // A label keeps its element while the graph names the same dimension; a replacement mounts afresh, so it never takes over focus.
  const [dimensionKeys] = useState(createCadSketchDimensionKeys);
  const keys = useMemo(() => dimensionKeys(graph), [dimensionKeys, graph]);
  const hovered = useRef<string | null>(null);
  // The drawn dimension whose line or arrow is under the pointer. That target lies outside the dimension, so CSS hover cannot brighten it;
  // a class on its drawn group does, without rendering the dimensions again.
  const pointed = useRef<{ readonly key: string; readonly element: SVGGElement } | null>(null);
  const groups = useRef(new Map<string, SVGGElement>());
  const point = (key: string | null) => {
    const element = key ? groups.current.get(key) ?? null : null;
    if (pointed.current?.element === element) return;
    pointed.current?.element.classList.remove('is-pointed');
    pointed.current = key && element ? { key, element } : null;
    element?.classList.add('is-pointed');
  };
  // The drawn dimension whose line or arrow took the last primary press; only that press's click and double-click reach it.
  const pressed = useRef<string | null>(null);
  const labels = useRef(new Map<string, SVGGElement>());
  const hide = () => { if (hovered.current) highlight?.hide(hovered.current); hovered.current = null; point(null); };
  const hideOnUnmount = useRef(hide); hideOnUnmount.current = hide;
  // A window that loses focus never sends the pointer leave, so it drops the hover too.
  useEffect(() => {
    const blur = () => hideOnUnmount.current();
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('blur', blur); hideOnUnmount.current(); };
  }, []);
  // A render that rewrites the group's class keeps the mark; a dimension that is gone, or whose line no longer takes the pointer, drops it.
  useLayoutEffect(() => {
    const current = pointed.current; if (!current) return;
    const element = interactive && hitLayer ? groups.current.get(current.key) : undefined;
    if (element) { pointed.current = { key: current.key, element }; element.classList.add('is-pointed'); }
    else { current.element.classList.remove('is-pointed'); pointed.current = null; }
  });
  // A dimension that leaves the drawing or is replaced, or a canvas that stops accepting picks, drops its hover highlight.
  useEffect(() => {
    const owner = hovered.current;
    if (owner && (!interactive || ![...keys.values()].some(key => `dimension:${key}` === owner))) hideOnUnmount.current();
  }, [keys, interactive]);

  // A drag draws only the dragged dimension, in the overlay, and changes nothing until it is released.
  const [moving] = useState(createMovingStore);
  const dragging = useRef<DimensionDrag | null>(null);
  // The drawn dimension hidden beneath the overlay.
  const hidden = useRef<Element | null>(null);
  // A released drag stays drawn where it was released while its edit is submitted, until the graph changes or picks resume.
  const submitted = useRef<CadSketchGraph | null>(null);
  // The click that follows a drag's release, or a release after Escape, neither selects nor toggles.
  const swallowClick = useRef(false);
  const reveal = () => { hidden.current?.classList.remove('is-moving'); hidden.current = null; moving.set(null); };
  const releaseDrag = (owned: DimensionDrag) => {
    if (dragging.current === owned) dragging.current = null;
    try { if (owned.element.hasPointerCapture?.(owned.pointerId)) owned.element.releasePointerCapture(owned.pointerId); } catch { /* Capture may already be released. */ }
  };
  const cancelDrag = () => {
    const owned = dragging.current; if (!owned) return;
    releaseDrag(owned);
    if (owned.moved) { swallowClick.current = true; reveal(); }
  };
  const cancelDragOnUnmount = useRef(cancelDrag); cancelDragOnUnmount.current = cancelDrag;
  // Another graph, zoom or parameters, or a canvas that stops accepting picks, ends a drag unsubmitted. A submitted move stays drawn
  // until its graph is replaced, or picks resume because the edit was refused or cancelled.
  useLayoutEffect(() => {
    const owned = dragging.current;
    if (owned && (owned.graph !== graph || owned.parameters !== parameters || owned.mmPerPixel !== mmPerPixel || !interactive)) cancelDragOnUnmount.current();
    if (submitted.current && (submitted.current !== graph || interactive)) { submitted.current = null; reveal(); }
  }, [graph, parameters, mmPerPixel, interactive]);
  useEffect(() => {
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || !dragging.current?.moved) return;
      event.preventDefault(); event.stopPropagation(); cancelDragOnUnmount.current();
    };
    const blur = () => cancelDragOnUnmount.current();
    window.addEventListener('keydown', escape, true); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', escape, true); window.removeEventListener('blur', blur); cancelDragOnUnmount.current(); };
  }, []);
  /** The sketch position under the pointer; without layout, as in tests, the drawn position the press was on. */
  const sketchPosition = (event: PointerEvent<SVGGElement>, fallback: SketchPoint) => {
    const matrix = event.currentTarget.getScreenCTM?.();
    const local = matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : null;
    return local && Number.isFinite(local.x) && Number.isFinite(local.y) ? { x: local.x + center[0], y: local.y + center[1] } : { x: fallback[0], y: fallback[1] };
  };
  const press = (event: PointerEvent<SVGGElement>, dimension: CadSketchGraphDimensionLayout, grab: CadSketchDimensionGrab, key: string, tone: string) => {
    swallowClick.current = false;
    if (!interactive || !onMove || event.isPrimary === false || dragging.current || submitted.current) return;
    const fallback = grab === 'label' || dimension.kind === 'angle' ? dimension.label
      : [dimension.line[0][0] / 2 + dimension.line[1][0] / 2, dimension.line[0][1] / 2 + dimension.line[1][1] / 2] as SketchPoint;
    const owned: DimensionDrag = { pointerId: event.pointerId, element: event.currentTarget, clientX: event.clientX, clientY: event.clientY, grab, key, tone,
      pick: cadSketchDimensionPickOf(dimension.relation), side: dimension.kind === 'setback' ? dimension.side : 0, from: sketchPosition(event, fallback),
      graph, parameters, mmPerPixel, move: null, placement: null, moved: false };
    dragging.current = owned;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Without capture the drag follows the pointer while it is over the dimension. */ }
  };
  const drag = (event: PointerEvent<SVGGElement>, released = false) => {
    const owned = dragging.current;
    if (!owned || owned.pointerId !== event.pointerId) return;
    if (!released && !(event.buttons & 1)) { cancelDrag(); return; }
    const dx = event.clientX - owned.clientX, dy = event.clientY - owned.clientY;
    if (!owned.moved && Math.hypot(dx, dy) <= DRAG_THRESHOLD_PIXELS) return;
    event.stopPropagation();
    if (!owned.moved) {
      // The drag's frame is resolved once it starts: a plain click lays nothing out.
      owned.move = cadSketchDimensionMove(owned.graph, owned.parameters, owned.mmPerPixel, owned.pick.id, owned.side);
      if (!owned.move) { releaseDrag(owned); return; }
      owned.moved = true;
      const element = groups.current.get(owned.key) ?? null;
      element?.classList.add('is-moving'); hidden.current = element;
      if (hovered.current) hide();
    }
    const move = owned.move!, to = { x: owned.from.x + dx * owned.mmPerPixel, y: owned.from.y - dy * owned.mmPerPixel };
    owned.placement = move.placementAt(owned.grab, owned.from, to);
    moving.set({ key: owned.key, tone: owned.tone, layout: move.layoutAt(owned.placement) });
  };
  const release = (event: PointerEvent<SVGGElement>) => {
    const owned = dragging.current;
    if (!owned || owned.pointerId !== event.pointerId) return;
    if (owned.moved && event.button === 0) drag(event, true);
    releaseDrag(owned);
    if (!owned.moved) return;
    event.preventDefault(); event.stopPropagation(); swallowClick.current = true;
    if (event.button !== 0 || !owned.move || !owned.placement) { reveal(); return; }
    // The drag selects the dragged dimension, and keeps a selection already holding it.
    if (!selectedIds.includes(owned.pick.id)) onSelect?.(owned.pick, false);
    if (onMove?.(owned.pick, owned.move.relationAt(owned.placement))) submitted.current = owned.graph; else reveal();
  };
  const cancelPointer = (event: PointerEvent<SVGGElement>) => { if (dragging.current?.pointerId === event.pointerId) cancelDrag(); };
  const line = (points: Pair, className?: string) => segment(points, center, className);
  const hits: ReactElement[] = [];
  const drawn = <g className="cad-sketch-graph-dimensions" role="group" aria-label="Sketch dimensions">
    {dimensions.map(dimension => {
      const relation = dimension.relation, reference = relation.kind === 'reference-dimension';
      const { quantity, text, width, height } = cadSketchGraphDimensionLabel(dimension.kind === 'angle' ? dimension.valueDegrees : dimension.valueMm, dimension.kind, reference);
      const name = dimension.kind === 'distance-x' ? 'horizontal distance' : dimension.kind === 'distance-y' ? 'vertical distance'
        : dimension.kind === 'radius' || dimension.kind === 'diameter' || dimension.kind === 'angle' ? dimension.kind : dimension.kind === 'setback' ? `chamfer setback ${dimension.side + 1}` : dimension.kind === 'point-line' ? 'point to line distance' : 'distance';
      const roles = relation.kind === 'axis-distance'
        ? `, From Point ${pointNumbers.get(relation.pointIds[0])} → To Point ${pointNumbers.get(relation.pointIds[1])}` : '';
      const selected = selectedIds.includes(relation.id), inspected = selectedRelationId === relation.id;
      const mountKey = keys.get(relation.id) ?? relation.id, owner = `dimension:${mountKey}`, pick = cadSketchDimensionPickOf(relation);
      const enter = () => { if (!interactive || !highlight) return; hovered.current = owner; highlight.show(owner, { kind: 'relation', relationId: relation.id }); };
      const leave = () => { if (hovered.current === owner) hide(); };
      const elementKey = `${mountKey}/${dimension.kind === 'setback' ? dimension.side : dimension.kind}`;
      const tone = selected || inspected ? ' is-selected' : reference ? ' is-reference' : '';
      const down = (event: PointerEvent<SVGGElement>, grab: CadSketchDimensionGrab = 'label') => {
        // The canvas owns right and middle presses: a still right release opens this dimension's menu.
        if (event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        if (interactive && event.isPrimary !== false) labels.current.get(elementKey)?.focus({ preventScroll: true });
        press(event, dimension, grab, elementKey, tone);
      };
      const click = (event: MouseEvent<SVGGElement>) => {
        if (event.button !== 0) return; event.preventDefault(); event.stopPropagation();
        if (swallowClick.current) { swallowClick.current = false; return; }
        if (interactive && event.detail <= 1) onSelect?.(pick, event.shiftKey);
      };
      const doubleClick = (event: MouseEvent<SVGGElement>) => { event.preventDefault(); event.stopPropagation(); if (interactive) onConfigure(relation); };
      const key = (event: KeyboardEvent<SVGGElement>) => {
        if (event.nativeEvent.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
        const menu = event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey;
        // The label owns its own keys even while picks are paused, so they never reach the geometry selection behind it.
        const owned = event.key === 'Enter' || event.key === ' ' || event.key === 'Delete' || event.key === 'Backspace' || menu;
        if (!owned && !(event.key === 'Escape' && interactive && selectedIds.length > 0)) return;
        event.preventDefault(); event.stopPropagation();
        if (!interactive) return;
        if (event.key === 'Enter') onConfigure(relation);
        else if (event.key === ' ') onSelect?.(pick, event.shiftKey);
        else if (event.key === 'Escape') onSelect?.(null, false);
        else if (menu) { const box = event.currentTarget.getBoundingClientRect(); onMenu?.(pick, { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }); }
        else onDelete?.(pick, event.key === 'Delete' ? 'Delete' : 'Backspace');
      };
      // A datum, profile grip or profile edge under a line or arrow keeps the pointer: the dimension leaves that event to the canvas.
      const pointerOver = (event: PointerEvent<SVGGElement>) => {
        if (!interactive) return;
        if (covered?.(event)) { if (hovered.current === owner) hide(); else if (pointed.current?.key === elementKey) point(null); return; }
        if (hovered.current !== owner) enter();
        point(elementKey);
      };
      const lineDown = (event: PointerEvent<SVGGElement>) => {
        if (event.button !== 0) return;
        if (covered?.(event)) { pressed.current = null; return; }
        pressed.current = elementKey; down(event, 'line');
      };
      const measure = (className?: string) => measureOf(dimension, center, className);
      const arrows = (className?: string) => arrowsOf(dimension, center, className);
      // The drawn line stays 1 px; a wider transparent copy beneath the geometry takes the pointer, with copies of the arrows.
      if (interactive && hitLayer) hits.push(<g key={elementKey} data-cad-sketch-dimension-hit={relation.id} className="cad-sketch-graph-dimension-pick"
        onPointerEnter={pointerOver} onPointerMove={event => { if (dragging.current?.pointerId === event.pointerId) drag(event); else pointerOver(event); }} onPointerLeave={() => { leave(); if (pointed.current?.key === elementKey) point(null); }} onPointerDown={lineDown}
        onPointerUp={release} onPointerCancel={cancelPointer} onLostPointerCapture={cancelPointer}
        onClick={event => { if (pressed.current === elementKey) click(event); }} onDoubleClick={event => { if (pressed.current === elementKey) doubleClick(event); }}>
        {measure()}
        {arrows()}
      </g>);
      return <g key={elementKey} data-cad-sketch-dimension={relation.id}
        data-cad-dimension-reference={reference || undefined} data-cad-dimension-kind={dimension.kind} data-cad-dimension-side={dimension.kind === 'setback' ? dimension.side : undefined}
        ref={element => { if (element) groups.current.set(elementKey, element); else groups.current.delete(elementKey); }}
        className={`cad-sketch-graph-dimension${tone}${interactive ? ' is-interactive' : ''}`}
        onPointerEnter={enter} onPointerLeave={leave} onPointerDown={event => down(event)} onPointerMove={event => drag(event)} onPointerUp={release}
        onPointerCancel={cancelPointer} onLostPointerCapture={cancelPointer} onClick={click} onDoubleClick={doubleClick}>
        <g className="cad-sketch-graph-dimension-lines">
          {dimension.extensions.map((extension, index) => <g key={index}>{line(extension, 'cad-sketch-graph-dimension-extension')}</g>)}
          {measure('cad-sketch-graph-dimension-line')}
          {arrows('cad-sketch-graph-dimension-arrow')}
        </g>
        <g ref={element => { if (element) labels.current.set(elementKey, element); else labels.current.delete(elementKey); }} className="cad-sketch-graph-dimension-label" role="button" aria-label={`${reference ? 'Reference dimension' : 'Dimension'} ${name} ${quantity}${roles}, press Enter to edit`}
          aria-pressed={selected || inspected} aria-disabled={!interactive || undefined} tabIndex={interactive ? 0 : -1}
          transform={labelTransform(dimension, center, mmPerPixel)}
          onKeyDown={key}>
          <rect className="cad-sketch-graph-dimension-hit" x={-width / 2 - 3} y={-(height + 6) / 2} width={width + 6} height={height + 6} />
          <text className="cad-sketch-graph-dimension-text" x={0} y={0} dominantBaseline="central" textAnchor="middle">{text}</text>
        </g>
      </g>;
    })}
    <MovingDimension store={moving} center={center} mmPerPixel={mmPerPixel} />
  </g>;
  return <>{drawn}{hitLayer && hits.length > 0 && createPortal(hits, hitLayer)}</>;
}
