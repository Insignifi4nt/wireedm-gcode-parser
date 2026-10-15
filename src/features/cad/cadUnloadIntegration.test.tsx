import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createBrowserCacheAdapter } from '@/domain/storage/browserCacheAdapter';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { loadCadDocument } from '@/domain/cad/cadStorage';
import { CadSession } from './cadSession';
import { useCadController, type CadController } from './useCadController';

let root: Root, container: HTMLDivElement;
beforeEach(() => { localStorage.clear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
function attemptsUnload() { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }

async function mount(session: CadSession) {
  const connected = await initializeWorkbenchCatalog(createBrowserCacheAdapter(localStorage, { namespace: 'cad-unload-integration' }));
  if (!connected.ok) throw new Error(connected.error.message);
  const workbench = connected.workbench;
  let controller: CadController | undefined;
  function Harness() {
    const [open, setOpen] = useState(true);
    controller = useCadController({ connectedWorkbench: workbench, workbenchInteractionLocked: false,
      runAgentWorkbenchOperation: async () => { throw new Error('Unexpected CAM operation'); } }, session, open, setOpen, () => null);
    return null;
  }
  await act(async () => root.render(<Harness />));
  return { controller: () => { if (!controller) throw new Error('Missing controller'); return controller; }, workbench };
}

it('releases the unload guard immediately after a durable Save and Undo, before React effects rerender', async () => {
  const session = new CadSession({ ...createCadDocument(), parameters: { thickness: 10 } });
  const h = await mount(session);
  expect(attemptsUnload()).toBe(true);
  await act(async () => {
    const receipt = await h.controller().save();
    expect(receipt.draftMarkedSaved).toBe(true);
    expect(session.getSnapshot().dirty).toBe(false);
    expect(attemptsUnload()).toBe(false);
  });
  expect((await loadCadDocument(h.workbench.adapter, session.getSnapshot().document.id)).document).toEqual(session.getSnapshot().document);
  await act(async () => h.controller().edit([{ kind: 'set-parameter', name: 'thickness', value: 15 }]));
  expect(attemptsUnload()).toBe(true);
  await act(async () => {
    h.controller().undo();
    expect(session.getSnapshot().dirty).toBe(false);
    expect(attemptsUnload()).toBe(false);
  });
});

it('protects a clean pending editor immediately, and releases it on Cancel or empty-document replacement', async () => {
  const session = new CadSession(); const h = await mount(session);
  await act(async () => { await h.controller().save(); });
  expect(attemptsUnload()).toBe(false);
  await act(async () => {
    session.setWorkflowOpen(true, 'editor');
    expect(attemptsUnload()).toBe(true);
    session.setWorkflowOpen(false, 'editor');
    expect(attemptsUnload()).toBe(false);
  });
  await act(async () => h.controller().edit([{ kind: 'set-parameter', name: 'thickness', value: 12 }]));
  expect(attemptsUnload()).toBe(true);
  await act(async () => {
    session.replace(createCadDocument());
    expect(attemptsUnload()).toBe(false);
  });
  await act(async () => h.controller().edit([{ kind: 'set-parameter', name: 'thickness', value: 14 }]));
  await act(async () => h.controller().back());
  expect(h.controller().isOpen()).toBe(false);
  expect(attemptsUnload()).toBe(true);
  act(() => root.render(null));
  expect(attemptsUnload()).toBe(false);
});
