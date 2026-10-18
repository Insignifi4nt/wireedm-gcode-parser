import { Button } from '@/components/ui/button';
import type { CadSketchAngleRelation } from '@/domain/cad/cadSketchGraph';
import type { CadSketchLineAngleSector } from '@/domain/cad/cadSketchAngleRelations';
import { CadContextHelp } from './CadContextHelp';
import { formatCadQuantity } from './cadDisplayQuantity';

/** Explicit physical sector choice; no source ray is inferred from a button's order. */
export function CadSketchAngleSectors({ sectors, onChoose }: {
  readonly sectors: readonly CadSketchLineAngleSector[];
  onChoose(relation: CadSketchAngleRelation): void;
}) {
  return <div className="cad-sketch-angle-sectors" role="group" aria-label="Choose angle sector">
    <span>Choose a corner <CadContextHelp label="Angle sector">These lines cross their support intersection. Choose the highlighted corner to drive. The same corner stays selected when its angle changes.</CadContextHelp></span>
    <div>{sectors.map(({ relation, geometry }, index) => {
      const a = geometry.first.direction, b = geometry.second.direction, sweep = geometry.signedSweepRadians;
      const curve = `A 16 16 0 0 ${sweep > 0 ? 1 : 0} ${b.x * 16} ${b.y * 16}`;
      const arc = `M ${a.x * 16} ${a.y * 16} ${curve}`;
      const label = `${formatCadQuantity(typeof relation.value === 'number' ? relation.value : Math.abs(sweep) * 180 / Math.PI)}°`;
      return <Button key={index} type="button" data-cad-angle-sector={index} aria-label={`Choose angle sector ${index + 1}, ${label}`} onClick={() => onChoose(relation)}>
        <span aria-hidden="true"><svg viewBox="-28 -28 56 56" width={46} height={46}><g transform="scale(1,-1)" fill="none" stroke="currentColor" strokeWidth={1}>
          <path d={`M ${-a.x * 25} ${-a.y * 25} L ${a.x * 25} ${a.y * 25} M ${-b.x * 25} ${-b.y * 25} L ${b.x * 25} ${b.y * 25}`} opacity={.4} />
          <path d={`M 0 0 L ${a.x * 16} ${a.y * 16} ${curve} Z`} fill="var(--primary)" fillOpacity={.18} stroke="none" />
          <path d={arc} stroke="var(--primary)" strokeWidth={1.5} />
        </g></svg></span><span>{label}</span>
      </Button>;
    })}</div>
  </div>;
}
