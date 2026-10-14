import type { DxfArcEntity } from '@/domain/dxf/types';
import type { CadAnalyticBoundary } from '@/domain/cad/cadSketchGeometry';
import { signedDxfArcSweepRadians } from '@/domain/dxf/arcSweep';

/** The sketch's enclosing Y flip maps SVG's clockwise flag to CAD's CCW frame. */
export function cadArcSvgPath(arc: DxfArcEntity, origin: readonly [number, number] = [0, 0]): string {
  const sweep = arc.sweepRadians ?? signedDxfArcSweepRadians(arc.startAngle * 180 / Math.PI, arc.endAngle * 180 / Math.PI, arc.clockwise);
  if (sweep === null || !Number.isFinite(sweep) || sweep === 0) throw new Error('Invalid analytic arc sweep.');
  const start = `M ${arc.start.x - origin[0]} ${arc.start.y - origin[1]}`;
  const direction = arc.clockwise ? 0 : 1;
  if (Math.abs(sweep) >= 2 * Math.PI - 1e-12) {
    const opposite = { x: 2 * (arc.center.x - origin[0]) - (arc.start.x - origin[0]), y: 2 * (arc.center.y - origin[1]) - (arc.start.y - origin[1]) };
    return `${start} A ${arc.radius} ${arc.radius} 0 0 ${direction} ${opposite.x} ${opposite.y} A ${arc.radius} ${arc.radius} 0 0 ${direction} ${arc.end.x - origin[0]} ${arc.end.y - origin[1]}`;
  }
  return `${start} A ${arc.radius} ${arc.radius} 0 ${Math.abs(sweep) > Math.PI ? 1 : 0} ${direction} ${arc.end.x - origin[0]} ${arc.end.y - origin[1]}`;
}

/** One continuous display boundary. No fitting, simplification or tolerance change. */
export function cadClosedBoundarySvgPath(entities: readonly CadAnalyticBoundary[], origin: readonly [number, number] = [0, 0]): string {
  const commands: string[] = [];
  for (const entity of entities) {
    if (entity.type === 'circle') throw new Error('A circle is rendered as its own analytic SVG element.');
    if (!commands.length) commands.push(`M ${entity.start.x - origin[0]} ${entity.start.y - origin[1]}`);
    if (entity.type === 'line') commands.push(`L ${entity.end.x - origin[0]} ${entity.end.y - origin[1]}`);
    else commands.push(cadArcSvgPath(entity, origin).replace(/^M [^ ]+ [^ ]+ /, ''));
  }
  return commands.length ? `${commands.join(' ')} Z` : '';
}
