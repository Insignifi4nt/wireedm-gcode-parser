import { dxfEntitiesToUpidDocument } from '@/domain/dxf/dxfToUpid';
import type { DxfProcessor } from '@/domain/dxf/dxfProcessing';
import { prepareDxfImportSource, previewDxfProjectImport } from '@/domain/dxf/prepareDxfProjectImport';

export type DxfProcessorRequest =
  | { readonly kind: 'prepare'; readonly preference: Parameters<DxfProcessor['prepare']>[0]; readonly input: Parameters<DxfProcessor['prepare']>[1] }
  | { readonly kind: 'plan'; readonly entities: Parameters<DxfProcessor['plan']>[0]; readonly metadata: Parameters<DxfProcessor['plan']>[1] };

export type DxfProcessorResponse =
  | { readonly ok: true; readonly kind: 'prepare'; readonly result: Awaited<ReturnType<DxfProcessor['prepare']>> }
  | { readonly ok: true; readonly kind: 'plan'; readonly result: Awaited<ReturnType<DxfProcessor['plan']>> }
  | { readonly ok: false; readonly message: string };

/** The same pure algorithms serve workers and non-browser domain clients. */
export function runDxfProcessorTask(request: DxfProcessorRequest): DxfProcessorResponse {
  try {
    if (request.kind === 'plan') {
      // Retain the previous JSON snapshot semantics (omit undefined fields).
      return { ok: true, kind: 'plan', result: JSON.parse(JSON.stringify(dxfEntitiesToUpidDocument(request.entities, {}, request.metadata))) };
    }
    const result = prepareDxfImportSource(request.preference, request.input);
    if (!result.ok) return { ok: true, kind: 'prepare', result };
    const unitPreviews = Object.fromEntries(result.preparation.unitCandidates.map(candidate => [candidate.id,
      previewDxfProjectImport(result.preparation, { unitCandidateId: candidate.id })]));
    return { ok: true, kind: 'prepare', result: { ok: true, preparation: { ...result.preparation, unitPreviews } } };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
