import type { CadDocument, CadFeature, CadMesh } from '@/domain/cad/cadDocument';
import type { CadSketchGraphRelation } from '@/domain/cad/cadSketchGraph';
import { cadFeatureDependencies } from '@/domain/cad/cadFeatureInputs';
import { measureCadSketch } from '@/domain/cad/cadMeasurements';
import { measureCadCurve } from '@/domain/cad/cadCurveMeasurements';
import { formatCadLocalizedQuantity } from './cadDisplayQuantity';

/** One read-only line of a Properties summary. */
export interface CadPropertyRow { readonly label: string; readonly value: string }
export type CadPropertyTarget = { readonly kind: 'body' } | { readonly kind: 'feature'; readonly feature: CadFeature };

const length = (value: number) => `${formatCadLocalizedQuantity(value, 3)} mm`;
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
const DIMENSIONS = new Set<CadSketchGraphRelation['kind']>(['distance', 'axis-distance', 'radial-size', 'line-angle', 'fixed-axis', 'fillet-corner', 'chamfer-corner']);

function sizeOf(meshes: readonly CadMesh[]): string | null {
  if (!meshes.length) return null;
  const min = [0, 1, 2].map(axis => Math.min(...meshes.map(mesh => mesh.bounds.min[axis])));
  const max = [0, 1, 2].map(axis => Math.max(...meshes.map(mesh => mesh.bounds.max[axis])));
  return `${max.map((value, axis) => formatCadLocalizedQuantity(value - min[axis], 3)).join(' × ')} mm`;
}
function solidRows(meshes: readonly CadMesh[]): CadPropertyRow[] {
  if (!meshes.length) return [];
  const volume = meshes.reduce((total, mesh) => total + mesh.volume, 0);
  const solids = meshes.reduce((total, mesh) => total + (mesh.solidCount ?? 1), 0);
  return [{ label: 'Volume', value: `${formatCadLocalizedQuantity(volume, 3)} mm³` }, { label: 'Size X × Y × Z', value: sizeOf(meshes) ?? '—' },
    ...(solids > 1 ? [{ label: 'Solids', value: String(solids) }] : [])];
}

/**
 * The facts a person checks about one feature or the whole body, without its editing controls.
 * Measurements that cannot be computed for the current revision are left out rather than shown as zero.
 */
export function cadPropertySummary(document: CadDocument, target: CadPropertyTarget, meshes: readonly CadMesh[], planeLabel: (feature: Extract<CadFeature, { kind: 'sketch' | 'curve' }>) => string): readonly CadPropertyRow[] {
  if (target.kind === 'body') {
    const rows: CadPropertyRow[] = [{ label: 'Features', value: String(document.features.length) }];
    const suppressed = document.features.filter(feature => feature.suppressed).length;
    if (suppressed) rows.push({ label: 'Suppressed', value: String(suppressed) });
    return meshes.length ? [...rows, ...solidRows(meshes)] : [...rows, { label: 'Solid', value: 'None yet' }];
  }
  const feature = target.feature, rows: CadPropertyRow[] = [];
  if (feature.suppressed) rows.push({ label: 'State', value: 'Suppressed' });
  const inputs = [...new Set(cadFeatureDependencies(feature))].map(id => document.features.find(entry => entry.id === id)?.name ?? id);
  if (inputs.length) rows.push({ label: inputs.length === 1 ? 'Input' : 'Inputs', value: inputs.join(', ') });
  if (feature.kind === 'sketch' || feature.kind === 'curve') {
    rows.push({ label: 'Plane', value: `${planeLabel(feature)}${feature.offset !== 0 ? ` · offset ${typeof feature.offset === 'number' ? length(feature.offset) : feature.offset}` : ''}` });
  }
  if (feature.kind === 'sketch') {
    const graph = feature.graph;
    if (graph) {
      const kinds = ['line', 'arc', 'circle'] as const;
      const geometry = kinds.map(kind => [kind, graph.entities.filter(entity => entity.kind === kind).length] as const).filter(([, count]) => count > 0);
      rows.push({ label: 'Geometry', value: geometry.length ? geometry.map(([kind, count]) => plural(count, kind)).join(' · ') : 'Empty' });
      const dimensions = graph.relations.filter(relation => DIMENSIONS.has(relation.kind)).length;
      rows.push({ label: 'Constraints', value: `${plural(dimensions, 'dimension')} · ${plural(graph.relations.length - dimensions, 'relation')}` });
    } else if (feature.profiles.length) rows.push({ label: 'Geometry', value: plural(feature.profiles.length, 'profile') });
    try {
      const measured = measureCadSketch(document, feature.id);
      rows.push({ label: 'Closed areas', value: String(measured.cutContourCount) }, { label: 'Material area', value: `${formatCadLocalizedQuantity(measured.materialAreaMm2, 3)} mm²` },
        { label: 'Boundary length', value: length(measured.boundaryLengthMm) });
      if (measured.boundsMm) rows.push({ label: 'Size X × Y', value: `${formatCadLocalizedQuantity(measured.boundsMm.maxX - measured.boundsMm.minX, 3)} × ${formatCadLocalizedQuantity(measured.boundsMm.maxY - measured.boundsMm.minY, 3)} mm` });
    } catch { /* An unsolvable revision keeps its identity rows only. */ }
  } else if (feature.kind === 'curve') {
    rows.push({ label: 'Segments', value: String(feature.segments.length) });
    try { rows.push({ label: 'Length', value: length(measureCadCurve(document, feature.id).lengthMm) }); }
    catch { /* An unresolved placement has no measurable length. */ }
  }
  return [...rows, ...solidRows(meshes.filter(mesh => mesh.featureId === feature.id))];
}
