/**
 * Recorded calls whose relation outcome the shared remap rule changes on purpose, by the replay key `operation inputhash`: what the call
 * gives now, and why. The release record and the change description list the same differences.
 */
export const REMAP_PARITY_DIFFERENCES: Readonly<Record<string, { readonly reason: string; readonly now: unknown }>> = {};
