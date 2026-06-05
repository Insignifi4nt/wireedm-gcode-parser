import { describe, expect, it } from 'vitest';

import { importDxfProject } from '@/domain/dxf/importDxfProject';
import { importExternalProgram } from '@/domain/editor/importExternalProgram';
import {
  initializeWorkbenchDirectory,
  type WorkbenchStorageAdapter
} from '@/domain/storage/workbenchStorage';

import { deleteWorkbenchProject } from '../deleteWorkbenchProject';

class MemoryWorkbenchAdapter implements WorkbenchStorageAdapter {
  readonly kind = 'memory';
  readonly directories = new Set<string>();
  readonly failedDeletes = new Set<string>();
  readonly files = new Map<string, string>();
  readonly operations: string[] = [];

  constructor(readonly name = 'delete-workbench') {}

  async ensureDirectory(path: string) {
    this.operations.push(`ensure:${path}`);
    this.directories.add(path);
  }

  async readText(path: string) {
    this.operations.push(`read:${path}`);
    return this.files.get(path) ?? null;
  }

  async writeText(path: string, contents: string) {
    this.operations.push(`write:${path}`);
    this.files.set(path, contents);
  }

  async deleteText(path: string) {
    this.operations.push(`delete:${path}`);
    if (this.failedDeletes.has(path)) {
      throw new Error(`Delete failed: ${path}`);
    }
    this.files.delete(path);
  }
}

describe('deleteWorkbenchProject', () => {
  it('loads the project JSON first and hard-deletes owned files', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });
    const imported = await importDxfProject(workbench, {
      fileName: 'fixture.dxf',
      text: [
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
      ].join('\n'),
      now: new Date('2026-05-29T11:00:00.000Z')
    });

    const deleted = await deleteWorkbenchProject(imported.workbench, {
      projectId: imported.project.id,
      now: new Date('2026-05-29T12:00:00.000Z')
    });

    const projectPath = imported.workbench.manifest.projects[0].path;
    const sourcePath = imported.project.source.files[0].path;
    const manifest = JSON.parse(adapter.files.get('workbench.json') || '{}');

    const readIndex = adapter.operations.indexOf(`read:${projectPath}`);
    const deleteProjectIndex = adapter.operations.indexOf(`delete:${projectPath}`);
    expect(readIndex).toBeGreaterThan(-1);
    expect(deleteProjectIndex).toBeGreaterThan(readIndex);
    expect(adapter.operations).toContain(`delete:${projectPath}`);
    expect(adapter.operations).toContain(`delete:${sourcePath}`);
    expect(adapter.files.has(projectPath)).toBe(false);
    expect(adapter.files.has(sourcePath)).toBe(false);
    expect(manifest.projects).toHaveLength(0);
    expect(manifest.updatedAt).toBe('2026-05-29T12:00:00.000Z');
    expect(deleted.project.id).toBe(imported.project.id);
    expect(deleted.project.name).toBe(imported.project.name);
  });

  it('deletes an external program project and its editor copy', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });
    const imported = await importExternalProgram(workbench, {
      fileName: 'fixture.nc',
      text: ['%', 'G90 G21', 'G0 X0 Y0', 'M30', '%'].join('\n'),
      now: new Date('2026-05-29T11:00:00.000Z')
    });

    const deleted = await deleteWorkbenchProject(imported.workbench, {
      projectId: imported.project.id,
      now: new Date('2026-05-29T12:00:00.000Z')
    });

    const projectPath = imported.workbench.manifest.projects[0].path;
    const sourcePath = imported.project.source.files[0].path;
    const editorPath = imported.project.editor.activeFilePath;
    const manifest = JSON.parse(adapter.files.get('workbench.json') || '{}');

    expect(adapter.files.has(projectPath)).toBe(false);
    expect(adapter.files.has(sourcePath)).toBe(false);
    expect(editorPath).toBeTruthy();
    expect(adapter.files.has(editorPath || '')).toBe(false);
    expect(manifest.projects).toHaveLength(0);
    expect(manifest.updatedAt).toBe('2026-05-29T12:00:00.000Z');
    expect(deleted.project.id).toBe(imported.project.id);
    expect(deleted.project.name).toBe(imported.project.name);
  });

  it('reports owned file cleanup failures after removing the manifest entry', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });
    const imported = await importExternalProgram(workbench, {
      fileName: 'fixture.nc',
      text: ['%', 'G90 G21', 'G0 X0 Y0', 'M30', '%'].join('\n'),
      now: new Date('2026-05-29T11:00:00.000Z')
    });
    const sourcePath = imported.project.source.files[0].path;
    adapter.failedDeletes.add(sourcePath);

    const deleted = await deleteWorkbenchProject(imported.workbench, {
      projectId: imported.project.id,
      now: new Date('2026-05-29T12:00:00.000Z')
    });

    const manifest = JSON.parse(adapter.files.get('workbench.json') || '{}');

    expect(manifest.projects).toHaveLength(0);
    expect(adapter.files.has(sourcePath)).toBe(true);
    expect(deleted.cleanupErrorMessages).toEqual([`Delete failed: ${sourcePath}`]);
  });
});
