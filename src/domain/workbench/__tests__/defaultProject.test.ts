import { describe, expect, it } from 'vitest';

import { createWorkbenchProject } from '../defaultProject';

describe('createWorkbenchProject', () => {
  it('creates a local-first project model with persistent header and footer templates', () => {
    const project = createWorkbenchProject({
      id: 'fixture-part',
      name: 'Fixture Part',
      sourceKind: 'dxf',
      now: new Date('2026-05-29T10:00:00.000Z')
    });

    expect(project).toMatchObject({
      schemaVersion: 1,
      id: 'fixture-part',
      name: 'Fixture Part',
      createdAt: '2026-05-29T10:00:00.000Z',
      source: { kind: 'dxf', files: [] },
      editor: {
        activeFilePath: null,
        pinnedLineNumbers: []
      }
    });
    expect('generated' in project).toBe(false);
    expect('sourceRequiresCleanup' in project.editor).toBe(false);
    expect(project.machine.templates.header).toContain('G90 G21 G17 G40');
    expect(project.machine.templates.footer).toContain('M30');
    expect(project.machine.output.extension).toBe('iso');
  });

  it('creates external gcode projects without persisting cleanup flags', () => {
    const project = createWorkbenchProject({
      name: 'External Input',
      sourceKind: 'external-gcode',
      now: new Date('2026-05-29T10:00:00.000Z')
    });

    expect('sourceRequiresCleanup' in project.editor).toBe(false);
    expect(project.id).toBe('external-input-2026-05-29');
  });

  it('requires every project to declare a real source kind', () => {
    expect(() =>
      createWorkbenchProject({
        name: 'Untyped Input',
        now: new Date('2026-05-29T10:00:00.000Z')
      } as Parameters<typeof createWorkbenchProject>[0])
    ).toThrow('Project source kind is required.');
  });
});
