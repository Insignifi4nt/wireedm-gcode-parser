import { createContext } from 'react';
import type { CadPreparedSketchCells } from '@/domain/cad/cadSketchRegionInspection';
import type { CadSketchCellReference } from '@/domain/cad/cadSketchRegionSelection';
import type { CadResolvedPlacement } from '@/domain/cad/cadDatumPlanes';

export interface CadFeatureRegionPickCommand {
  readonly kind: 'pick-regions'; readonly owner: string; readonly expectedVersion: string;
  readonly label: string; readonly sketchId: string;
  readonly cells: CadPreparedSketchCells;
  readonly placement: CadResolvedPlacement;
  readonly selection: readonly CadSketchCellReference[] | undefined;
  onSelect(selection: readonly CadSketchCellReference[]): void;
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
  beginRegions?(sketchId: string, cells: CadPreparedSketchCells, placement: CadResolvedPlacement, selection: readonly CadSketchCellReference[] | undefined,
    onSelect: (selection: readonly CadSketchCellReference[]) => void): void;
} | null>(null);
