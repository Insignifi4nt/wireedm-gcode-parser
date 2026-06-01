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
        sourceRequiresCleanup: false,
        activeFilePath: null,
        pinnedLineNumbers: []
      }
    });
    expect('generated' in project).toBe(false);
    expect(project.machine.templates.header).toContain('G90 G21 G17 G40');
    expect(project.machine.templates.footer).toContain('M30');
    expect(project.machine.output.extension).toBe('iso');
  });

  it('marks external gcode imports for the cleanup/display pipeline', () => {
    const project = createWorkbenchProject({
      name: 'External Input',
      sourceKind: 'external-gcode',
      now: new Date('2026-05-29T10:00:00.000Z')
    });

    expect(project.editor.sourceRequiresCleanup).toBe(true);
    expect(project.id).toBe('external-input-2026-05-29');
  });
});
