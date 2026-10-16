import type { CadProfile, CadScalar } from './cadDocument';
import { CadError } from './cadError';
import { checkCadSketchGraph, parseCadSketchGraph, type CadSketchGraph, type CadSketchGraphRelation } from './cadSketchGraph';
import { validateCadSketchGeometry } from './cadSketchGeometry';

function numeric(value: CadScalar): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new CadError('invalid-fresh-sketch-scalar', 'Fresh sketch geometry requires finite numeric scalars. Expression sources must remain unchanged.');
  return value;
}

function acceptedGraph(value: CadSketchGraph): CadSketchGraph {
  const graph = parseCadSketchGraph(value), issue = checkCadSketchGraph(graph, {})[0];
  if (issue) throw new CadError('invalid-fresh-sketch-geometry', `${issue.source.id}: ${issue.message}`);
  return graph;
}

function validateFreshProfile(geometry: CadProfile, construction: boolean): void {
  validateCadSketchGeometry({ id: 'fresh', name: 'Fresh shape', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0,
    profiles: [{ id: 'shape', name: 'Fresh shape', construction, geometry }] }, {});
}

/**
 * Fresh numeric rectangles without rounding, circles and polygons only. Never promote saved profiles.
 * Caller-owned IDs must be fresh across the sketch; append still checks the complete namespace.
 * Mixed paths need their live authoring joints before angle encoding loses those logical endpoints.
 * Slots/rounded rectangles retain legacy semantics until their tangent/equal-radius relations exist.
 */
export function createCadFreshSketchGraph({ geometry, construction, createId }: {
  readonly geometry: CadProfile;
  readonly construction: boolean;
  readonly createId: () => string;
}): CadSketchGraph {
  if (geometry.kind === 'circle') {
    const x = numeric(geometry.x), y = numeric(geometry.y), radius = numeric(geometry.radius);
    validateFreshProfile({ kind: 'circle', x, y, radius }, construction);
    const center = { id: createId(), position: [x, y] satisfies readonly [number, number] };
    return acceptedGraph({ points: [center], entities: [{ id: createId(), kind: 'circle', construction, centerPointId: center.id, radius }], relations: [] });
  }
  let positions: readonly (readonly [number, number])[];
  switch (geometry.kind) {
    case 'rectangle': {
      const x = numeric(geometry.x), y = numeric(geometry.y), width = numeric(geometry.width), height = numeric(geometry.height);
      if (numeric(geometry.cornerRadius) !== 0) throw new CadError('unsupported-fresh-sketch-geometry', 'Rounded rectangles must retain their existing profile representation.');
      validateFreshProfile({ kind: 'rectangle', x, y, width, height, cornerRadius: 0 }, construction);
      positions = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
      break;
    }
    case 'polygon':
      positions = geometry.points.map(([x, y]) => [numeric(x), numeric(y)]);
      validateFreshProfile({ kind: 'polygon', points: positions }, construction);
      break;
    case 'slot': case 'path': case 'plugin':
      throw new CadError('unsupported-fresh-sketch-geometry', 'This fresh shape must retain its existing profile representation.');
    default: { const exhaustive: never = geometry; throw exhaustive; }
  }
  const points = positions.map(position => ({ id: createId(), position }));
  const entities = points.map((point, index) => ({ id: createId(), kind: 'line' as const, construction,
    startPointId: point.id, endPointId: points[(index + 1) % points.length].id }));
  const relations: CadSketchGraphRelation[] = geometry.kind === 'rectangle' ? entities.map((entity, index) => ({ id: createId(), kind: index % 2 === 0 ? 'horizontal' : 'vertical',
    pointIds: [entity.startPointId, entity.endPointId] })) : [];
  return acceptedGraph({ points, entities, relations });
}
