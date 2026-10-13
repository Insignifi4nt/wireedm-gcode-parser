import { draw, drawCircle, drawRoundedRectangle, type Drawing } from 'replicad';
import { CadError } from '../../../domain/cad/cadError';
import { cadProfileToEntities, type ResolvedCadProfile } from '../../../domain/cad/cadSketchGeometry';

export function cadKernelProfileDrawing(profile: ResolvedCadProfile, drawings: Drawing[]): Drawing {
  const own = (drawing: Drawing) => { drawings.push(drawing); return drawing; };
  function analyticBoundary(): Drawing {
    const entities = cadProfileToEntities(profile); const first = entities[0];
    if (entities.length === 1 && first?.type === 'circle') return own(own(drawCircle(first.radius)).translate(first.center.x, first.center.y));
    if (entities.length === 1 && first?.type === 'arc' && Math.abs(first.endAngle - first.startAngle) === 2 * Math.PI) {
      return own(own(drawCircle(first.radius)).translate(first.center.x, first.center.y));
    }
    if (!first || first.type !== 'line' && first.type !== 'arc') throw new CadError('invalid-profile', 'A profile needs a closed analytic boundary of lines and circular arcs.');
    const pen = draw([first.start.x, first.start.y]);
    for (const entity of entities) {
      if (entity.type === 'line') pen.lineTo([entity.end.x, entity.end.y]);
      else if (entity.type === 'arc') {
        // Signed sweep preserves clockwise as well as major circular arcs.
        const midAngle = (entity.startAngle + entity.endAngle) / 2;
        pen.threePointsArcTo([entity.end.x, entity.end.y], [entity.center.x + entity.radius * Math.cos(midAngle), entity.center.y + entity.radius * Math.sin(midAngle)]);
      } else throw new CadError('invalid-profile', 'This boundary contains an unsupported curve.');
    }
    return own(pen.close());
  }
  switch (profile.kind) {
    case 'rectangle': {
      if (profile.cornerRadius === 0) return own(own(drawRoundedRectangle(profile.width, profile.height)).translate(profile.x + profile.width / 2, profile.y + profile.height / 2));
      // Explicit analytic arcs also handle radius exactly half the shorter side.
      // Replicad's tangent-arc primitive fails on the zero-length straight edges.
      return analyticBoundary();
    }
    case 'circle': return own(own(drawCircle(profile.radius)).translate(profile.x, profile.y));
    case 'path': return analyticBoundary();
    case 'slot': {
      // The rectangle primitive cannot accept radius equal to half its shorter side.
      const halfStraight = (profile.length - profile.width) / 2;
      const radius = profile.width / 2;
      if (halfStraight === 0) return own(own(drawCircle(radius)).translate(profile.x, profile.y));
      const drawing = own(draw([-halfStraight, -radius]).lineTo([halfStraight, -radius])
        .threePointsArcTo([halfStraight, radius], [halfStraight + radius, 0])
        .lineTo([-halfStraight, radius]).threePointsArcTo([-halfStraight, -radius], [-halfStraight - radius, 0]).close());
      return own(own(drawing.rotate(profile.angle, [0, 0])).translate(profile.x, profile.y));
    }
    case 'polygon': {
      const first = profile.points[0];
      if (!first) throw new CadError('empty-profile', 'A polygon needs at least three points.');
      const pen = draw([first[0], first[1]]);
      for (const point of profile.points.slice(1)) pen.lineTo([point[0], point[1]]);
      return own(pen.close());
    }
    default: { const exhaustive: never = profile; throw new Error(`Unsupported profile: ${exhaustive}`); }
  }
}

