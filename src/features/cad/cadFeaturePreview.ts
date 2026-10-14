import type { CadBuildResult, CadDocument, CadFeature } from '@/domain/cad/cadDocument';
import { applyCadEdits, type CadEdit } from '@/domain/cad/cadOperations';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import type { CadKernelClient } from './kernel/cadKernelClient';

export type CadFeatureCandidateEdits = readonly [Extract<CadEdit, { kind: 'add-feature' | 'update-feature' }>, ...Extract<CadEdit, { kind: 'set-parameter' }>[]];
export function cadFeatureCandidateEdits(input: { feature: CadFeature; isNew: boolean; parameters?: Readonly<Record<string, number>> }): CadFeatureCandidateEdits {
  return [{ kind: input.isNew ? 'add-feature' : 'update-feature', feature: input.feature },
    ...Object.entries(input.parameters ?? {}).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([name, value]) => ({ kind: 'set-parameter' as const, name, value }))];
}
export function cadFeatureCandidateKey(edits: CadFeatureCandidateEdits): string { return JSON.stringify(edits); }

export type CadFeaturePreviewCommand = { readonly kind: 'candidate'; readonly owner: string; readonly expectedVersion: string; readonly edits: CadFeatureCandidateEdits }
  | { readonly kind: 'blocked'; readonly owner: string; readonly expectedVersion: string; readonly edits: CadFeatureCandidateEdits; readonly message: string }
  | { readonly kind: 'clear'; readonly owner: string };
interface PreviewIdentity { readonly owner: string; readonly baseVersion: string; readonly candidateId: string; readonly featureId: string; readonly definitionKey: string }
export interface CadFeaturePreviewSnapshot extends PreviewIdentity { readonly document: CadDocument; readonly result: CadBuildResult }
export type CadFeaturePreviewState = { readonly kind: 'idle' }
  | (PreviewIdentity & { readonly kind: 'waiting'; readonly lastValid?: CadFeaturePreviewSnapshot })
  | (PreviewIdentity & { readonly kind: 'building'; readonly lastValid?: CadFeaturePreviewSnapshot })
  | (CadFeaturePreviewSnapshot & { readonly kind: 'ready' })
  | (PreviewIdentity & { readonly kind: 'error'; readonly stage: 'validation' | 'kernel'; readonly message: string; readonly diagnostics: CadBuildResult['diagnostics']; readonly lastValid?: CadFeaturePreviewSnapshot });
interface Candidate extends PreviewIdentity {
  readonly serial: number;
  readonly document: CadDocument;
  readonly baseDocument: CadDocument;
  readonly storage: WorkbenchStorageAdapter;
}
const idle: CadFeaturePreviewState = Object.freeze({ kind: 'idle' });

