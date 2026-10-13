import type { CadDocument } from './cadDocument';
import { parseCadDocument } from './cadSchema';
import { prepareCadDatumFrames, type CadDatumFrameLookup } from './cadDatumPlanes';

const frames = new WeakMap<CadDocument, CadDatumFrameLookup>();
/** Only detached immutable parser outputs are retained; mutable lookalikes reparse. */
export function prepareCadDocumentFrames(document: CadDocument): CadDatumFrameLookup {
  const accepted = parseCadDocument(document);
  let lookup = frames.get(accepted);
  if (!lookup) {
    lookup = prepareCadDatumFrames(accepted.features, accepted.parameters);
    frames.set(accepted, lookup);
  }
  return lookup;
}
