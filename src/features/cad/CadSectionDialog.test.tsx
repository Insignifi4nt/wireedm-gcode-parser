import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CadSectionRequest, CadSectionResult } from '@/domain/cad/cadSection';
import { CadSectionDialog } from './CadSectionDialog';

let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  HTMLDialogElement.prototype.showModal = vi.fn();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const section: CadSectionResult = { bodyId: 'pad', plane: 'XY', offset: 5, contourCount: 1, entities: [{ type: 'circle', layer: 'CAD', center: { x: 0, y: 0 }, radius: 10 }] };
const button = (name: string) => {
  const result = [...host.querySelectorAll('button')].find(button => button.textContent === name);
  if (!result) throw new Error(`Button ${name} missing`); return result;
};
it('pins the preview to its exact request and requires fresh review after changing the plane', async () => {
  const inspect = vi.fn(async () => section); const send = vi.fn(async () => undefined); const close = vi.fn();
  await act(async () => root.render(<CadSectionDialog bodies={[{ featureId: 'pad', name: 'Pad' }]} initialBodyId="pad" version="v1" onInspect={inspect} onSend={send} onClose={close} />));
  expect(button('Send section to CAM').disabled).toBe(true);
  await act(async () => button('Preview section').click());
  expect(inspect).toHaveBeenCalledWith({ bodyId: 'pad', plane: 'XY', offset: '0' }, 'v1', expect.any(AbortSignal));
  expect(host.querySelector('svg')?.getAttribute('aria-label')).toBe('Exact section preview');
  expect(button('Send section to CAM').disabled).toBe(false);
  const select = host.querySelectorAll('select')[1];
  await act(async () => { select.value = 'YZ'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(button('Send section to CAM').disabled).toBe(true);
  expect(host.querySelector('svg')).toBeNull();
  await act(async () => button('Preview section').click());
  await act(async () => button('Send section to CAM').click());
  expect(send).toHaveBeenCalledWith({ bodyId: 'pad', plane: 'YZ', offset: '0' }, 'v1', expect.any(AbortSignal));
  expect(close).toHaveBeenCalledOnce();
});
it('aborts outstanding section computation and preserves the dialog on a reported failure', async () => {
  let signal: AbortSignal | undefined;
  const inspect = vi.fn((_request: CadSectionRequest, _version: string, current: AbortSignal) => {
    signal = current;
    return new Promise<CadSectionResult>((_resolve, reject) => current.addEventListener('abort', () => reject(new DOMException('Canceled', 'AbortError'))));
  });
  await act(async () => root.render(<CadSectionDialog bodies={[{ featureId: 'pad', name: 'Pad' }]} initialBodyId="pad" version="v1" onInspect={inspect} onSend={async () => undefined} onClose={vi.fn()} />));
  await act(async () => button('Preview section').click());
  expect(button('Close').disabled).toBe(true);
  await act(async () => button('Cancel section').click());
  expect(signal?.aborted).toBe(true);
  expect(button('Close').disabled).toBe(false);
  expect(button('Send section to CAM').disabled).toBe(true);
  expect(host.querySelector('[role=alert]')).toBeNull();
});
