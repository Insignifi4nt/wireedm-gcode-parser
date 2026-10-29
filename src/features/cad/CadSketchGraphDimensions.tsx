import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import type { CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { cadSketchGraphDimensionLabel, layoutCadSketchGraphDimensions, type CadSketchDimensionRelation } from './cadSketchGraphDimensionLayout';
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

/** The parent owns scale(1,-1); labels undo that flip and retain screen-pixel sizing. */
export function CadSketchGraphDimensions({ graph, parameters, center, mmPerPixel, selectedRelationId, selectedIds = NO_IDS, interactive, onConfigure, onSelect, onDelete, onMenu, highlight, hitLayer, covered }: CadSketchGraphDimensionsProps) {
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
  useEffect(() => () => hideOnUnmount.current(), []);
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
  const line = (points: readonly [SketchPoint, SketchPoint], className?: string) => <line className={className} x1={points[0][0] - center[0]} y1={points[0][1] - center[1]}
    x2={points[1][0] - center[0]} y2={points[1][1] - center[1]} />;
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
      const down = (event: PointerEvent<SVGGElement>) => {
        // The canvas owns right and middle presses: a still right release opens this dimension's menu.
        if (event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        if (interactive && event.isPrimary !== false) labels.current.get(elementKey)?.focus({ preventScroll: true });
      };
      const click = (event: MouseEvent<SVGGElement>) => {
        if (event.button !== 0) return; event.preventDefault(); event.stopPropagation();
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
        pressed.current = elementKey; down(event);
      };
      const tone = selected || inspected ? ' is-selected' : reference ? ' is-reference' : '';
      const measure = (className?: string) => dimension.kind === 'angle' ? <path className={className} d={`M ${dimension.arc.start[0] - center[0]} ${dimension.arc.start[1] - center[1]} A ${dimension.arc.radius} ${dimension.arc.radius} 0 0 ${dimension.arc.clockwise ? 0 : 1} ${dimension.arc.end[0] - center[0]} ${dimension.arc.end[1] - center[1]}`} />
        : line(dimension.line, className);
      const arrows = (className?: string) => dimension.arrows.map((arrow, index) => <polygon key={index} className={className}
        points={arrow.map(point => `${point[0] - center[0]},${point[1] - center[1]}`).join(' ')} />);
      // The drawn line stays 1 px; a wider transparent copy beneath the geometry takes the pointer, with copies of the arrows.
      if (interactive && hitLayer) hits.push(<g key={elementKey} data-cad-sketch-dimension-hit={relation.id} className="cad-sketch-graph-dimension-pick"
        onPointerEnter={pointerOver} onPointerMove={pointerOver} onPointerLeave={() => { leave(); if (pointed.current?.key === elementKey) point(null); }} onPointerDown={lineDown}
        onClick={event => { if (pressed.current === elementKey) click(event); }} onDoubleClick={event => { if (pressed.current === elementKey) doubleClick(event); }}>
        {measure()}
        {arrows()}
      </g>);
      return <g key={elementKey} data-cad-sketch-dimension={relation.id}
        data-cad-dimension-reference={reference || undefined} data-cad-dimension-kind={dimension.kind} data-cad-dimension-side={dimension.kind === 'setback' ? dimension.side : undefined}
        ref={element => { if (element) groups.current.set(elementKey, element); else groups.current.delete(elementKey); }}
        className={`cad-sketch-graph-dimension${tone}${interactive ? ' is-interactive' : ''}`}
        onPointerEnter={enter} onPointerLeave={leave} onPointerDown={down} onClick={click} onDoubleClick={doubleClick}>
        <g className="cad-sketch-graph-dimension-lines">
          {dimension.extensions.map((extension, index) => <g key={index}>{line(extension, 'cad-sketch-graph-dimension-extension')}</g>)}
          {measure('cad-sketch-graph-dimension-line')}
          {arrows('cad-sketch-graph-dimension-arrow')}
        </g>
        <g ref={element => { if (element) labels.current.set(elementKey, element); else labels.current.delete(elementKey); }} className="cad-sketch-graph-dimension-label" role="button" aria-label={`${reference ? 'Reference dimension' : 'Dimension'} ${name} ${quantity}${roles}, press Enter to edit`}
          aria-pressed={selected || inspected} aria-disabled={!interactive || undefined} tabIndex={interactive ? 0 : -1}
          transform={`translate(${dimension.label[0] - center[0]} ${dimension.label[1] - center[1]}) scale(${mmPerPixel} ${-mmPerPixel})${dimension.labelAngle ? ` rotate(${-dimension.labelAngle * 180 / Math.PI})` : ''}`}
          onKeyDown={key}>
          <rect className="cad-sketch-graph-dimension-hit" x={-width / 2 - 3} y={-(height + 6) / 2} width={width + 6} height={height + 6} />
          <text className="cad-sketch-graph-dimension-text" x={0} y={0} dominantBaseline="central" textAnchor="middle">{text}</text>
        </g>
      </g>;
    })}
  </g>;
  return <>{drawn}{hitLayer && hits.length > 0 && createPortal(hits, hitLayer)}</>;
}
