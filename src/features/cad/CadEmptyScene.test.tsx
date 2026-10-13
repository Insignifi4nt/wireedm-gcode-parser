import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadDocument, CadSketchFeature } from '@/domain/cad/cadDocument';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { CadSession } from './cadSession';
import { CadWorkbench, type CadWorkbenchProps } from './CadWorkbench';
import type { CadViewportEmptyAction } from './CadViewport';

vi.mock('./CadViewport', () => ({ CadViewport: ({ emptyAction, interactionLocked }: { emptyAction: CadViewportEmptyAction | null; interactionLocked: boolean }) =>
  <div className="cad-empty-scene">{emptyAction && <button disabled={interactionLocked} title={emptyAction.description} onClick={emptyAction.onAction}>{emptyAction.label}</button>}</div> }));
let root: Root; let container: HTMLDivElement; let session: CadSession;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const outline: CadSketchFeature = { id: 'outline', name: 'Outline', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false,
  profiles: [{ id: 'profile', name: 'L profile', construction: false, geometry: { kind: 'polygon', points: [[0, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20]] } }] };
const emptySketch: CadSketchFeature = { id: 'empty', name: 'Empty sketch', kind: 'sketch', plane: 'XZ', offset: 7, suppressed: false, profiles: [] };
async function mount(document = createCadDocument(), buildState: CadWorkbenchProps['buildState'] = 'idle', storageBusy = false) {
  session = new CadSession(document);
  function Harness() {
    const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
    return <CadWorkbench document={snapshot.document} documentVersion={snapshot.version} buildVersion={null} build={null} buildState={buildState} storageBusy={storageBusy}
      dirty={snapshot.dirty} canUndo={snapshot.canUndo} canRedo={snapshot.canRedo} onEdit={edit => { session.edit([edit]); }}
      onWorkflowChange={session.setWorkflowOpen} onUndo={session.undo} onRedo={session.redo} onBack={vi.fn()} onSave={async () => undefined}
      onOpenDocument={vi.fn()} onNewDocument={vi.fn()} onImportDocument={async () => undefined} onExportDocument={vi.fn()}
      onExportSolid={async () => undefined} onExportDxf={async () => undefined} onSendToCam={async () => undefined} />;
  }
  await act(async () => root.render(<Harness />));
}
function action() { const button = container.querySelector<HTMLButtonElement>('.cad-empty-scene button'); if (!button) throw new Error('Empty scene action unavailable'); return button; }
async function click(button: HTMLButtonElement) { await act(async () => button.click()); }
function namedButton(label: string) { const button = [...container.querySelectorAll('button')].find(entry => entry.textContent?.trim() === label); if (!button) throw new Error(`Missing ${label}`); return button; }

describe('truthful empty CAD scene actions', () => {
  it('starts a provisional sketch only for a genuinely blank document', async () => {
    await mount(); const before = session.getSnapshot(); expect(action().textContent).toBe('Create sketch'); await click(action());
    expect(container.querySelector('.cad-property-title')?.textContent).toBe('Create Sketch');
    expect(session.getSnapshot()).toMatchObject({ document: before.document, version: before.version, canUndo: false, workflowOpen: true });
    await click(namedButton('Cancel')); expect(session.getSnapshot()).toEqual(before);
  });

  it('uses the actual closed profile sketch even while an unrelated empty sketch is selected', async () => {
    await mount({ ...createCadDocument(), features: [outline, emptySketch] }); const before = session.getSnapshot();
    await click(namedButton('Empty sketch')); expect(action().textContent).toBe('Pad sketch'); expect(action().title).toContain('Outline'); await click(action());
    const source = [...container.querySelectorAll('select')].find(element => element.closest('label')?.textContent?.startsWith('Profile sketch'));
    expect(source?.value).toBe('outline'); expect(container.querySelector('.cad-property-title')?.textContent).toBe('Create Pad / Pocket');
    expect(session.getSnapshot()).toMatchObject({ document: before.document, version: before.version, canUndo: false, workflowOpen: true });
    await click(namedButton('Cancel')); expect(session.getSnapshot()).toEqual(before);
  });

  it.each(['empty', 'construction-only'])('opens an existing %s sketch without creating another feature', async kind => {
    const drawingSketch = kind === 'empty' ? emptySketch : { ...emptySketch, profiles: outline.profiles.map(profile => ({ ...profile, construction: true })) };
    await mount({ ...createCadDocument(), features: [{ ...outline, suppressed: true }, drawingSketch] }); const before = session.getSnapshot();
    expect(action().textContent).toBe('Open sketch'); expect(action().title).toContain('Empty sketch'); await click(action());
    expect(container.querySelector('[aria-label="Sketch drawing canvas"]')).not.toBeNull(); expect(namedButton('Finish sketch')).toBeDefined(); expect(session.getSnapshot()).toBe(before);
    await click(namedButton('Finish sketch')); expect(action().textContent).toBe('Open sketch');
  });

  it.each(['building', 'error'] satisfies CadWorkbenchProps['buildState'][])('leaves active solid %s guidance to the build status and diagnostics', async buildState => {
    const document: CadDocument = { ...createCadDocument(), features: [outline, { id: 'pad', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: outline.id, distance: 5, symmetric: false, operation: 'new', targetId: null }] };
    await mount(document, buildState); expect(container.querySelector('.cad-empty-scene button')).toBeNull(); expect(session.getSnapshot().document.features).toHaveLength(2);
  });

  it('does not bypass pending fields or storage work through the empty scene action', async () => {
    await mount({ ...createCadDocument(), features: [outline] }); const before = session.getSnapshot();
    const name = container.querySelector<HTMLInputElement>('[aria-label="Part name"]'); if (!name) throw new Error('Part name missing');
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'Pending name'); name.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(action().disabled).toBe(true); await click(action()); expect(session.getSnapshot().document).toBe(before.document); expect(session.getSnapshot().workflowOpen).toBe(true);
    await act(async () => name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))); expect(action().disabled).toBe(false);
    await act(async () => root.render(null)); await mount({ ...createCadDocument(), features: [outline] }, 'idle', true); expect(action().disabled).toBe(true);
  });
});
