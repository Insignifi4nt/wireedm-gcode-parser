import { createContext } from 'react';
import type { CadPreparedSketchCatalog } from '@/domain/cad/cadSketchRegionInspection';
import type { CadSketchRegionSelection } from '@/domain/cad/cadSketchRegionSelection';
import type { CadResolvedPlacement } from '@/domain/cad/cadDatumPlanes';

export interface CadFeatureRegionPickCommand {
  readonly kind: 'pick-regions'; readonly owner: string; readonly expectedVersion: string;
  readonly label: string; readonly sketchId: string;
  readonly cells: CadPreparedSketchCatalog;
  readonly placement: CadResolvedPlacement;
  readonly selection: CadSketchRegionSelection | undefined;
  onSelect(selection: CadSketchRegionSelection): void;
  onFinish(): void; onCancel(): void;
}

export type CadFeatureReferencePickCommand = {
  readonly kind: 'pick'; readonly owner: string; readonly expectedVersion: string;
  readonly label: string; readonly eligibleIds: readonly string[];
  onSelect(featureId: string): void; onCancel(): void;
} | CadFeatureRegionPickCommand | { readonly kind: 'clear'; readonly owner: string };

/** Form-owned callbacks never mutate the accepted document or canvas selection. */
export const CadFeatureReferencePickingContext = createContext<{
  readonly precedingIds: ReadonlySet<string>;
  begin(label: string, eligibleIds: readonly string[], onSelect: (id: string) => void): void;
  beginRegions?(sketchId: string, cells: CadPreparedSketchCatalog, placement: CadResolvedPlacement, selection: CadSketchRegionSelection | undefined,
    onSelect: (selection: CadSketchRegionSelection) => void): void;
} | null>(null);