/** Candidates never enter session history or the accepted kernel's exact cache. */
export function createCadFeaturePreviewCoordinator(options: {
  assertCurrent(expectedVersion: string): { readonly document: CadDocument; readonly storage: WorkbenchStorageAdapter };
  createKernel(): Promise<Pick<CadKernelClient, 'build' | 'dispose'>>;
  onChange(state: CadFeaturePreviewState): void;
  debounceMs?: number;
}) {
  let owner: string | null = null, serial = 0, disposed = false;
  let latest: Candidate | null = null;
  let lastValid: CadFeaturePreviewSnapshot | null = null;
  let environment: { readonly document: CadDocument; readonly storage: WorkbenchStorageAdapter } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let active: { readonly candidate: Candidate; readonly controller: AbortController } | null = null;
  let client: Promise<Pick<CadKernelClient, 'build' | 'dispose'>> | null = null;
  const publish = (state: CadFeaturePreviewState) => { if (!disposed) options.onChange(Object.freeze(state)); };
  function clear() {
    if (timer !== null) clearTimeout(timer); timer = null;
    owner = null; latest = null; lastValid = null; environment = null; ++serial;
    active?.controller.abort(); active = null;
    const previous = client; client = null;
    void previous?.then(value => value.dispose(), () => undefined);
    publish(idle);
  }
  function owns(candidate: Candidate) { return owner === candidate.owner && serial === candidate.serial; }
  function current(candidate: Candidate) {
    if (!owns(candidate)) return false;
    try {
      const accepted = options.assertCurrent(candidate.baseVersion);
      return accepted.document === candidate.baseDocument && accepted.storage === candidate.storage;
    } catch { return false; }
  }
  function identity(candidate: PreviewIdentity): PreviewIdentity {
    return { owner: candidate.owner, baseVersion: candidate.baseVersion, candidateId: candidate.candidateId, featureId: candidate.featureId, definitionKey: candidate.definitionKey };
  }
  function retained(candidate: PreviewIdentity) {
    return lastValid && lastValid.owner === candidate.owner && lastValid.baseVersion === candidate.baseVersion && lastValid.featureId === candidate.featureId ? { lastValid } : {};
  }
  function run() {
    if (disposed || active || timer !== null || !latest) return;
    const candidate = latest; latest = null;
    if (!current(candidate)) { if (owns(candidate)) clear(); return; }
    const job = { candidate, controller: new AbortController() }; active = job;
    const kernel = client ??= Promise.resolve().then(options.createKernel);
    void kernel.catch(() => { if (client === kernel) client = null; });
    publish({ ...identity(candidate), ...retained(candidate), kind: 'building' });
    void kernel.then(value => {
      job.controller.signal.throwIfAborted();
      return value.build(candidate.document, job.controller.signal);
    }).then(result => {
      if (!current(candidate)) { if (owns(candidate)) clear(); return; }
      if (result.diagnostics.length) publish({ ...identity(candidate), ...retained(candidate), kind: 'error', stage: 'kernel', message: result.diagnostics[0].message, diagnostics: result.diagnostics });
      else {
        lastValid = { ...identity(candidate), document: candidate.document, result };
        publish({ ...lastValid, kind: 'ready' });
      }
    }).catch((error: unknown) => {
      if (job.controller.signal.aborted) return;
      if (!current(candidate)) { if (owns(candidate)) clear(); return; }
      publish({ ...identity(candidate), ...retained(candidate), kind: 'error', stage: 'kernel', message: error instanceof Error ? error.message : 'The native candidate could not be built.', diagnostics: [] });
    }).finally(() => {
      if (active === job) { active = null; run(); }
    });
  }
  function update(command: CadFeaturePreviewCommand) {
    if (disposed) return;
    if (command.kind === 'clear') { if (owner === command.owner) clear(); return; }
    if (owner !== command.owner) clear();
    owner = command.owner;
    if (timer !== null) clearTimeout(timer); timer = null;
    latest = null; ++serial;
    const request: PreviewIdentity = { owner, baseVersion: command.expectedVersion, candidateId: crypto.randomUUID(), featureId: command.edits[0].feature.id, definitionKey: cadFeatureCandidateKey(command.edits) };
    try {
      let accepted: ReturnType<typeof options.assertCurrent>;
      try { accepted = options.assertCurrent(command.expectedVersion); }
      catch (error) { clear(); throw error; }
      if (environment && (environment.document !== accepted.document || environment.storage !== accepted.storage)) { clear(); owner = command.owner; }
      environment = accepted;
      if (command.kind === 'blocked') {
        active?.controller.abort();
        publish({ ...request, ...retained(request), kind: 'error', stage: 'validation', message: command.message, diagnostics: [] });
        return;
      }
      const document = applyCadEdits(accepted.document, command.edits);
      latest = { ...request, serial, document, baseDocument: accepted.document, storage: accepted.storage };
      publish({ ...request, ...retained(request), kind: 'waiting' });
      timer = setTimeout(() => { timer = null; run(); }, options.debounceMs ?? 200);
    } catch (error) {
      publish({ ...request, ...retained(request), kind: 'error', stage: 'validation', message: error instanceof Error ? error.message : 'The candidate is not valid.', diagnostics: [] });
    }
  }
  return { update, invalidate: clear, dispose() { if (disposed) return; disposed = true; clear(); } };
}
