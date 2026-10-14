import { createContext } from 'react';

export type CadFeatureReferencePickCommand = {
  readonly kind: 'pick'; readonly owner: string; readonly expectedVersion: string;
  readonly label: string; readonly eligibleIds: readonly string[];
  onSelect(featureId: string): void; onCancel(): void;
} | { readonly kind: 'clear'; readonly owner: string };

/** Form-owned callbacks never mutate the accepted document or canvas selection. */
export const CadFeatureReferencePickingContext = createContext<{
  readonly precedingIds: ReadonlySet<string>;
  begin(label: string, eligibleIds: readonly string[], onSelect: (id: string) => void): void;
} | null>(null);
