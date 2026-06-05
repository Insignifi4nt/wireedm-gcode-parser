import { describe, expect, it } from 'vitest';

import { importDxfProject } from '@/domain/dxf/importDxfProject';
import { initializeWorkbenchDirectory, type WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorage';

import { openWorkbenchProject } from '../openWorkbenchProject';

class MemoryWorkbenchAdapter implements WorkbenchStorageAdapter {
  readonly kind = 'memory';
  readonly directories = new Set<string>();
  readonly files = new Map<string, string>();

  constructor(readonly name = 'cache-workbench') {}

  async ensureDirectory(path: string) {
    this.directories.add(path);
  }

  async readText(path: string) {
    return this.files.get(path) ?? null;
  }

  async writeText(path: string, contents: string) {
    this.files.set(path, contents);
  }

  async deleteText(path: string) {
    this.files.delete(path);
  }
}

describe('openWorkbenchProject', () => {
  it('loads a stored UPID project file as the editor source without generated G-code text', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });
    const imported = await importDxfProject(workbench, {
      fileName: 'library-part.dxf',
      text: simpleLineDxf(),
      now: new Date('2026-05-29T11:00:00.000Z')
    });
    const projectPath = imported.workbench.manifest.projects[0].path;

    const opened = await openWorkbenchProject(imported.workbench, projectPath);

    expect(opened.project.id).toBe('library-part-2026-05-29');
    expect(opened.editorProgram.filePath).toBe('projects/library-part-2026-05-29/project.json');
    expect(opened.editorProgram.text).toBe('');
    expect(opened.editorProgram.parseResult).toBeNull();
    expect(opened.editorProgram.project?.upid?.document.plan.operations).toHaveLength(1);
  });

  it('throws a clear error when the stored project file is missing', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter);

    await expect(openWorkbenchProject(workbench, 'projects/missing/project.json')).rejects.toThrow(
      'Workbench project file not found'
    );
  });
});

function simpleLineDxf() {
  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'LINE',
    '10',
    '0',
    '20',
    '0',
    '11',
    '10',
    '21',
    '0',
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}
