import { describe, expect, it } from 'vitest';

import {
  initializeWorkbenchDirectory,
  WORKBENCH_MANIFEST_FILE,
  HEADER_TEMPLATE_PATH,
  FOOTER_TEMPLATE_PATH,
  type WorkbenchStorageAdapter
} from '../workbenchStorage';
import { updateWorkbenchSettings } from '../updateWorkbenchSettings';

class MemoryWorkbenchAdapter implements WorkbenchStorageAdapter {
  readonly kind = 'memory';
  readonly directories = new Set<string>();
  readonly files = new Map<string, string>();

  constructor(readonly name = 'settings-workbench') {}

  async ensureDirectory(path: string) {
    this.directories.add(path);
  }

  async readText(path: string) {
    return this.files.get(path) ?? null;
  }

  async writeText(path: string, contents: string) {
    this.files.set(path, contents);
  }
}

describe('updateWorkbenchSettings', () => {
  it('persists custom templates and output preferences in the active workbench', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });

    const updated = await updateWorkbenchSettings(workbench, {
      header: '%\nCUSTOM HEADER',
      footer: 'CUSTOM FOOTER\n%',
      output: {
        extension: 'nc',
        lineEnding: 'lf'
      },
      now: new Date('2026-05-29T11:00:00.000Z')
    });

    const manifest = JSON.parse(adapter.files.get(WORKBENCH_MANIFEST_FILE) || '{}');

    expect(adapter.files.get(HEADER_TEMPLATE_PATH)).toBe('%\nCUSTOM HEADER');
    expect(adapter.files.get(FOOTER_TEMPLATE_PATH)).toBe('CUSTOM FOOTER\n%');
    expect(manifest.output).toEqual({
      extension: 'nc',
      lineEnding: 'lf'
    });
    expect(manifest.updatedAt).toBe('2026-05-29T11:00:00.000Z');
    expect(updated.header).toBe('%\nCUSTOM HEADER');
    expect(updated.footer).toBe('CUSTOM FOOTER\n%');
    expect(updated.manifest.output.extension).toBe('nc');
  });

  it('preserves existing values when only one setting changes', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });

    const updated = await updateWorkbenchSettings(workbench, {
      output: {
        extension: 'custom',
        customExtension: 'cut',
        lineEnding: 'crlf'
      },
      now: new Date('2026-05-29T11:00:00.000Z')
    });

    expect(updated.header).toBe(workbench.header);
    expect(updated.footer).toBe(workbench.footer);
    expect(updated.manifest.output).toEqual({
      extension: 'custom',
      customExtension: 'cut',
      lineEnding: 'crlf'
    });
  });
});
