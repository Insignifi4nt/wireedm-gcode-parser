import { Fragment, useMemo } from 'react';
import type { CadDocument } from '@/domain/cad/cadDocument';
import type { CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { createCadSketchMeasurementReader } from '@/domain/cad/cadSketchMeasurements';
import type { CadSketchGraphSelection } from './cadSketchGraphInteraction';
import { CadContextHelp } from './CadContextHelp';
import { formatCadQuantity } from './cadDisplayQuantity';

export function CadSketchSelectionMeasurements({ graph, parameters, selection, pointPair }: {
  graph: CadSketchGraph; parameters: CadDocument['parameters']; selection: readonly CadSketchGraphSelection[];
  pointPair: readonly [string, string] | null;
}) {
  const measurement = useMemo(() => {
    const reader = createCadSketchMeasurementReader(graph, parameters);
    try {
      if (pointPair) {
        const value = reader.betweenPoints(...pointPair);
        return { rows: [['Distance', value.distanceMm, 'mm'], ['ΔX', value.deltaMm[0], 'mm'], ['ΔY', value.deltaMm[1], 'mm']] as const };
      }
      if (selection.length !== 1) return null;
      const selected = selection[0];
      if (selected.kind === 'point') {
        const value = reader.point(selected.id);
        return { rows: [['X', value[0], 'mm'], ['Y', value[1], 'mm']] as const };
      }
      const value = reader.entity(selected.id);
      return { rows: value.kind === 'line' ? [['Length', value.lengthMm, 'mm'], ['ΔX', value.deltaMm[0], 'mm'], ['ΔY', value.deltaMm[1], 'mm']] as const
        : value.kind === 'arc' ? [['Radius', value.radiusMm, 'mm'], ['Sweep', value.sweepDegrees, 'deg'], ['Arc length', value.lengthMm, 'mm']] as const
          : [['Radius', value.radiusMm, 'mm'], ['Diameter', value.diameterMm, 'mm'], ['Circumference', value.circumferenceMm, 'mm']] as const };
    } catch (error) { return { error: error instanceof Error ? error.message : 'Unable to measure this selection.' }; }
  }, [graph, parameters, selection, pointPair]);
  if (!measurement) return null;
  if ('error' in measurement) return <div role="status" className="cad-property-title">Measurements unavailable<CadContextHelp label="Measurement unavailable">{measurement.error}</CadContextHelp></div>;
  return <section className="cad-measurements cad-selection-measurements">
    <dl aria-label="Selected geometry measurements">{measurement.rows.map(([label, value, unit]) => <Fragment key={label}><dt>{label}</dt><dd>{formatCadQuantity(value)} {unit}</dd></Fragment>)}</dl>
    <CadContextHelp label="Selected geometry measurements">Calculated from the current sketch in local coordinates; measuring does not constrain geometry. ΔX and ΔY follow the displayed From → To order for a point pair, or the stored start → end direction for a line. Arc sweep is positive counterclockwise and negative clockwise.</CadContextHelp>
  </section>;
}
