import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { RelationCoincidentIcon, RelationCollinearIcon, RelationConcentricIcon, RelationEqualLengthIcon, RelationEqualRadiusIcon, RelationFixIcon, RelationHorizontalIcon,
  RelationMidpointIcon, RelationParallelIcon, RelationPerpendicularIcon, RelationPointOnCurveIcon, RelationPointOnLineIcon, RelationSymmetricIcon, RelationTangentIcon,
  RelationVerticalIcon, type WorkbenchDrawnIconComponent } from '@wire-edm/icons-react';
import type { CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { cadSketchDimensionPickOf, cadSketchHighlightRelationIds, cadSketchPointIdentity, createCadSketchDimensionKeys, isCadSketchGlyphRelation, type CadSketchDimensionPick,
  type CadSketchHighlightSource, type CadSketchHighlightStore } from './cadSketchDimensionSelection';
import { CAD_SKETCH_RELATION_GLYPH_PIXELS, cadSketchRelationGlyphEntries, cadSketchRelationGlyphOverlaps, cadSketchRelationGlyphPaintOrder, cadSketchRelationGlyphPixel,
  cadSketchRelationGlyphPlate, placeCadSketchRelationGlyphs, type CadSketchRelationGlyph, type CadSketchRelationGlyphHolds, type CadSketchRelationGlyphKind } from './cadSketchRelationGlyphLayout';
import { joinedPathData, placedPathData } from './cadSketchRelationGlyphDrawing';
import type { SketchPoint } from './cadSketchInteraction';
import './cad-sketch-graph-dimensions.css';

/** One drawing per relation kind, shared with the Constrain menu and the relations list; the canvas layer draws their `paths` itself. */
export const CAD_SKETCH_RELATION_ICONS: Readonly<Record<CadSketchRelationGlyphKind, WorkbenchDrawnIconComponent>> = {
  horizontal: RelationHorizontalIcon, vertical: RelationVerticalIcon, parallel: RelationParallelIcon, perpendicular: RelationPerpendicularIcon, collinear: RelationCollinearIcon,
  'equal-length': RelationEqualLengthIcon, 'equal-radius': RelationEqualRadiusIcon, tangent: RelationTangentIcon, coincident: RelationCoincidentIcon, concentric: RelationConcentricIcon,
  midpoint: RelationMidpointIcon, symmetric: RelationSymmetricIcon, fix: RelationFixIcon, 'point-on-line': RelationPointOnLineIcon, 'point-on-curve': RelationPointOnCurveIcon
};

/** The geometry whose glyphs stay shown on a sketch above the glyph limit, and that lights its glyphs up as related. */
export interface CadSketchRelationGlyphFocus { readonly pointIds: readonly string[]; readonly entityIds: readonly string[] }
type GlyphEvent = { readonly clientX: number; readonly clientY: number; readonly target: EventTarget | null; readonly nativeEvent: Event };
export interface CadSketchRelationGlyphsProps {
  /** The graph drawn, which a drag preview replaces every frame. */
  readonly graph: CadSketchGraph;
  /** The graph whose relations, edges and point IDs `graph` shares, which names the glyphs; it changes only on an edit. Defaults to `graph`. */
  readonly topology?: CadSketchGraph;
  readonly parameters: Readonly<Record<string, number>>;
  /** The parameters `topology` is drawn with, which a drag keeps, so the glyphs it leaves in place are placed once. Defaults to `parameters`. */
  readonly topologyParameters?: Readonly<Record<string, number>>;
  readonly center: SketchPoint;
  readonly mmPerPixel: number;
  /** Relation IDs of the selected annotations. */
  readonly selectedIds: readonly string[];
  /** The relation open in the relations list; its glyphs draw selected. */
  readonly inspectedRelationId?: string | null;
  /**
   * Geometry a dock row or the selection names: the glyphs of relations that hold it draw related, and above `limit` only those, the
   * selected ones and the ones the pointer rests on are shown.
   */
  readonly focus?: CadSketchRelationGlyphFocus | null;
  /** Above this many glyphs only the focused and selected ones are shown, and those of what the pointer rests on in Select. */
  readonly limit: number;
  /** Whether the glyphs take the pointer and their commands; a drag or an applying edit turns the layer off without rendering a row. */
  readonly interactive: boolean;
  /** Whether the glyphs are tab stops: in Select, outside a pending path or a pick. Defaults to `interactive`. */
  readonly focusable?: boolean;
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
type GlyphState = 'plain' | 'related' | 'selected';
interface Shown extends CadSketchRelationGlyph {
  readonly mountKey: string;
  /** The glyph's centre in the layer's screen pixels. */
  readonly x: number; readonly y: number;
  /** Whether a drag has moved it from where the sketch as last edited places it. */
  readonly moved: boolean;
  readonly state: GlyphState;
}
interface Actions {
  enter(key: string, event: GlyphEvent): void; leave(key: string): void; down(key: string, event: PointerEvent<SVGGElement>): void;
  click(key: string, event: MouseEvent<SVGGElement>): void; doubleClick(key: string, event: MouseEvent<SVGGElement>): void; keyDown(key: string, event: KeyboardEvent<SVGGElement>): void;
  focus(key: string, focused: boolean): void;
}
interface Geometry { readonly points: ReadonlySet<string>; readonly entities: ReadonlySet<string> }
type Pointed = { readonly kind: 'point' | 'entity'; readonly id: string } | null;
interface GlyphPath { readonly key: string; readonly part: 'plates' | 'icons'; readonly state: GlyphState; readonly data: string }
/** The glyphs the shared paths draw, in drawing order, with each one's paint layer. */
interface Batch { readonly glyphs: readonly Shown[]; readonly layers: readonly number[] }
const holdsIn = (glyph: { readonly holds: CadSketchRelationGlyphHolds }, geometry: Geometry | null) =>
  Boolean(geometry && (glyph.holds.points.some(id => geometry.points.has(id)) || glyph.holds.entities.some(id => geometry.entities.has(id))));
const STATES: readonly GlyphState[] = ['plain', 'related', 'selected'];

/** Each kind's icon, 10 px wide on its 14 px plate, as path data placed by its centre. */
const drawings = new Map<CadSketchRelationGlyphKind, (x: number, y: number) => string>();
function drawing(kind: CadSketchRelationGlyphKind) {
  let draw = drawings.get(kind);
  if (!draw) { draw = placedPathData(CAD_SKETCH_RELATION_ICONS[kind].paths, 24, CAD_SKETCH_RELATION_GLYPH_PIXELS.size - 2); drawings.set(kind, draw); }
  return draw;
}

/** A placed glyph in the layer's screen pixels, with the mount key that keeps its element while its relations keep their keys. */
function shownGlyph(glyph: CadSketchRelationGlyph, center: SketchPoint, mmPerPixel: number, keys: ReadonlyMap<string, string>, moved: boolean, state: GlyphState): Shown {
  const [x, y] = cadSketchRelationGlyphPixel(glyph, center, mmPerPixel);
  return { ...glyph, mountKey: `${glyph.relationIds.map(id => keys.get(id) ?? id).join('+')}@${glyph.operand}`, x, y, moved, state };
}

/** A glyph's plate, the rounded square its row draws, as path data placed by its centre. */
const PLATE = cadSketchRelationGlyphPlate(0, 0);
const drawPlate = placedPathData([`M2 0H${PLATE.width - 2}A2 2 0 0 1 ${PLATE.width} 2V${PLATE.height - 2}A2 2 0 0 1 ${PLATE.width - 2} ${PLATE.height}H2A2 2 0 0 1 0 ${PLATE.height - 2}V2A2 2 0 0 1 2 0Z`],
  PLATE.width, PLATE.width);

/** The shown glyphs by mount key, built when a command or a hover first asks, so a drag frame builds none. */
const mountKeyed = new WeakMap<readonly Shown[], ReadonlyMap<string, Shown>>();
function glyphsByMountKey(glyphs: readonly Shown[]) {
  let byKey = mountKeyed.get(glyphs);
  if (!byKey) { byKey = new Map(glyphs.map(glyph => [glyph.mountKey, glyph])); mountKeyed.set(glyphs, byKey); }
  return byKey;
}

/** A placed glyph's plate or icon as path data, placed once for each placement, so a view change places them again and nothing else does. */
const iconData = new WeakMap<Shown, string>(), plateData = new WeakMap<Shown, string>();
function placedData(glyph: Shown, part: GlyphPath['part']) {
  const cache = part === 'plates' ? plateData : iconData;
  let data = cache.get(glyph);
  if (data === undefined) { data = part === 'plates' ? drawPlate(glyph.x, glyph.y) : drawing(glyph.kind)(glyph.x, glyph.y); cache.set(glyph, data); }
  return data;
}
/**
 * The plates and icons of the given glyphs, in the paint layers `layers` gives them, as one path per layer, part and state: each layer's
 * plates, then its icons, the layers in turn. No two plates of one layer overlap, so a glyph's icon never paints over a later glyph's plate.
 */
function glyphPaths(glyphs: readonly Shown[], layers: readonly number[], moved: boolean): readonly GlyphPath[] {
  const grouped: Map<GlyphState, Shown[]>[] = [];
  glyphs.forEach((glyph, index) => {
    const states = grouped[layers[index]] ??= new Map();
    let list = states.get(glyph.state); if (!list) states.set(glyph.state, list = []);
    list.push(glyph);
  });
  const paths: GlyphPath[] = [];
  grouped.forEach((states, layer) => {
    for (const part of ['plates', 'icons'] as const) for (const state of STATES) {
      const list = states.get(state);
      if (list) paths.push({ key: `${moved ? 'moved-' : ''}${layer}-${part}-${state}`, part, state, data: joinedPathData(list.map(glyph => placedData(glyph, part))) });
    }
  });
  return paths;
}
/** The shown glyphs the hovered relation, or a hovered dock row, lights up. */
function litGlyphs(source: CadSketchHighlightSource | null, glyphs: readonly Shown[]) {
  const ids = cadSketchHighlightRelationIds(source);
  return ids.length ? glyphs.filter(glyph => glyph.relationIds.some(id => ids.includes(id))) : [];
}

/** How long the pointer rests on one target before a sketch above the glyph limit shows the glyphs of its relations. */
export const CAD_SKETCH_RELATION_GLYPH_REVEAL_MS = 120;
/** How long empty canvas keeps the glyphs that geometry revealed, so the pointer can cross from the geometry to one of them. */
const REVEAL_LINGER_MS = 400;
/** What hover reveals above the glyph limit: the relation or geometry a hovered glyph, dimension or dock row names, and the sketch point or edge under the pointer. */
interface Revealed { readonly source: CadSketchHighlightSource | null; readonly pointed: Pointed }
const NOTHING_REVEALED: Revealed = Object.freeze({ source: null, pointed: null });
const samePointed = (a: Pointed, b: Pointed) => a === b || Boolean(a && b && a.kind === b.kind && a.id === b.id);

/**
 * Above the glyph limit, what the pointer has rested on. A target reveals the glyphs of its relations once the pointer has stayed on it for
 * CAD_SKETCH_RELATION_GLYPH_REVEAL_MS, and every change of target starts the wait again. What the last target showed stays until the next
 * one has rested, so a pointer passing over the sketch renders nothing, which measured cheaper than hiding at once. Moving onto a glyph
 * keeps the geometry's glyphs, and empty canvas lets them go after a moment, so the pointer can cross the gap to one. Turning off, as a
 * drag, an applying edit or a tool other than Select does, a new `scope`, which an edit or another sketch brings, the pointer leaving the
 * canvas and unmounting each drop the pending reveal and what is shown. Below the limit nothing listens.
 */
function useRestingReveal(layer: SVGGElement | null, highlight: CadSketchHighlightStore | undefined, enabled: boolean, scope: unknown): Revealed {
  const [revealed, setRevealed] = useState(NOTHING_REVEALED);
  useEffect(() => {
    const canvas = layer?.ownerSVGElement;
    if (!enabled || !canvas) return;
    // The targets under the pointer now, and what has been shown for them.
    let source: CadSketchHighlightSource | null = null, pointed: Pointed = null, shown = NOTHING_REVEALED;
    let sourceTimer: ReturnType<typeof setTimeout> | undefined, pointedTimer: ReturnType<typeof setTimeout> | undefined;
    const show = (next: Partial<Revealed>) => {
      const value: Revealed = { ...shown, ...next };
      if (value.source === shown.source && samePointed(value.pointed, shown.pointed)) return;
      shown = value; setRevealed(value);
    };
    // The store publishes only when its source changes, so a new snapshot is a new target.
    const followSource = () => {
      const next = highlight?.getSnapshot() ?? null;
      if (next === source) return;
      source = next; clearTimeout(sourceTimer);
      if (next !== shown.source) sourceTimer = setTimeout(() => show({ source: next }), CAD_SKETCH_RELATION_GLYPH_REVEAL_MS);
    };
    const point = (next: Pointed) => {
      if (samePointed(next, pointed)) return;
      pointed = next; clearTimeout(pointedTimer);
      if (!samePointed(next, shown.pointed)) pointedTimer = setTimeout(() => show({ pointed: next }), next ? CAD_SKETCH_RELATION_GLYPH_REVEAL_MS : REVEAL_LINGER_MS);
    };
    const over = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      const geometry = target?.closest('[data-cad-sketch-point], [data-cad-sketch-entity]');
      const pointId = geometry?.getAttribute('data-cad-sketch-point'), edge = geometry?.getAttribute('data-cad-sketch-entity');
      if (pointId) point({ kind: 'point', id: pointId });
      else if (edge) point({ kind: 'entity', id: edge });
      // Reaching a glyph keeps the geometry that revealed it, across empty canvas too, and drops a reveal still waiting for its rest.
      else if (target?.closest('[data-cad-sketch-relation-glyph]')) point(shown.pointed);
      else point(null);
    };
    const leave = () => {
      clearTimeout(sourceTimer); clearTimeout(pointedTimer);
      source = highlight?.getSnapshot() ?? null; pointed = null; show(NOTHING_REVEALED);
    };
    const unsubscribe = highlight?.subscribe(followSource);
    followSource();
    canvas.addEventListener('pointerover', over); canvas.addEventListener('pointerleave', leave);
    return () => {
      clearTimeout(sourceTimer); clearTimeout(pointedTimer); unsubscribe?.();
      canvas.removeEventListener('pointerover', over); canvas.removeEventListener('pointerleave', leave); setRevealed(NOTHING_REVEALED);
    };
  }, [layer, highlight, enabled, scope]);
  return enabled ? revealed : NOTHING_REVEALED;
}

/**
 * Relation glyphs: thin, quiet marks in the annotation colour on each point or edge a relation names. The layer lies beneath the dimension
 * lines, the sketch points and the edges, so they keep their own picks; a press on a glyph over geometry, a datum, a grip or a profile edge
 * leaves it to the canvas too. The glyphs at rest paint as a few paths in one scaled group: their plates as one path per state and their
 * icons as one path per state, so every repaint of the sketch, as each hover move brings, paints a few items per layer rather than per glyph,
 * and the layers below count how deeply glyphs overlap, not how many there are.
 * Each glyph keeps one row, which takes its pointer, focus and accessible name through a plate that paints nothing; a selected or focused
 * glyph leaves the paths and draws in its row, and a lit one keeps its place in them and draws a copy on top with its ring, so the paths
 * are joined again only on a selection, a focus, a drag that moves glyphs or a view change, never on a pointer move. Where plates overlap,
 * the glyph drawn on top is the later one, whose row the pointer finds first, whatever the glyphs' states: the shared paths paint in layers
 * that no two overlapping plates share, a later layer for a later glyph, the rows draw after them, and every later glyph that overlaps a
 * glyph drawn in its row draws in its own row too, while a lit copy draws only for a glyph that no later glyph overlaps. A drag renders
 * no row: it hides the rows of the glyphs it moves and draws those glyphs as paths of their own beside the layer, so a frame writes only
 * those paths. Meanwhile the layer, unchanged, has a compositor layer of its own, so the sketch repainting
 * each frame rasters no other glyph again. Rows render again only when their own place, selection, focus or state changes; hover lights
 * up through the shared store. Above the limit, hover changes which glyphs are drawn only once the pointer rests, so moving across a large
 * sketch renders no row.
 */
export const CadSketchRelationGlyphs = memo(function CadSketchRelationGlyphs({ graph, topology = graph, parameters, topologyParameters = parameters, center, mmPerPixel, selectedIds,
  inspectedRelationId, focus, limit, interactive, focusable = interactive, highlight, covered, onSelect, onOpen, onDelete, onMenu }: CadSketchRelationGlyphsProps) {
  // Naming and stacking follow the topology; a drag only places the shown entries again.
  const entries = useMemo(() => cadSketchRelationGlyphEntries(topology), [topology]);
  // A glyph keeps its element while the graph names the same relations; a replacement under a reused ID mounts afresh and never inherits hover or focus.
  const [relationKeys] = useState(() => createCadSketchDimensionKeys(isCadSketchGlyphRelation));
  // A glyph relation compares by its own operands, and a drag keeps the topology, so it keeps every key without comparing again.
  const keys = useMemo(() => relationKeys(topology), [relationKeys, topology.relations]);
  const identity = cadSketchPointIdentity(topology);
  const capped = entries.length > limit;
  const [layerElement, setLayerElement] = useState<SVGGElement | null>(null);
  // Only a sketch above the limit follows hover, because only there does hover change which glyphs are drawn, and only while the glyphs
  // take the pointer, in Select outside a drag, an applying edit or a pick. An edit or another sketch starts afresh.
  const { source, pointed } = useRestingReveal(layerElement, highlight, capped && interactive, topology);
  // Geometry compares by Coincident identity, as the glyphs name it.
  const focusSets = useMemo((): Geometry | null => focus ? { points: new Set(focus.pointIds.map(identity)), entities: new Set(focus.entityIds) } : null, [focus, identity]);
  const shownEntries = useMemo(() => {
    if (!capped) return entries;
    const named = new Set([...selectedIds, ...inspectedRelationId ? [inspectedRelationId] : [], ...cadSketchHighlightRelationIds(source)]);
    // Hovered geometry, on the canvas or in a dock row that names geometry rather than relations.
    const points = new Set<string>(), edges = new Set<string>();
    if (source?.kind === 'geometry' && source.relationIds === undefined) { for (const id of source.pointIds) points.add(identity(id)); for (const id of source.entityIds) edges.add(id); }
    if (pointed?.kind === 'point') points.add(identity(pointed.id)); else if (pointed) edges.add(pointed.id);
    const hovered: Geometry = { points, entities: edges };
    return entries.filter(entry => entry.relationIds.some(id => named.has(id)) || holdsIn(entry, focusSets) || holdsIn(entry, hovered));
  }, [entries, capped, selectedIds, inspectedRelationId, focusSets, source, pointed, identity]);
  // Where the sketch as last edited places the shown glyphs, with their screen place, state and mount key. A drag keeps all of it, places
  // the glyphs again against it and reuses every glyph it leaves in place, so a frame builds only the moved glyphs and their icon path.
  const resting = useMemo(() => placeCadSketchRelationGlyphs(topology, topologyParameters, shownEntries), [topology, topologyParameters, shownEntries]);
  const stateOf = useMemo(() => {
    const selected = new Set(selectedIds);
    return (glyph: CadSketchRelationGlyph): GlyphState => glyph.relationIds.some(id => selected.has(id) || id === inspectedRelationId) ? 'selected' : holdsIn(glyph, focusSets) ? 'related' : 'plain';
  }, [selectedIds, inspectedRelationId, focusSets]);
  const atRest = useMemo(() => new Map(resting.map(glyph => [glyph, shownGlyph(glyph, center, mmPerPixel, keys, false, stateOf(glyph))])), [resting, center, mmPerPixel, keys, stateOf]);
  const rows = useMemo(() => [...atRest.values()], [atRest]);
  const dragging = graph !== topology;
  const glyphs = useMemo(() => !dragging ? rows : placeCadSketchRelationGlyphs(graph, parameters, shownEntries, resting)
    .map(glyph => atRest.get(glyph) ?? shownGlyph(glyph, center, mmPerPixel, keys, true, stateOf(glyph))), [dragging, rows, graph, parameters, shownEntries, resting, atRest, center, mmPerPixel, keys, stateOf]);
  // The rows stay where the sketch as last edited places them, and a drag only hides the ones it moves, so a frame renders no row. The moved
  // glyphs draw their plates and icons as one path per state beside the layer, so the layer, composited apart during the drag, stays as it
  // was; the others keep their paths, joined once when the drag starts moving them.
  const movedKeys = glyphs.flatMap(glyph => glyph.moved ? [glyph.mountKey] : []).join('\n');
  const hidden = useMemo(() => new Set(movedKeys ? movedKeys.split('\n') : []), [movedKeys]);
  // The glyph a key or a press has focused draws in its row, so its focus ring shows; a selected one does too, and so does every later
  // glyph that overlaps one drawn in its row, so it stays drawn over it. The others paint in the shared paths, a later layer for a later
  // glyph where they overlap, and a lit one draws a copy on top only where no later glyph overlaps it. A pointer move changes none of it.
  const overlaps = useMemo(() => cadSketchRelationGlyphOverlaps(rows), [rows]);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const order = useMemo(() => cadSketchRelationGlyphPaintOrder(overlaps, index => rows[index].state === 'selected' || rows[index].mountKey === focusedKey,
    index => hidden.has(rows[index].mountKey)), [overlaps, rows, focusedKey, hidden]);
  const batch = useMemo((): Batch => {
    const batched: Shown[] = [], layers: number[] = [];
    rows.forEach((glyph, index) => { if (order.layers[index] >= 0) { batched.push(glyph); layers.push(order.layers[index]); } });
    return { glyphs: batched, layers };
  }, [rows, order]);
  const copied = useMemo(() => new Set(rows.filter((_, index) => order.layers[index] >= 0 && !order.covered[index])), [rows, order]);
  const moved = hidden.size ? glyphs.filter(glyph => glyph.moved) : [];
  const movedPaths = moved.length ? glyphPaths(moved, cadSketchRelationGlyphPaintOrder(cadSketchRelationGlyphOverlaps(moved), () => false).layers, true) : [];
  const shown = useRef(glyphs); shown.current = glyphs;
  const elements = useRef(new Map<string, SVGGElement>());
  const layer = useRef<SVGGElement | null>(null);
  const attachLayer = useCallback((element: SVGGElement | null) => { layer.current = element; setLayerElement(element); }, []);
  const hovered = useRef<string | null>(null), pressed = useRef<string | null>(null);
  const latest = useRef({ graph, interactive, highlight, covered, onSelect, onOpen, onDelete, onMenu, selectedIds });
  latest.current = { graph, interactive, highlight, covered, onSelect, onOpen, onDelete, onMenu, selectedIds };
  const hide = () => { if (hovered.current) latest.current.highlight?.hide(hovered.current); hovered.current = null; };
  const hideOnUnmount = useRef(hide); hideOnUnmount.current = hide;
  // A window that loses focus never sends the pointer leave, so it drops the hover too.
  useEffect(() => {
    const blur = () => hideOnUnmount.current();
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('blur', blur); hideOnUnmount.current(); };
  }, []);
  // A glyph that leaves the drawing or is replaced, or a layer that stops accepting picks, drops its hover; glyphs that stop being tab stops give their focus back to the canvas.
  useLayoutEffect(() => {
    const owner = hovered.current;
    if (owner && (!interactive || !glyphsByMountKey(glyphs).has(owner.slice('glyph:'.length)))) hideOnUnmount.current();
    const focused = document.activeElement;
    if (!focusable && focused instanceof SVGElement && layer.current?.contains(focused)) layer.current.ownerSVGElement?.focus({ preventScroll: true });
  }, [glyphs, interactive, focusable]);
  const [actions] = useState<Actions>(() => {
    const glyphOf = (key: string) => glyphsByMountKey(shown.current).get(key);
    // The relations a glyph names, as the graph it was drawn from holds them; picks are made only when a command needs them.
    const picksOf = (glyph: Shown | undefined) => glyph ? glyph.relationIds.flatMap(id => {
      const relation = latest.current.graph.relations.find(item => item.id === id);
      return relation && isCadSketchGlyphRelation(relation) ? [cadSketchDimensionPickOf(relation)] : [];
    }) : [];
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
        const picks = picksOf(glyphOf(key));
        if (picks.length && latest.current.interactive && event.detail <= 1) latest.current.onSelect?.(picks, event.shiftKey);
      },
      doubleClick: (key, event) => {
        if (pressed.current !== key) return; event.preventDefault(); event.stopPropagation();
        const pick = picksOf(glyphOf(key))[0]; if (pick && latest.current.interactive) latest.current.onOpen?.(pick);
      },
      keyDown: (key, event) => {
        if (event.nativeEvent.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
        const menu = event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey, current = latest.current;
        // The glyph owns its keys, so they never reach the geometry selection behind it.
        const owned = event.key === 'Enter' || event.key === ' ' || event.key === 'Delete' || event.key === 'Backspace' || menu;
        if (!owned && !(event.key === 'Escape' && current.interactive && current.selectedIds.length > 0)) return;
        event.preventDefault(); event.stopPropagation();
        const picks = picksOf(glyphOf(key)); if (!picks.length || !current.interactive) return;
        if (event.key === 'Enter') current.onOpen?.(picks[0]);
        else if (event.key === ' ') current.onSelect?.(picks, event.shiftKey);
        else if (event.key === 'Escape') current.onSelect?.(null, false);
        else if (menu) { const box = event.currentTarget.getBoundingClientRect(); current.onMenu?.(picks, { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }); }
        else current.onDelete?.(picks, event.key === 'Delete' ? 'Delete' : 'Backspace');
      },
      focus: (key, focused) => setFocusedKey(current => focused ? key : current === key ? null : current)
    };
  });
  // Above the limit the layer stays mounted with no glyph shown, so it can follow the geometry under the pointer.
  if (!glyphs.length && !capped) return null;
  const scale = `scale(${mmPerPixel} ${-mmPerPixel})`;
  return <>
    <g ref={attachLayer} className={`cad-sketch-relation-glyphs${interactive ? ' is-interactive' : ''}${dragging ? ' is-dragging' : ''}`} role={glyphs.length ? 'group' : undefined}
      aria-label={glyphs.length ? 'Sketch relations on the canvas' : undefined} pointerEvents={interactive ? undefined : 'none'} transform={scale}>
      <RelationGlyphBatch batch={batch} />
      <RelationGlyphRows glyphs={rows} own={order.own} hidden={hidden} focusable={focusable} actions={actions} elements={elements.current} />
      {highlight && glyphs.length > 0 && <RelationGlyphHighlight store={highlight} glyphs={glyphs} copied={copied} />}
    </g>
    {movedPaths.length > 0 && <g className="cad-sketch-relation-glyphs-moved" pointerEvents="none" aria-hidden="true" transform={scale}>{movedPaths.map(drawGlyphPath)}</g>}
  </>;
});

