import type { CadSketchFeature } from './cadDocument';
import { CadError } from './cadError';
import { deriveCadSketchArrangement, type CadSketchArrangementBoundary, type CadSketchArrangementEvent } from './cadSketchArrangement';
import { cadAnalyticSegments, cadPathClosureTolerance, type ResolvedCadPathSegment } from './cadAnalyticSegments';
import type { CadSketchMaterialRegion } from './cadSketchGeometry';
import { isCadSketchGraphCellSelection, validateCadSketchRegionSelection,
  type CadSketchGraphCellDescriptor, type CadSketchGraphCellSelection, type CadSketchGraphCellSourceWitness,
  type CadSketchGraphCellSpan, type CadSketchRegionSelection } from './cadSketchRegionSelection';
import { closedPathContainsPoint } from '@/domain/path-intel/pathContainment';
import { createCircleSegment, pathBounds, signedAreaOfPath } from '@/domain/path-intel/segments';
import type { Point2 } from '@/domain/path-intel/types';
import { Value } from '@sinclair/typebox/value';

const key = (value: unknown) => JSON.stringify(value);
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function descriptorKey(descriptor: CadSketchGraphCellDescriptor): string {
  const spans = (boundary: readonly CadSketchGraphCellSpan[]) => boundary.map(span => span.kind === 'range'
    ? [span.kind, span.entityId, span.from, span.to, span.reversed] : [span.kind, span.entityId, span.reversed]);
  return key([spans(descriptor.outer), descriptor.holes.map(spans)]);
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function canonical<T>(items: readonly T[]): T[] {
  let first = 0;
  for (let index = 1; index < items.length; index++) if (key(items[index]) < key(items[first])) first = index;
  return [...items.slice(first), ...items.slice(0, first)];
}
function node(events: readonly CadSketchArrangementEvent[]): CadSketchGraphCellSourceWitness['events'][number] {
  const result: CadSketchGraphCellSourceWitness['events'][number][number][] = [];
  for (const event of events) {
    if (event.kind === 'circle-seam') continue;
    if (event.kind === 'point') { result.push({ kind: 'point', pointId: event.pointId }); continue; }
    if (event.branch === 'tangent' || event.branch === 'start' || event.branch === 'end')
      throw new CadError('unsupported-sketch-cells', 'This circular contact has no unambiguous transverse event identity.');
    result.push({ kind: 'intersection', entityIds: [event.entityIds[0], event.entityIds[1]], branch: event.branch });
  }
  return result;
}
function analytic(path: readonly ResolvedCadPathSegment[]) {
  const prepared = cadAnalyticSegments(path);
  // A declared complete turn is a circle for containment, independent of its
  // arbitrary seam. Keep the original signed arc path for area/native output.
  const containment = new Map(prepared.segments.map(segment => [segment.id,
    segment.kind === 'arc' && Math.abs(segment.sweepRadians) === 2 * Math.PI
      ? createCircleSegment({ id: segment.id, source: segment.source, center: segment.center, radius: segment.radius }) : segment]));
  const signedArea = signedAreaOfPath(prepared.refs, prepared.byId);
  return { contains: (point: Point2) => closedPathContainsPoint(prepared.refs, point, containment), prepared,
    metrics: { signedArea, areaMm2: Math.abs(signedArea), perimeterMm: prepared.segments.reduce((sum, segment) => sum + segment.length, 0),
      boundsMm: pathBounds(prepared.refs, prepared.byId) } };
}
export function prepareCadSketchGraphCells(sketch: CadSketchFeature, parameters: Readonly<Record<string, number>>) {
  if (!sketch.graph || sketch.profiles.some(profile => !profile.construction))
    throw new CadError('unsupported-sketch-cells', 'Graph areas require an entity-based sketch without material legacy profiles. Construction references may remain.');
  const arrangement = deriveCadSketchArrangement(sketch.graph, parameters);
  if (arrangement.issues.length) throw new CadError('unsupported-sketch-cells', arrangement.issues[0].message);
  const sourceMap = new Map<string, CadSketchGraphCellSourceWitness>();
  const entities = new Map(sketch.graph.entities.map(entity => [entity.id, entity]));
  for (const source of arrangement.sources) {
    const entity = entities.get(source.entityId);
    if (!entity) throw new CadError('invalid-sketch-cells', 'An analytic support has no source owner.');
    const raw = source.knots.map(knot => node(knot.events)).filter(events => events.length > 0);
    const events = entity.kind === 'circle' ? canonical(raw) : raw;
    const witness: CadSketchGraphCellSourceWitness = entity.kind === 'line'
      ? { entityId: entity.id, kind: entity.kind, startPointId: entity.startPointId, endPointId: entity.endPointId, events }
      : entity.kind === 'arc' ? { entityId: entity.id, kind: entity.kind, centerPointId: entity.centerPointId,
        startPointId: entity.startPointId, endPointId: entity.endPointId, direction: entity.direction, events }
      : { entityId: entity.id, kind: entity.kind, centerPointId: entity.centerPointId, events };
    sourceMap.set(entity.id, freeze(witness));
  }
  function boundary(source: CadSketchArrangementBoundary) {
    const edges = source.sourceRefs.map((reference, index) => {
      const support = sourceMap.get(reference.entityId);
      if (!support) throw new CadError('invalid-sketch-cells', 'An analytic boundary has no witnessed source.');
      const reversed = reference.from > reference.to;
      let span: CadSketchGraphCellSpan;
      if (support.kind === 'circle' && support.events.length === 0) span = { kind: 'full-circle', entityId: support.entityId, reversed };
      else {
        const from = support.events.findIndex(events => key(events) === key(node(reversed ? reference.toEvents : reference.fromEvents)));
        const to = support.events.findIndex(events => key(events) === key(node(reversed ? reference.fromEvents : reference.toEvents)));
        if (from < 0 || to < 0) throw new CadError('invalid-sketch-cells', 'An analytic boundary event has no source order.');
        span = { kind: 'range', entityId: support.entityId, from, to, reversed };
      }
      return { span, path: source.path[index] };
    });
    const ordered = canonical(edges.map(edge => edge.span));
    const first = edges.findIndex(edge => key(edge.span) === key(ordered[0]));
    return { spans: ordered, edges: [...edges.slice(first), ...edges.slice(0, first)] };
  }
  const entries = arrangement.cells.map(cell => {
    const outer = boundary(cell.outer), holes = cell.holes.map(boundary).sort((a, b) => compare(key(a.spans), key(b.spans)));
    const descriptor: CadSketchGraphCellDescriptor = { outer: outer.spans, holes: holes.map(hole => hole.spans) };
    const geometry = { kind: 'path' as const, segments: cell.outer.path };
    const inside = analytic(cell.outer.path), metrics = inside.metrics;
    const voids = cell.holes.map(hole => ({ geometry: { kind: 'path' as const, segments: hole.path } }));
    const insideHoles = cell.holes.map(hole => analytic(hole.path));
    return { descriptor, outer, holes, boundary: { geometry }, voids, areaMm2: cell.area,
      boundaryLengthMm: metrics.perimeterMm + insideHoles.reduce((sum, hole) => sum + hole.metrics.perimeterMm, 0),
      boundsMm: metrics.boundsMm, contains: (point: Point2) => point.x >= metrics.boundsMm.minX && point.x <= metrics.boundsMm.maxX
        && point.y >= metrics.boundsMm.minY && point.y <= metrics.boundsMm.maxY && inside.contains(point) && !insideHoles.some(hole => hole.contains(point)) };
  }).sort((a, b) => compare(key(a.descriptor), key(b.descriptor)));
  const cells = entries.map((entry, id) => freeze({ id, name: `Area ${id + 1}`, descriptor: entry.descriptor,
    boundary: entry.boundary, voids: entry.voids, areaMm2: entry.areaMm2, boundaryLengthMm: entry.boundaryLengthMm,
    boundsMm: entry.boundsMm, defaultMaterial: false }));
  const byDescriptor = new Map(entries.map((entry, id) => [descriptorKey(entry.descriptor), id]));
  function checkedIds(ids: readonly number[]): readonly number[] {
    if (new Set(ids).size !== ids.length || ids.some(id => !Number.isSafeInteger(id) || id < 0 || id >= cells.length))
      throw new CadError('invalid-sketch-cell-id', 'Choose unique current area locators from this prepared graph catalog.');
    return [...ids].sort((a, b) => a - b);
  }
  function pack(ids: readonly number[]): CadSketchGraphCellSelection {
    const selected = checkedIds(ids), used = new Set(selected.flatMap(id => [entries[id].descriptor.outer, ...entries[id].descriptor.holes]).flatMap(spans => spans.map(span => span.entityId)));
    const queue = [...used];
    for (let index = 0; index < queue.length; index++) {
      const witness = sourceMap.get(queue[index]);
      if (!witness) throw new CadError('invalid-sketch-cells', 'A selected support is missing.');
      for (const event of witness.events.flat()) if (event.kind === 'intersection') for (const id of event.entityIds)
        if (!used.has(id)) { used.add(id); queue.push(id); }
    }
    return freeze({ kind: 'graph-cells', sources: [...used].sort(compare).map(id => {
      const witness = sourceMap.get(id); if (!witness) throw new CadError('invalid-sketch-cells', 'A selected support is missing.'); return witness;
    }),
      cells: selected.map(id => entries[id].descriptor) });
  }
  function selectedCellIds(selection?: CadSketchRegionSelection): readonly number[] {
    if (!isCadSketchGraphCellSelection(selection)) return [];
    if (selection.cells.length === 0 && selection.sources.length === 0) return [];
    validateCadSketchRegionSelection(selection);
    const ids = selection.cells.map(descriptor => byDescriptor.get(descriptorKey(descriptor)) ?? -1);
    if (ids.some(id => id < 0) || !Value.Equal(pack(ids), selection))
      throw new CadError('stale-sketch-region', 'Selected graph areas changed their supports, event order, boundaries or holes. Choose their areas again.');
    return checkedIds(ids);
  }
  function resolve(selection: CadSketchGraphCellSelection): readonly CadSketchMaterialRegion[] {
    validateCadSketchRegionSelection(selection);
    const ids = selectedCellIds(selection);
    const remaining = new Map<string, { span: CadSketchGraphCellSpan; path: ResolvedCadPathSegment }>();
    for (const id of ids) for (const edge of [entries[id].outer, ...entries[id].holes].flatMap(boundary => boundary.edges)) {
      const token = key({ ...edge.span, reversed: false }), existing = remaining.get(token);
      if (existing) {
        if (existing.span.reversed === edge.span.reversed) throw new CadError('invalid-region-selection', 'Selected areas have duplicate material incidence.');
        remaining.delete(token);
      } else remaining.set(token, edge);
    }
    type Edge = { span: CadSketchGraphCellSpan; path: ResolvedCadPathSegment };
    function endpoints(edge: Edge) {
      const support = sourceMap.get(edge.span.entityId);
      if (!support || edge.span.kind === 'full-circle') return null;
      const first = key(support.events[edge.span.from]), second = key(support.events[edge.span.to]);
      return edge.span.reversed ? [second, first] : [first, second];
    }
    const outgoing = new Map<string, Edge>(), incoming = new Set<string>(), loops: ResolvedCadPathSegment[][] = [];
    for (const edge of remaining.values()) {
      const ends = endpoints(edge);
      if (!ends) { loops.push([edge.path]); continue; }
      if (outgoing.has(ends[0]) || incoming.has(ends[1])) throw new CadError('unsupported-sketch-cells', 'Selected areas touch at a point or have an ambiguous material boundary.');
      outgoing.set(ends[0], edge); incoming.add(ends[1]);
    }
    while (outgoing.size) {
      const start = outgoing.keys().next().value;
      if (start === undefined) break;
      let cursor = start; const path: ResolvedCadPathSegment[] = [];
      do {
        const edge = outgoing.get(cursor), ends = edge && endpoints(edge);
        if (!edge || !ends) throw new CadError('invalid-sketch-cells', 'The selected material boundary is open.');
        outgoing.delete(cursor); path.push(edge.path); cursor = ends[1];
      } while (cursor !== start);
      loops.push(path);
    }
    const measured = loops.map(path => {
      const geometry = { kind: 'path' as const, segments: path }, prepared = analytic(path), metrics = prepared.metrics;
      const segments = prepared.prepared.segments;
      for (let index = 0; index < segments.length; index++) {
        const end = segments[index].end, next = segments[(index + 1) % segments.length].start;
        if (Math.hypot(end.x - next.x, end.y - next.y) > cadPathClosureTolerance([end, next]))
          throw new CadError('unsupported-sketch-cells', 'The selected analytic boundary cannot reproduce its joints.');
      }
      return { geometry, prepared, metrics };
    });
    const outers = measured.filter(loop => loop.metrics.signedArea > 0);
    const regions: { boundary: { geometry: typeof outers[number]['geometry'] }; voids: { geometry: typeof outers[number]['geometry'] }[] }[] = outers.map(outer => ({ boundary: { geometry: outer.geometry }, voids: [] }));
    for (const hole of measured.filter(loop => loop.metrics.signedArea < 0)) {
      const sample = hole.prepared.prepared.segments[0]?.start;
      const owner = sample && outers.map((outer, index) => ({ outer, index })).filter(item => item.outer.prepared.contains(sample))
        .sort((a, b) => a.outer.metrics.areaMm2 - b.outer.metrics.areaMm2)[0];
      if (!owner) throw new CadError('invalid-sketch-cells', 'A selected analytic void has no material owner.');
      regions[owner.index].voids.push({ geometry: hole.geometry });
    }
    if (!regions.length || measured.some(loop => loop.metrics.areaMm2 <= 0)) throw new CadError('invalid-sketch-cells', 'Selected areas have no resolved bounded material.');
    return freeze(regions);
  }
  return freeze({ mode: 'graph-cells' as const, cells, pack, selectedCellIds, resolve,
    hasIntersections: arrangement.sources.some(source => source.knots.some(knot => knot.events.some(event => event.kind === 'intersection'))),
    pick(point: Point2) { if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
      const matches = entries.flatMap((entry, id) => entry.contains(point) ? [cells[id]] : []); return matches.length === 1 ? matches[0] : null; } });
}
