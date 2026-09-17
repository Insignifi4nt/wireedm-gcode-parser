import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PackageToolsPage } from './PackageToolsPage';
import { startPackageTool } from './packageToolsClient';

vi.mock('./packageToolsClient', () => ({ startPackageTool: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('PackageToolsPage', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<PackageToolsPage />));
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
  const button = (name: string) => Array.from(container.querySelectorAll('button')).find((item) => item.textContent === name)!;
  async function click(name: string) { await act(async () => button(name).click()); }
  async function fillDocument(text: string) {
    await act(async () => {
      const input = container.querySelector('textarea')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  it('downloads the checked archive bytes and clears the deliverable when inputs change', async () => {
    const bytes = new Uint8Array([80, 75, 0, 255]);
    vi.mocked(startPackageTool).mockReturnValue({ cancel: vi.fn(), result: Promise.resolve({
      report: { ok: true, operation: 'build-package', appVersion: '0.0.686', details: {} },
      output: { archive: bytes, fileName: 'checked.wireedm-package', documentText: '{}', files: [] }
    }) });
    let captured: Blob | undefined;
    vi.stubGlobal('URL', { createObjectURL: (blob: Blob) => { captured = blob; return 'blob:checked'; }, revokeObjectURL: vi.fn() });
    const clicked: { href: string; name: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push({ href: this.href, name: this.download }); });
    await click('Build package');
    await fillDocument('{}');
    await click('Validate and build package');
    expect(startPackageTool).toHaveBeenCalledWith({ operation: 'build-package', text: '{}', files: [] }, undefined);
    vi.useFakeTimers();
    await click('Download .wireedm-package');
    vi.runAllTimers();
    vi.useRealTimers();
    expect(clicked).toEqual([{ href: 'blob:checked', name: 'checked.wireedm-package' }]);
    const read = new FileReader();
    const contents = new Promise<ArrayBuffer>((resolve) => { read.onload = () => resolve(read.result as ArrayBuffer); });
    read.readAsArrayBuffer(captured!);
    expect(Array.from(new Uint8Array(await contents))).toEqual(Array.from(bytes));
    await fillDocument('{"changed":true}');
    expect(button('Download .wireedm-package')).toBeUndefined();
  });

  it('cancels an active check and permits correction without offering a stale download', async () => {
    let reject!: (reason: Error) => void;
    const cancel = vi.fn(() => reject(new Error('Check cancelled.')));
    vi.mocked(startPackageTool).mockReturnValue({ cancel, result: new Promise((_, fail) => { reject = fail; }) });
    await click('Build package');
    await fillDocument('{}');
    await click('Validate and build package');
    expect(container.querySelector('fieldset')?.disabled).toBe(true);
    await click('Cancel check');
    expect(cancel).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Check cancelled.');
    expect(container.querySelector('fieldset')?.disabled).toBe(false);
    expect(button('Download .wireedm-package')).toBeUndefined();
  });
});
