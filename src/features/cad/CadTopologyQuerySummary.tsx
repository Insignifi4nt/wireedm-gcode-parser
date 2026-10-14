import type { CadEdgeSelection, CadFaceQuery } from '@/domain/cad/cadTopology';
import { formatCadQuantity } from './cadDisplayQuantity';

function readable(value: unknown): string {
  if (Array.isArray(value)) return value.map(readable).join(', ');
  return typeof value === 'number' ? formatCadQuantity(value) : String(value);
}

export function CadTopologyQuerySummary({ selection }: { selection: CadEdgeSelection | CadFaceQuery }) {
  const queries = 'queries' in selection ? selection.queries : [selection];
  return <details className="cad-selector-summary"><summary>Geometric selector · expects {selection.expectedCount} {'queries' in selection ? 'edges' : 'face'}</summary>
    <p>Every condition must match. An ambiguous or missing match stops the feature.</p>
    {queries.map((query, index) => <div key={index}><strong>{queries.length > 1 ? `Edge ${index + 1}` : 'Conditions'}</strong><dl>{query.predicates.map((predicate, predicateIndex) => <div key={predicateIndex}><dt>{predicate.kind.replaceAll('-', ' ')}</dt><dd>{Object.entries(predicate).filter(([key]) => key !== 'kind').map(([key, value]) => `${key}: ${readable(value)}`).join(' · ')}</dd></div>)}</dl></div>)}
  </details>;
}
