import { describe, expect, it } from 'vitest';

import { importExternalProgram } from '@/domain/editor/importExternalProgram';
import {
  initializeWorkbenchDirectory,
  type WorkbenchStorageAdapter
} from '@/domain/storage/workbenchStorage';

import { renameWorkbenchProject } from '../renameWorkbenchProject';

class MemoryWorkbenchAdapter implements WorkbenchStorageAdapter {
  readonly kind = 'memory';
  readonly directories = new Set<string>();
  readonly files = new Map<string, string>();

  constructor(readonly name = 'rename-workbench') {}

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

describe('renameWorkbenchProject', () => {
  it('updates only the project display name and timestamps', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });
    const imported = await importExternalProgram(workbench, {
      fileName: 'fixture.nc',
      text: ['%', 'G90 G21', 'G0 X0 Y0', 'M30', '%'].join('\n'),
      now: new Date('2026-05-29T11:00:00.000Z')
    });

    const renamed = await renameWorkbenchProject(imported.workbench, {
      projectId: imported.project.id,
      name: 'Renamed Job',
      now: new Date('2026-05-29T12:00:00.000Z')
    });

    const projectPath = imported.workbench.manifest.projects[0].path;
    const project = JSON.parse(adapter.files.get(projectPath) || '{}');
    const manifest = JSON.parse(adapter.files.get('workbench.json') || '{}');

    expect(renamed.project.id).toBe(imported.project.id);
    expect(renamed.project.name).toBe('Renamed Job');
    expect(renamed.project.updatedAt).toBe('2026-05-29T12:00:00.000Z');
    expect(renamed.project.source.files[0].path).toBe('imports/fixture-2026-05-29.nc');
    expect(project.id).toBe(imported.project.id);
    expect(project.name).toBe('Renamed Job');
    expect(project.updatedAt).toBe('2026-05-29T12:00:00.000Z');
    expect(project.source.files[0].path).toBe('imports/fixture-2026-05-29.nc');
    expect(manifest.projects[0]).toMatchObject({
      id: imported.project.id,
      name: 'Renamed Job',
      path: projectPath,
      sourceKind: 'external-gcode',
      updatedAt: '2026-05-29T12:00:00.000Z'
    });
    expect(manifest.updatedAt).toBe('2026-05-29T12:00:00.000Z');
  });

  it('trims the incoming project name and rejects whitespace-only names', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });
    const imported = await importExternalProgram(workbench, {
      fileName: 'fixture.nc',
      text: ['%', 'G90 G21', 'G0 X0 Y0', 'M30', '%'].join('\n'),
      now: new Date('2026-05-29T11:00:00.000Z')
    });

    await expect(
      renameWorkbenchProject(imported.workbench, {
        projectId: imported.project.id,
        name: '  Renamed Job  ',
        now: new Date('2026-05-29T12:00:00.000Z')
      })
    ).resolves.toMatchObject({
      project: {
        name: 'Renamed Job'
      }
    });

    await expect(
      renameWorkbenchProject(imported.workbench, {
        projectId: imported.project.id,
        name: '   ',
        now: new Date('2026-05-29T12:00:00.000Z')
      })
    ).rejects.toThrow('Project name cannot be empty.');
  });
});
