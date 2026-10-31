import { memo, useMemo } from 'react';
import type { CadProfile } from '@/domain/cad/cadDocument';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';
import { cadProfileReferenceGeometry } from './cadViewportReferences';
import { cadClosedBoundarySvgPath } from './cadSketchSvg';

/** Cache exact geometry in a small frame; navigation changes only its placement. A halo width draws the same shape first as a dark under-stroke. */
export const CadSketchProfileGeometry = memo(function CadSketchProfileGeometry({ geometry, parameters, viewCenter, halo = 0 }: {
  geometry: CadProfile; parameters: Readonly<Record<string, number>>; viewCenter: readonly [number, number]; halo?: number;
}) {
  const prepared = useMemo(() => {
    try {
      const { entities, bounds } = cadProfileReferenceGeometry(geometry, parameters);
      const origin = [bounds.minX / 2 + bounds.maxX / 2, bounds.minY / 2 + bounds.maxY / 2] as const;
      const value = (scalar: number | string) => evaluateCadScalar(scalar, parameters);
      const x = (scalar: number | string) => value(scalar) - origin[0];
      const y = (scalar: number | string) => value(scalar) - origin[1];
      const content = (() => {
        switch (geometry.kind) {
          case 'rectangle': return <rect x={x(geometry.x)} y={y(geometry.y)} width={value(geometry.width)} height={value(geometry.height)} rx={value(geometry.cornerRadius)} />;
          case 'circle': return <circle cx={x(geometry.x)} cy={y(geometry.y)} r={value(geometry.radius)} />;
          case 'polygon': return <polygon points={geometry.points.map(([a, b]) => `${x(a)},${y(b)}`).join(' ')} />;
          case 'slot': {
            const cx = x(geometry.x), cy = y(geometry.y), length = value(geometry.length), width = value(geometry.width);
            return <rect x={cx - length / 2} y={cy - width / 2} width={length} height={width} rx={width / 2} transform={`rotate(${value(geometry.angle)} ${cx} ${cy})`} />;
          }
          case 'plugin':
          case 'path': {
            const circle = entities.length === 1 && entities[0].type === 'circle' ? entities[0] : null;
            return circle ? <circle cx={circle.center.x - origin[0]} cy={circle.center.y - origin[1]} r={circle.radius} />
              : <path d={cadClosedBoundarySvgPath(entities, origin)} strokeLinejoin="round" />;
          }
        }
      })();
      return { origin, content };
    } catch { return null; } // Invalid geometry keeps its existing feature diagnostic.
  }, [geometry, parameters]);
  return prepared && <g transform={`translate(${prepared.origin[0] - viewCenter[0]},${prepared.origin[1] - viewCenter[1]})`}>
    {halo > 0 && <g className="cad-sketch-halo" strokeWidth={halo}>{prepared.content}</g>}{prepared.content}
  </g>;
});
