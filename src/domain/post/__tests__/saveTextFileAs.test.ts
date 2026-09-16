import { afterEach, describe, expect, it, vi } from 'vitest';

import { selectTextFileDestination, supportsSaveTextFileAs, writeSelectedTextFile } from '../saveTextFileAs';

describe('saveTextFileAs', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'showSaveFilePicker');
  });

  it('selects a JSON destination before writing the completed export', async () => {
    const write = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const handle = { createWritable: vi.fn(async () => ({ write, close })) };
    const picker = vi.fn(async () => handle);
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: picker });

    expect(supportsSaveTextFileAs()).toBe(true);
    const selected = await selectTextFileDestination('Spur gear.upid.json');
    expect(picker).toHaveBeenCalledWith(expect.objectContaining({
      suggestedName: 'Spur gear.upid.json'
    }));
    expect(handle.createWritable).not.toHaveBeenCalled();
    await writeSelectedTextFile(selected, '{"format":"portable-upid"}\n');
    expect(write).toHaveBeenCalledWith('{"format":"portable-upid"}\n');
    expect(close).toHaveBeenCalledOnce();
  });

  it('reports when the browser lacks a save picker', async () => {
    expect(supportsSaveTextFileAs()).toBe(false);
    await expect(selectTextFileDestination('project.upid.json')).rejects.toThrow('unavailable');
  });
});
