import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CadWorkspaceBoundary, type CadWorkspaceBoundaryProps } from './CadWorkspaceBoundary';

let root: Root; let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.spyOn(console, 'error').mockImplementation(() => undefined);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const failure = new Error('Failed to fetch dynamically imported module');
function BrokenWorkspace() { throw failure; return null; }
function props(): Omit<CadWorkspaceBoundaryProps, 'children'> {
  return { documentName: 'Accepted part', busy: false, onSave: vi.fn(async () => undefined), onDownloadDocument: vi.fn(), onFailure: vi.fn() };
}
async function render(options: Omit<CadWorkspaceBoundaryProps, 'children'>) {
  await act(async () => root.render(<CadWorkspaceBoundary {...options}><BrokenWorkspace /></CadWorkspaceBoundary>));
}
function button(label: string) {
  const element = [...container.querySelectorAll('button')].find(entry => entry.textContent === label);
  if (!element) throw new Error(`Missing ${label}`); return element;
}
async function click(label: string) { await act(async () => button(label).click()); }

describe('CAD workspace module failure recovery', () => {
  it('retains the controller owner and accepted document while releasing failed child workflows', async () => {
    const cleanup = vi.fn(); const onFailure = vi.fn(); const accepted = { name: 'Accepted part', version: 'v7' };
    function Workspace({ failed }: { failed: boolean }) {
      useEffect(() => cleanup, []);
      if (failed) throw failure;
      return <p>Workspace ready</p>;
    }
    function ControllerOwner() {
      const [document] = useState(accepted); const [failed, setFailed] = useState(false);
      return <><output>{document.version}</output><button onClick={() => setFailed(true)}>Break module</button>
        <CadWorkspaceBoundary {...props()} documentName={document.name} onFailure={onFailure}><Workspace failed={failed} /></CadWorkspaceBoundary></>;
    }
    await act(async () => root.render(<ControllerOwner />)); expect(container.textContent).toContain('Workspace ready');
    await click('Break module'); expect(cleanup).toHaveBeenCalledTimes(1); expect(onFailure).toHaveBeenCalledWith(failure);
    expect(container.querySelector('output')?.textContent).toBe('v7'); expect(container.textContent).toContain('Accepted part');
    expect(container.querySelector('[aria-label="CAD workspace recovery"]')).not.toBeNull();
  });

  it('shows normal save guard failures, permits retry and reports successful persistence', async () => {
    const options = props(); const onSave = vi.fn().mockRejectedValueOnce(new Error('The document changed. Try saving again.')).mockResolvedValueOnce(undefined);
    await render({ ...options, onSave }); await click('Save current document');
    expect(container.textContent).toContain('The document changed. Try saving again.'); expect(button('Download CAD document').disabled).toBe(false);
    await click('Save current document'); expect(onSave).toHaveBeenCalledTimes(2); expect(container.querySelector('[role="status"]')?.textContent).toBe('Document saved.');
    expect(options.onFailure).toHaveBeenCalledTimes(1);
  });

  it('uses the latest parent callbacks and never describes a download request as a saved file', async () => {
    const options = props(); await render(options);
    const onDownloadDocument = vi.fn(); await render({ ...options, documentName: 'Renamed accepted part', onDownloadDocument });
    await click('Download CAD document'); expect(onDownloadDocument).toHaveBeenCalledTimes(1); expect(options.onDownloadDocument).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Renamed accepted part'); expect(container.querySelector('[role="status"]')?.textContent).toContain('download requested');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Check that the file was downloaded');
  });

  it('serializes recovery requests and respects storage busy without resetting the failed workspace', async () => {
    let complete: () => void = () => undefined;
    const onSave = vi.fn(() => new Promise<void>(resolve => { complete = resolve; })); const options = { ...props(), onSave };
    await render({ ...options, busy: true }); expect(button('Save current document').disabled).toBe(true); expect(button('Download CAD document').disabled).toBe(true);
    await render(options);
    await act(async () => { button('Save current document').click(); button('Save current document').click(); button('Download CAD document').click(); });
    expect(onSave).toHaveBeenCalledTimes(1); expect(options.onDownloadDocument).not.toHaveBeenCalled(); expect(button('Download CAD document').disabled).toBe(true);
    await act(async () => complete()); expect(button('Download CAD document').disabled).toBe(false); expect(options.onFailure).toHaveBeenCalledTimes(1);
  });

  it('reports synchronous download errors and releases a pending action safely on unmount', async () => {
    const options = props(); const onDownloadDocument = vi.fn(() => { throw new Error('Download unavailable'); });
    await render({ ...options, onDownloadDocument }); await click('Download CAD document'); expect(container.textContent).toContain('Download unavailable');
    let complete: () => void = () => undefined;
    await render({ ...options, onSave: () => new Promise<void>(resolve => { complete = resolve; }) });
    await click('Save current document'); await act(async () => root.render(null)); await act(async () => complete()); expect(container.textContent).toBe('');
  });
});