const drawGlyphPath = (path: GlyphPath) => <path key={path.key} className={`cad-sketch-relation-glyph-${path.part} is-${path.state}`} d={path.data} aria-hidden="true" />;

/**
 * The glyphs at rest, lit or not, layer by layer: each layer's plates, then its icons, as one path per state. Each glyph's data is placed
 * once for each view, and the paths are joined again only when the glyphs they hold change, as a selection, a focus, a drag moving them or
 * a view change does. A hover that lights glyphs draws their copies on top, so it renders nothing here.
 */
const RelationGlyphBatch = memo(function RelationGlyphBatch({ batch }: { batch: Batch }) {
  return glyphPaths(batch.glyphs, batch.layers, false).map(drawGlyphPath);
});

/**
 * The glyph rows in layout order, which a drag leaves as they are apart from hiding the glyphs it moves. Where plates overlap, the pointer
 * finds the later row first, and the later glyph is drawn on top: `own` names the glyphs that draw in their rows, after the shared paths.
 */
const RelationGlyphRows = memo(function RelationGlyphRows({ glyphs, own, hidden, focusable, actions, elements }: {
  glyphs: readonly Shown[]; own: readonly boolean[]; hidden: ReadonlySet<string>; focusable: boolean; actions: Actions; elements: Map<string, SVGGElement>;
}) {
  return glyphs.map((glyph, index) => <RelationGlyphRow key={glyph.mountKey} glyphKey={glyph.mountKey} relationIds={glyph.relationIds.join(' ')} kind={glyph.kind} label={glyph.label}
    x={glyph.x} y={glyph.y} state={glyph.state} hidden={hidden.has(glyph.mountKey)} own={own[index]} focusable={focusable} actions={actions} elements={elements} />);
});

