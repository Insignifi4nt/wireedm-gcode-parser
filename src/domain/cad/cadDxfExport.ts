import type { DxfEntity } from '@/domain/dxf/types';
import { CadError } from './cadError';

/** Validated CAD geometry: local 2D millimetres and radian arc angles, without tessellation. */
export function cadEntitiesToDxf(entities: readonly DxfEntity[], comments: readonly string[] = []): string {
  if (!entities.length) throw new CadError('dxf-geometry', 'DXF export needs at least one analytic curve.');
  const lines = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
  const pair = (code: number, value: string | number) => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new CadError('dxf-geometry', 'DXF coordinates must be finite.');
    lines.push(String(code), String(value).replace(/[\r\n]+/g, ' '));
  };
  for (const comment of comments) pair(999, comment);
  for (const entity of entities) {
    if (entity.type !== 'line' && entity.type !== 'circle' && entity.type !== 'arc') throw new CadError('unsupported-entity', 'CAD exports analytic line, arc and circle entities.');
    pair(0, entity.type.toUpperCase()); pair(8, entity.layer ?? 'CAD');
    if (entity.type === 'line') {
      pair(10, entity.start.x); pair(20, entity.start.y); pair(30, 0);
      pair(11, entity.end.x); pair(21, entity.end.y); pair(31, 0);
    } else {
      if (!(entity.radius > 0)) throw new CadError('dxf-geometry', 'DXF circle and arc radii must be positive.');
      pair(10, entity.center.x); pair(20, entity.center.y); pair(30, 0); pair(40, entity.radius);
      if (entity.type === 'arc') {
        pair(50, (entity.clockwise ? entity.endAngle : entity.startAngle) * 180 / Math.PI);
        pair(51, (entity.clockwise ? entity.startAngle : entity.endAngle) * 180 / Math.PI);
      }
    }
  }
  lines.push('0', 'ENDSEC', '0', 'EOF');
  return `${lines.join('\n')}\n`;
}
