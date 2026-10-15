import { act, useState, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { createBrowserCacheAdapter } from '@/domain/storage/browserCacheAdapter';
import type { CadDocument } from '@/domain/cad/cadDocument';
import { CadSession } from './cadSession';
import { CadFeatureEditor } from './CadFeatureEditor';
import { cadFeatureCandidateEdits, createCadFeaturePreviewCoordinator, type CadFeaturePreviewState } from './cadFeaturePreview';

let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function input() { const control = container.querySelector<HTMLInputElement>('input[aria-label="Length mm"]'); if (!control) throw new Error('Missing Length'); return control; }
async function type(text: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), text); input().dispatchEvent(new Event('input', { bubbles: true })); }); }
async function settle() { await act(async () => vi.runOnlyPendingTimersAsync()); }
function apply() { const button = container.querySelector<HTMLButtonElement>('button[type="submit"]'); if (!button) throw new Error('Missing Apply'); return button; }
it('retains the last valid provisional document and private client through invalid numeric/relation text, without authorizing Apply', async () => {
  const session = new CadSession({ ...createCadDocument(), parameters: { depth: 10 }, features: [
    { id: 'sketch', name: 'Outline', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [
      { id: 'rectangle', name: 'Rectangle', construction: false, geometry: { kind: 'rectangle', x: 0, y: 0, width: 20, height: 10, cornerRadius: 0 } }
    ] },
    { id: 'pad', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: 'sketch', distance: ' depth ', symmetric: false, operation: 'new', targetId: null }
  ] }), before = session.getSnapshot(), storage = createBrowserCacheAdapter(localStorage, { namespace: 'preview-retention' });
  const build = vi.fn(async (_document: CadDocument) => ({ buildId: crypto.randomUUID(), meshes: [], diagnostics: [], durationMs: 0 })), dispose = vi.fn();
  const createKernel = vi.fn(async () => ({ build, dispose }));
  let current: CadFeaturePreviewState = { kind: 'idle' }, publish: ((state: CadFeaturePreviewState) => void) | undefined;
  const readPreview = (): CadFeaturePreviewState => current;
  const coordinator = createCadFeaturePreviewCoordinator({ debounceMs: 0, createKernel, onChange: state => { current = state; publish?.(state); },
    assertCurrent: version => { if (session.getSnapshot().version !== version) throw new Error('Stale part'); return { document: session.getSnapshot().document, storage }; } });
  function Harness() {
    const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot), [preview, setPreview] = useState<CadFeaturePreviewState>({ kind: 'idle' }), [visible, setVisible] = useState(true); publish = setPreview;
    return visible ? <CadFeatureEditor feature={snapshot.document.features[1]} document={snapshot.document} documentVersion={snapshot.version} isNew={false}
      featurePreview={preview} onFeaturePreview={coordinator.update} onPendingChange={session.setWorkflowOpen} onCancel={() => { coordinator.invalidate(); session.setWorkflowOpen(false); setVisible(false); }}
      onApply={(feature, parameters) => session.edit(cadFeatureCandidateEdits({ feature, isNew: false, parameters }))} /> : null;
  }
  try {
    await act(async () => root.render(<Harness />)); await type('27'); await settle();
    const ready = readPreview(); if (ready.kind !== 'ready') throw new Error('Expected ready provisional geometry');
    expect(ready.document.parameters.depth).toBe(27); expect(apply().disabled).toBe(false);
    await type('');
    const { kind: _kind, ...readySnapshot } = ready;
    expect(current).toMatchObject({ kind: 'error', stage: 'validation', lastValid: readySnapshot }); expect(apply().disabled).toBe(true);
    expect(build).toHaveBeenCalledTimes(1); expect(createKernel).toHaveBeenCalledTimes(1); expect(dispose).not.toHaveBeenCalled();
    await act(async () => container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(session.getSnapshot()).toMatchObject({ document: before.document, version: before.version, canUndo: false, workflowOpen: true });
    await type('30'); expect(apply().disabled).toBe(true); await settle(); expect(apply().disabled).toBe(false);
    expect(createKernel).toHaveBeenCalledTimes(1); expect(build).toHaveBeenCalledTimes(2); expect(dispose).not.toHaveBeenCalled();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Edit Length relation"]')?.click());
    const relation = document.querySelector<HTMLInputElement>('[aria-label="Length expression"]'); if (!relation) throw new Error('Missing relation');
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(relation, 'depth /'); relation.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(current).toMatchObject({ kind: 'error', stage: 'validation', lastValid: { document: { parameters: { depth: 30 } } } });
    expect(apply().disabled).toBe(true); expect(createKernel).toHaveBeenCalledTimes(1); expect(dispose).not.toHaveBeenCalled();
    await act(async () => { const cancel = [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Cancel'); if (!cancel) throw new Error('Missing Cancel'); cancel.click(); });
    expect(readPreview().kind).toBe('idle'); expect(dispose).toHaveBeenCalledTimes(1); expect(session.getSnapshot()).toEqual(before);
  } finally { coordinator.dispose(); }
});