/**
 * A glyph's row: its pick, focus and accessible name. Its plate takes the pointer without painting while the glyph draws in the layer's
 * shared paths, so a row at rest adds nothing to a repaint; a selected or focused glyph, and a later one over it, draws its plate and icon
 * here instead.
 */
const RelationGlyphRow = memo(function RelationGlyphRow({ glyphKey, relationIds, kind, label, x, y, state, hidden, own, focusable, actions, elements }: {
  glyphKey: string; relationIds: string; kind: CadSketchRelationGlyphKind; label: string; x: number; y: number; state: GlyphState; hidden: boolean; own: boolean;
  focusable: boolean; actions: Actions; elements: Map<string, SVGGElement>;
}) {
  // A glyph that leaves the drawing while focused, because its relation was removed, Show relations hid it or the limit left it out,
  // gives its focus back to the canvas, so the canvas keys keep working.
  const attach = useCallback((element: SVGGElement | null) => {
    if (!element) return;
    elements.set(glyphKey, element);
    return () => {
      if (elements.get(glyphKey) === element) elements.delete(glyphKey);
      if (element === document.activeElement) { actions.focus(glyphKey, false); element.ownerSVGElement?.focus({ preventScroll: true }); }
    };
  }, [elements, glyphKey, actions]);
  const plate = cadSketchRelationGlyphPlate(x, y);
  return <g data-cad-sketch-relation-glyph={relationIds} data-cad-relation-glyph-kind={kind} ref={attach}
    className={`cad-sketch-relation-glyph${state === 'plain' ? '' : ` is-${state}`}${focusable ? ' is-interactive' : ''}${hidden ? ' is-moved' : ''}`}
    role="button" aria-label={label} aria-pressed={state === 'selected'} aria-disabled={!focusable || undefined} tabIndex={focusable ? 0 : -1} pointerEvents={focusable ? undefined : 'none'}
    visibility={hidden ? 'hidden' : undefined}
    onPointerEnter={event => actions.enter(glyphKey, event)} onPointerMove={event => actions.enter(glyphKey, event)} onPointerLeave={() => actions.leave(glyphKey)}
    onPointerDown={event => actions.down(glyphKey, event)} onClick={event => actions.click(glyphKey, event)} onDoubleClick={event => actions.doubleClick(glyphKey, event)}
    onKeyDown={event => actions.keyDown(glyphKey, event)} onFocus={() => actions.focus(glyphKey, true)} onBlur={() => actions.focus(glyphKey, false)}>
    <rect x={plate.x} y={plate.y} width={plate.width} height={plate.height} rx={2} visibility={own ? undefined : 'hidden'} />
    {own && <path className={`cad-sketch-relation-glyph-icons is-${state}`} d={drawing(kind)(x, y)} />}
  </g>;
});

