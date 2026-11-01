import type { CadDocument, CadFeatureBase } from '../cadDocument';

/**
 * What decides whether a feature takes part in a rebuild: the document it is read in. A document is a scope. Conditional suppression
 * (after Q1) will read its parameters, and K4's rollback position will join it.
 */
export interface CadFeatureScope { readonly parameters: CadDocument['parameters'] }

/**
 * Whether `feature` takes part in rebuilds, references and outputs in `scope`. Every reader of suppression asks this rather than the
 * stored flag, which `scripts/check-feature-activity.ts` keeps to this module.
 */
export function cadFeatureActive(feature: Pick<CadFeatureBase, 'suppressed'>, _scope: CadFeatureScope): boolean {
  return !feature.suppressed;
}

/** The suppression its author set, which toggles and copies of the feature edit and keep. Whether it is active is `cadFeatureActive`. */
export function cadFeatureSuppressionFlag(feature: Pick<CadFeatureBase, 'suppressed'>): boolean {
  return feature.suppressed;
}
