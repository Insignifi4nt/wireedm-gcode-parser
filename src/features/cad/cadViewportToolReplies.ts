import { jsonByteLength } from '@/features/webmcp/diagnosticSummaries';
import type { CadSession } from './cadSession';
import type { CadViewportState } from './cadViewportControls';

// One current observed metadata identity per session; no retained scene history.
const identities = new WeakMap<CadSession, { identity: string; token: string }>();

export function cadViewportMetadataToken(session: CadSession, state: CadViewportState) {
  const identity = JSON.stringify(state), previous = identities.get(session);
  if (previous?.identity === identity) return previous.token;
  const token = crypto.randomUUID();
  identities.set(session, { identity, token });
  return token;
}

function takeIds(ids: readonly string[], availableBytes: number) {
  const retained: string[] = [];
  let bytes = 0;
  for (const id of ids) {
    const rowBytes = jsonByteLength(id) + (retained.length ? 1 : 0);
    if (bytes + rowBytes > availableBytes) break;
    retained.push(id); bytes += rowBytes;
  }
  return retained;
}

/** Only public tool replies are summarized; source/capture metadata remains complete. */
export function cadViewportToolState(session: CadSession, state: CadViewportState, receipt: (summary: unknown) => unknown = summary => summary) {
  const references = state.view?.mode === 'solid' ? state.view.referenceFeatureIds : undefined;
  const viewportToken = cadViewportMetadataToken(session, state);
  const make = (bodies: readonly string[], ids: readonly string[] | undefined) => ({ ...state,
    viewportToken, visibleBodyIds: bodies,
    visibleBodyCount: state.visibleBodyIds.length, omittedVisibleBodies: bodies.length < state.visibleBodyIds.length,
    omittedVisibleBodyCount: state.visibleBodyIds.length - bodies.length,
    view: references !== undefined && state.view?.mode === 'solid' ? { ...state.view, referenceFeatureIds: ids,
      referenceFeatureCount: references.length, omittedReferenceFeatures: (ids?.length ?? 0) < references.length,
      omittedReferenceFeatureCount: references.length - (ids?.length ?? 0) } : state.view });
  const complete = make(state.visibleBodyIds, references);
  if (jsonByteLength({ ok: true, data: receipt(complete) }) <= 32 * 1024) return complete;
  const empty = make([], references === undefined ? undefined : []);
  // Two omission booleans can grow by one byte when a collection becomes complete.
  const available = Math.max(0, 32 * 1024 - jsonByteLength({ ok: true, data: receipt(empty) }) - 2);
  const collections = Number(state.visibleBodyIds.length > 0) + Number(Boolean(references?.length));
  const perCollection = Math.floor(available / Math.max(1, collections));
  return make(takeIds(state.visibleBodyIds, perCollection), references === undefined ? undefined : takeIds(references, perCollection));
}