/**
 * Rings the glyphs of the hovered relation, or of a hovered dock row, and draws a copy on top of each lit glyph in `copied`, those the
 * shared paths draw and no later glyph overlaps, as the only subscriber here below the limit, so hover neither renders a glyph row nor
 * joins the shared paths. A copy over a later glyph would cover the glyph the pointer finds there, so a lit glyph under one gains only its
 * ring, an outline that takes no pointer and leaves every glyph it crosses showing.
 */
const RelationGlyphHighlight = memo(function RelationGlyphHighlight({ store, glyphs, copied }: { store: CadSketchHighlightStore; glyphs: readonly Shown[]; copied: ReadonlySet<Shown> }) {
  const lit = litGlyphs(useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot), glyphs);
  if (!lit.length) return null;
  const drawn = lit.filter(glyph => copied.has(glyph));
  return <>
    {drawn.length > 0 && <g className="cad-sketch-relation-glyphs-lit" pointerEvents="none" aria-hidden="true">
      {drawn.map(glyph => <g key={glyph.mountKey}>
        <path className={`cad-sketch-relation-glyph-plates is-${glyph.state}`} d={placedData(glyph, 'plates')} />
        <path className={`cad-sketch-relation-glyph-icons is-${glyph.state}`} d={placedData(glyph, 'icons')} />
      </g>)}
    </g>}
    <g className="cad-sketch-relation-glyph-highlight" pointerEvents="none" aria-hidden="true">
      {lit.map(glyph => <rect key={glyph.mountKey} data-cad-highlight-glyph={glyph.relationIds.join(' ')} rx={3} {...cadSketchRelationGlyphPlate(glyph.x, glyph.y, 1)} />)}
    </g>
  </>;
});
