import { describe, expect, it } from 'vitest';

import { initializeWorkbenchDirectory, type WorkbenchStorageAdapter } from '../workbenchStorage';

class MemoryWorkbenchAdapter implements WorkbenchStorageAdapter {
  readonly kind = 'memory';
  readonly directories = new Set<string>();
  readonly files = new Map<string, string>();

  constructor(readonly name = 'machine-jobs') {}

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

describe('initializeWorkbenchDirectory', () => {
  it('creates the folder structure, manifest, and persistent header/footer templates', async () => {
    const adapter = new MemoryWorkbenchAdapter('machine-jobs');

    const result = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T12:00:00.000Z')
    });

    expect([...adapter.directories].sort()).toEqual([
      'editor',
      'exports',
      'imports',
      'machines',
      'projects',
      'templates'
    ]);
    expect(adapter.directories.has('generated')).toBe(false);
    expect(adapter.files.get('templates/header.gcode')).toContain('G90 G21 G17 G40');
    expect(adapter.files.get('templates/footer.gcode')).toContain('M30');
    expect(result.manifest).toMatchObject({
      schemaVersion: 1,
      name: 'machine-jobs',
      createdAt: '2026-05-29T12:00:00.000Z',
      updatedAt: '2026-05-29T12:00:00.000Z',
      activeMachineProfileId: 'default-wire-machine',
      machineProfiles: [
        {
          id: 'default-wire-machine',
          name: 'Default Wire EDM',
          workArea: {
            widthMm: null,
            lengthMm: null
          }
        }
      ],
      projects: [],
      output: {
        extension: 'iso',
        lineEnding: 'crlf'
      },
      templates: {
        headerPath: 'templates/header.gcode',
        footerPath: 'templates/footer.gcode'
      }
    });
    expect(JSON.parse(adapter.files.get('workbench.json') || '{}')).toEqual(result.manifest);
    expect(result.activeMachineProfile.id).toBe('default-wire-machine');
  });

  it('preserves existing templates and projects when reconnecting a workbench folder', async () => {
    const adapter = new MemoryWorkbenchAdapter('machine-jobs');
    adapter.files.set('templates/header.gcode', '%\nCUSTOM HEADER');
    adapter.files.set('templates/footer.gcode', 'CUSTOM FOOTER\n%');
    adapter.files.set(
      'workbench.json',
      JSON.stringify({
        schemaVersion: 1,
        name: 'machine-jobs',
        createdAt: '2026-05-28T08:00:00.000Z',
        updatedAt: '2026-05-28T08:00:00.000Z',
        templates: {
          headerPath: 'templates/header.gcode',
          footerPath: 'templates/footer.gcode'
        },
        output: {
          extension: 'nc',
          lineEnding: 'lf'
        },
        projects: [
          {
            id: 'existing-job',
            name: 'existing-job',
            path: 'projects/existing-job/project.json',
            sourceKind: 'dxf',
            updatedAt: '2026-05-28T08:00:00.000Z'
          }
        ]
      })
    );

    const result = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T12:00:00.000Z')
    });

    expect(adapter.files.get('templates/header.gcode')).toBe('%\nCUSTOM HEADER');
    expect(adapter.files.get('templates/footer.gcode')).toBe('CUSTOM FOOTER\n%');
    expect(result.header).toBe('%\nCUSTOM HEADER');
    expect(result.footer).toBe('CUSTOM FOOTER\n%');
    expect(result.activeMachineProfile.templates.header).toBe('%\nCUSTOM HEADER');
    expect(result.activeMachineProfile.templates.footer).toBe('CUSTOM FOOTER\n%');
    expect(result.manifest.activeMachineProfileId).toBe('default-wire-machine');
    expect(result.manifest.machineProfiles[0].output.extension).toBe('nc');
    expect(result.manifest.createdAt).toBe('2026-05-28T08:00:00.000Z');
    expect(result.manifest.updatedAt).toBe('2026-05-29T12:00:00.000Z');
    expect(result.manifest.output.extension).toBe('nc');
    expect(result.manifest.projects).toHaveLength(1);
  });
});
