import { useMemo } from 'react';
import type { CadDocument, CadSketchPlane } from '@/domain/cad/cadDocument';
import { cadPrincipalFrame } from '@/domain/cad/cadDatumPlanes';
import { prepareCadDocumentFrames } from '@/domain/cad/cadDocumentFrames';

export function useCadPlacementNormal(plane: CadSketchPlane | undefined, document: CadDocument) {
  const datum = plane !== undefined && typeof plane !== 'string';
  const frames = useMemo(() => datum ? prepareCadDocumentFrames(document) : null, [document, datum]);
  return plane === undefined ? null : typeof plane === 'string' ? cadPrincipalFrame(plane).normal : frames?.get(plane.featureId)?.normal ?? null;
}

export function CadPlacementNormal({ plane, document }: { plane: CadSketchPlane; document: CadDocument }) {
  const normal = useCadPlacementNormal(plane, document);
  if (typeof plane === 'string' || !normal) return null;
  return <dl className="cad-topology-details"><dt>Normal +n</dt><dd>{normal.map(value => Number(value.toFixed(6))).join(', ')}</dd></dl>;
}
