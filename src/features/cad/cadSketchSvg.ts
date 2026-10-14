import type { DxfArcEntity } from '@/domain/dxf/types';
import type { CadAnalyticBoundary } from '@/domain/cad/cadSketchGeometry';
import { signedDxfArcSweepRadians } from '@/domain/dxf/arcSweep';

/** The sketch's enclosing Y flip maps SVG's clockwise flag to CAD's CCW frame. */
export function cadArcSvgPath(arc: DxfArcEntity): string {
  const sweep = arc.sweepRadians ?? signedDxfArcSweepRadians(arc.startAngle * 180 / Math.PI, arc.endAngle * 180 / Math.PI, arc.clockwise);
  if (sweep === null || !Number.isFinite(sweep) || sweep === 0) throw new Error('Invalid analytic arc sweep.');
  const start = `M ${arc.start.x} ${arc.start.y}`;
  const direction = arc.clockwise ? 0 : 1;
  if (Math.abs(sweep) >= 2 * Math.PI - 1e-12) {
    const opposite = { x: 2 * arc.center.x - arc.start.x, y: 2 * arc.center.y - arc.start.y };
    return `${start} A ${arc.radius} ${arc.radius} 0 0 ${direction} ${opposite.x} ${opposite.y} A ${arc.radius} ${arc.radius} 0 0 ${direction} ${arc.end.x} ${arc.end.y}`;
  }
  return `${start} A ${arc.radius} ${arc.radius} 0 ${Math.abs(sweep) > Math.PI ? 1 : 0} ${direction} ${arc.end.x} ${arc.end.y}`;
}

/** One continuous display boundary. No fitting, simplification or tolerance change. */
export function cadClosedBoundarySvgPath(entities: readonly CadAnalyticBoundary[]): string {
  const commands: string[] = [];
  for (const entity of entities) {
    if (entity.type === 'circle') throw new Error('A circle is rendered as its own analytic SVG element.');
    if (!commands.length) commands.push(`M ${entity.start.x} ${entity.start.y}`);
    if (entity.type === 'line') commands.push(`L ${entity.end.x} ${entity.end.y}`);
    else commands.push(cadArcSvgPath(entity).replace(/^M [^ ]+ [^ ]+ /, ''));
  }
  return commands.length ? `${commands.join(' ')} Z` : '';
}
