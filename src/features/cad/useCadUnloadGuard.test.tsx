import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CadSession } from './cadSession';
import { useCadUnloadGuard } from './useCadUnloadGuard';

let container: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
function Harness({ session }: { session: CadSession }) { useCadUnloadGuard(session); return null; }
function attemptsUnload() { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }
function save(session: CadSession) { const current = session.getSnapshot(); session.markSaved({ document: current.document, savedVersion: 'baseline', updatedAt: '2026-10-14T12:00:00.000Z' }, current.version); }

it('protects current unsaved content and releases the guard after Save or Undo without requiring a rerender', () => {
  const session = new CadSession(); act(() => root.render(<Harness session={session} />));
  expect(attemptsUnload()).toBe(false);
  session.edit([{ kind: 'set-parameter', name: 'thickness', value: 10 }]);
  const unsaved = session.getSnapshot(); expect(attemptsUnload()).toBe(true); expect(session.getSnapshot()).toBe(unsaved);
  save(session); expect(attemptsUnload()).toBe(false);
  session.edit([{ kind: 'set-parameter', name: 'thickness', value: 15 }]); expect(attemptsUnload()).toBe(true);
  session.undo(); expect(attemptsUnload()).toBe(false);
});
it('protects pending CAD work even when the accepted document is clean', () => {
  const session = new CadSession(); save(session); act(() => root.render(<Harness session={session} />));
  session.setWorkflowOpen(true); const pending = session.getSnapshot();
  expect(attemptsUnload()).toBe(true); expect(session.getSnapshot()).toBe(pending);
  session.setWorkflowOpen(false); expect(attemptsUnload()).toBe(false);
});
it('follows a replacement session and removes its listener when the CAD host unmounts', () => {
  const old = new CadSession(); old.edit([{ kind: 'rename-document', name: 'Unsaved part' }]);
  act(() => root.render(<Harness session={old} />)); expect(attemptsUnload()).toBe(true);
  const replacement = new CadSession(); act(() => root.render(<Harness session={replacement} />)); expect(attemptsUnload()).toBe(false);
  replacement.edit([{ kind: 'rename-document', name: 'New part' }]); expect(attemptsUnload()).toBe(true);
  act(() => root.render(null)); expect(attemptsUnload()).toBe(false);
});
