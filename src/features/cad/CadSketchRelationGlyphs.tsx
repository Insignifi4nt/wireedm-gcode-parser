import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { RelationCoincidentIcon, RelationCollinearIcon, RelationConcentricIcon, RelationEqualLengthIcon, RelationEqualRadiusIcon, RelationFixIcon, RelationHorizontalIcon,
  RelationMidpointIcon, RelationParallelIcon, RelationPerpendicularIcon, RelationPointOnCurveIcon, RelationPointOnLineIcon, RelationSymmetricIcon, RelationTangentIcon,
  RelationVerticalIcon, type WorkbenchIconComponent } from '@wire-edm/icons-react';
import type { CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { cadSketchDimensionPickOf, cadSketchHighlightRelationIds, createCadSketchDimensionKeys, type CadSketchDimensionPick, type CadSketchHighlightStore } from './cadSketchDimensionSelection';
import { CAD_SKETCH_RELATION_GLYPH_PIXELS, cadSketchRelationGlyphTransform, layoutCadSketchRelationGlyphs, type CadSketchRelationGlyph, type CadSketchRelationGlyphKind } from './cadSketchRelationGlyphLayout';
import type { SketchPoint } from './cadSketchInteraction';
import './cad-sketch-graph-dimensions.css';

/** One drawing per relation kind, shared with the Constrain menu and the relations list. */
export const CAD_SKETCH_RELATION_ICONS: Readonly<Record<CadSketchRelationGlyphKind, WorkbenchIconComponent>> = {
  horizontal: RelationHorizontalIcon, vertical: RelationVerticalIcon, parallel: RelationParallelIcon, perpendicular: RelationPerpendicularIcon, collinear: RelationCollinearIcon,
  'equal-length': RelationEqualLengthIcon, 'equal-radius': RelationEqualRadiusIcon, tangent: RelationTangentIcon, coincident: RelationCoincidentIcon, concentric: RelationConcentricIcon,
  midpoint: RelationMidpointIcon, symmetric: RelationSymmetricIcon, fix: RelationFixIcon, 'point-on-line': RelationPointOnLineIcon, 'point-on-curve': RelationPointOnCurveIcon
};

/** The geometry whose glyphs stay shown on a sketch above the glyph limit, and that lights its glyphs up as related. */
export interface CadSketchRelationGlyphFocus { readonly pointIds: readonly string[]; readonly entityIds: readonly string[] }
type GlyphEvent = { readonly clientX: number; readonly clientY: number; readonly target: EventTarget | null; readonly nativeEvent: Event };
export interface CadSketchRelationGlyphsProps {
  readonly graph: CadSketchGraph;
  readonly parameters: Readonly<Record<string, number>>;
  readonly center: SketchPoint;
  readonly mmPerPixel: number;
  /** Relation IDs of the selected annotations. */
  readonly selectedIds: readonly string[];
  /** The relation open in the relations list; its glyphs draw selected. */
  readonly inspectedRelationId?: string | null;
  /** Geometry a dock row or the selection names: its glyphs draw related, and above `limit` only glyphs on it, or selected, are shown. */
  readonly focus?: CadSketchRelationGlyphFocus | null;
  /** Above this many glyphs only the focused and selected ones are shown. */
  readonly limit: number;
  readonly interactive: boolean;
  readonly highlight?: CadSketchHighlightStore;
  /** Whether a sketch point or edge, a datum, a profile grip or a profile edge under the pointer keeps the pick from a glyph. */
  covered?(event: GlyphEvent): boolean;
  /** A plain click selects a glyph's relations, Shift toggles them and Escape clears with `null`. */
  onSelect?(picks: readonly CadSketchDimensionPick[] | null, additive: boolean): void;
  /** Double-click or Enter: the relation in the relations list. */
  onOpen?(pick: CadSketchDimensionPick): void;
  /** Delete or Backspace on a focused glyph; the owner removes its selection, or this glyph's relations while nothing is selected. */
  onDelete?(picks: readonly CadSketchDimensionPick[], key: 'Delete' | 'Backspace'): void;
  onMenu?(picks: readonly CadSketchDimensionPick[], at: { readonly clientX: number; readonly clientY: number }): void;
}
interface Shown extends CadSketchRelationGlyph { readonly mountKey: string; readonly picks: readonly CadSketchDimensionPick[] }
interface Actions {
  enter(key: string, event: GlyphEvent): void; leave(key: string): void; down(key: string, event: PointerEvent<SVGGElement>): void;
  click(key: string, event: MouseEvent<SVGGElement>): void; doubleClick(key: string, event: MouseEvent<SVGGElement>): void; keyDown(key: string, event: KeyboardEvent<SVGGElement>): void;
}
const NO_IDS: readonly string[] = Object.freeze([]);
const operandIn = (glyph: CadSketchRelationGlyph, focus: { readonly points: ReadonlySet<string>; readonly entities: ReadonlySet<string> }) => {
  const id = glyph.operand.slice(glyph.operand.indexOf(':') + 1);
  return glyph.operand.startsWith('point:') ? focus.points.has(id) : focus.entities.has(id);
};

/**
 * Relation glyphs: thin, quiet marks in the annotation colour on each point or edge a relation names. The layer lies beneath the
 * sketch points and edges, so they keep their own picks; a press on a glyph over geometry, a datum, a grip or a profile edge leaves it
 * to the canvas too. Rows render again only when their own place, selection or state changes; hover lights up through the shared store.
 */
export const CadSketchRelationGlyphs = memo(function CadSketchRelationGlyphs({ graph, parameters, center, mmPerPixel, selectedIds, inspectedRelationId, focus, limit, interactive,
  highlight, covered, onSelect, onOpen, onDelete, onMenu }: CadSketchRelationGlyphsProps) {
  const layout = useMemo(() => layoutCadSketchRelationGlyphs(graph, parameters), [graph, parameters]);
  // A glyph keeps its element while the graph names the same relations; a replacement under a reused ID mounts afresh and never inherits hover or focus.
  const [relationKeys] = useState(createCadSketchDimensionKeys);
  const keys = useMemo(() => relationKeys(graph), [relationKeys, graph]);
  const focusSets = useMemo(() => focus ? { points: new Set(focus.pointIds), entities: new Set(focus.entityIds) } : null, [focus]);
  const capped = layout.length > limit;
  const glyphs = useMemo(() => {
    const relations = new Map(graph.relations.map(relation => [relation.id, relation]));
    const selected = new Set(selectedIds);
    return layout.flatMap((glyph): Shown[] => {
      if (capped && !glyph.relationIds.some(id => selected.has(id) || id === inspectedRelationId) && !(focusSets && operandIn(glyph, focusSets))) return [];
      const picks = glyph.relationIds.flatMap(id => { const relation = relations.get(id); return relation ? [cadSketchDimensionPickOf(relation)] : []; });
      return [{ ...glyph, picks, mountKey: `${glyph.relationIds.map(id => keys.get(id) ?? id).join('+')}@${glyph.operand}` }];
    });
  }, [layout, graph, keys, capped, selectedIds, inspectedRelationId, focusSets]);
  const byKey = useRef(new Map<string, Shown>()); byKey.current = new Map(glyphs.map(glyph => [glyph.mountKey, glyph]));
  const elements = useRef(new Map<string, SVGGElement>());
  const layer = useRef<SVGGElement>(null);
  const hovered = useRef<string | null>(null), pressed = useRef<string | null>(null);
  const latest = useRef({ interactive, highlight, covered, onSelect, onOpen, onDelete, onMenu, selectedIds });
  latest.current = { interactive, highlight, covered, onSelect, onOpen, onDelete, onMenu, selectedIds };
  const hide = () => { if (hovered.current) latest.current.highlight?.hide(hovered.current); hovered.current = null; };
  const hideOnUnmount = useRef(hide); hideOnUnmount.current = hide;
  // A window that loses focus never sends the pointer leave, so it drops the hover too.
  useEffect(() => {
    const blur = () => hideOnUnmount.current();
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('blur', blur); hideOnUnmount.current(); };
  }, []);
  // A glyph that leaves the drawing or is replaced, or a layer that stops accepting picks, drops its hover; a hidden glyph gives its focus back to the canvas.
  useLayoutEffect(() => {
    const owner = hovered.current;
    if (owner && (!interactive || !byKey.current.has(owner.slice('glyph:'.length)))) hideOnUnmount.current();
    const focused = document.activeElement;
    if (!interactive && focused instanceof SVGElement && layer.current?.contains(focused)) layer.current.ownerSVGElement?.focus({ preventScroll: true });
  }, [glyphs, interactive]);
  const [actions] = useState<Actions>(() => {
    const glyphOf = (key: string) => byKey.current.get(key);
    const show = (key: string) => {
      const glyph = glyphOf(key), store = latest.current.highlight, owner = `glyph:${key}`;
      if (!glyph || !store || !latest.current.interactive) return;
      hovered.current = owner; store.show(owner, { kind: 'relations', relationIds: glyph.relationIds });
    };
    return {
      enter: (key, event) => {
        if (!latest.current.interactive) return;
        if (latest.current.covered?.(event)) { if (hovered.current === `glyph:${key}`) hide(); return; }
        if (hovered.current !== `glyph:${key}`) show(key);
      },
      leave: key => { if (hovered.current === `glyph:${key}`) hide(); },
      down: (key, event) => {
        // The canvas owns right and middle presses: a still right release opens this glyph's menu. Geometry, a datum, a grip or a
        // profile edge under the pointer keeps the left press, so it passes on to the canvas untouched.
        if (event.button !== 0) return;
        if (!latest.current.interactive || latest.current.covered?.(event)) { pressed.current = null; return; }
        pressed.current = key; event.preventDefault(); event.stopPropagation();
        if (event.isPrimary !== false) elements.current.get(key)?.focus({ preventScroll: true });
      },
      click: (key, event) => {
        if (event.button !== 0 || pressed.current !== key) return; event.preventDefault(); event.stopPropagation();
        const glyph = glyphOf(key);
        if (glyph && latest.current.interactive && event.detail <= 1) latest.current.onSelect?.(glyph.picks, event.shiftKey);
      },
      doubleClick: (key, event) => {
        if (pressed.current !== key) return; event.preventDefault(); event.stopPropagation();
        const glyph = glyphOf(key); if (glyph?.picks[0] && latest.current.interactive) latest.current.onOpen?.(glyph.picks[0]);
      },
      keyDown: (key, event) => {
        if (event.nativeEvent.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
        const menu = event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey, current = latest.current;
        // The glyph owns its keys, so they never reach the geometry selection behind it.
        const owned = event.key === 'Enter' || event.key === ' ' || event.key === 'Delete' || event.key === 'Backspace' || menu;
        if (!owned && !(event.key === 'Escape' && current.interactive && current.selectedIds.length > 0)) return;
        event.preventDefault(); event.stopPropagation();
        const glyph = glyphOf(key); if (!glyph || !current.interactive) return;
        if (event.key === 'Enter') { if (glyph.picks[0]) current.onOpen?.(glyph.picks[0]); }
        else if (event.key === ' ') current.onSelect?.(glyph.picks, event.shiftKey);
        else if (event.key === 'Escape') current.onSelect?.(null, false);
        else if (menu) { const box = event.currentTarget.getBoundingClientRect(); current.onMenu?.(glyph.picks, { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }); }
        else current.onDelete?.(glyph.picks, event.key === 'Delete' ? 'Delete' : 'Backspace');
      }
    };
  });
  const selected = new Set(selectedIds);
  if (!glyphs.length) return null;
  return <g ref={layer} className={`cad-sketch-relation-glyphs${interactive ? ' is-interactive' : ''}`} role="group" aria-label="Sketch relations on the canvas">
    {glyphs.map(glyph => <RelationGlyphRow key={glyph.mountKey} glyphKey={glyph.mountKey} relationIds={glyph.relationIds.join(' ')} kind={glyph.kind} label={glyph.label}
      x={glyph.anchor[0] - center[0]} y={glyph.anchor[1] - center[1]} dx={glyph.offset[0]} dy={glyph.offset[1]} mmPerPixel={mmPerPixel}
      selected={glyph.relationIds.some(id => selected.has(id) || id === inspectedRelationId)} related={Boolean(focusSets && operandIn(glyph, focusSets))}
      interactive={interactive} actions={actions} elements={elements.current} />)}
    {highlight && <RelationGlyphHighlight store={highlight} glyphs={glyphs} center={center} mmPerPixel={mmPerPixel} />}
  </g>;
});

const RelationGlyphRow = memo(function RelationGlyphRow({ glyphKey, relationIds, kind, label, x, y, dx, dy, mmPerPixel, selected, related, interactive, actions, elements }: {
  glyphKey: string; relationIds: string; kind: CadSketchRelationGlyphKind; label: string; x: number; y: number; dx: number; dy: number; mmPerPixel: number;
  selected: boolean; related: boolean; interactive: boolean; actions: Actions; elements: Map<string, SVGGElement>;
}) {
  const Icon = CAD_SKETCH_RELATION_ICONS[kind], half = CAD_SKETCH_RELATION_GLYPH_PIXELS.size / 2;
  return <g data-cad-sketch-relation-glyph={relationIds} data-cad-relation-glyph-kind={kind}
    ref={element => { if (element) elements.set(glyphKey, element); else elements.delete(glyphKey); }}
    className={`cad-sketch-relation-glyph${selected ? ' is-selected' : related ? ' is-related' : ''}${interactive ? ' is-interactive' : ''}`}
    role="button" aria-label={label} aria-pressed={selected} aria-disabled={!interactive || undefined} tabIndex={interactive ? 0 : -1} pointerEvents={interactive ? undefined : 'none'}
    transform={cadSketchRelationGlyphTransform(x, y, mmPerPixel, dx, dy)}
    onPointerEnter={event => actions.enter(glyphKey, event)} onPointerMove={event => actions.enter(glyphKey, event)} onPointerLeave={() => actions.leave(glyphKey)}
    onPointerDown={event => actions.down(glyphKey, event)} onClick={event => actions.click(glyphKey, event)} onDoubleClick={event => actions.doubleClick(glyphKey, event)}
    onKeyDown={event => actions.keyDown(glyphKey, event)}>
    <rect className="cad-sketch-relation-glyph-box" x={-half - 1} y={-half - 1} width={2 * half + 2} height={2 * half + 2} rx={2} />
    <Icon className="cad-sketch-relation-glyph-icon" size={2 * half - 2} x={-half + 1} y={-half + 1} strokeWidth={2} />
  </g>;
});

/** Rings the glyphs of the hovered relation, or of a hovered dock row, as the only subscriber here, so hover renders no glyph rows. */
const RelationGlyphHighlight = memo(function RelationGlyphHighlight({ store, glyphs, center, mmPerPixel }: { store: CadSketchHighlightStore; glyphs: readonly Shown[]; center: SketchPoint; mmPerPixel: number }) {
  const source = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const ids = cadSketchHighlightRelationIds(source);
  if (!ids.length || ids === NO_IDS) return null;
  const lit = glyphs.filter(glyph => glyph.relationIds.some(id => ids.includes(id))), half = CAD_SKETCH_RELATION_GLYPH_PIXELS.size / 2 + 2;
  if (!lit.length) return null;
  return <g className="cad-sketch-relation-glyph-highlight" pointerEvents="none" aria-hidden="true">
    {lit.map(glyph => <rect key={glyph.mountKey} data-cad-highlight-glyph={glyph.relationIds.join(' ')} rx={3} x={-half} y={-half} width={2 * half} height={2 * half}
      transform={cadSketchRelationGlyphTransform(glyph.anchor[0] - center[0], glyph.anchor[1] - center[1], mmPerPixel, glyph.offset[0], glyph.offset[1])} />)}
  </g>;
});
