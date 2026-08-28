import { describe, expect, it } from 'vitest';

import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';

import {
  createWorkbenchProjectDocument,
  parseWorkbenchProjectDocument
} from '../workbenchProject';

describe('clean-break workbench project document', () => {
  it('creates a persisted UPID draft with no machine or post selection', () => {
    const result = createWorkbenchProjectDocument({
      id: 'portable-part',
      name: 'Portable Part',
      source: { kind: 'upid', files: [] },
      content: { kind: 'upid-document', document: createUpidFromDxfEntities([]) },
      now: new Date('2026-08-28T12:00:00.000Z')
    });
    if (!result.ok) throw new Error(result.error.message);

    expect(result.project).toMatchObject({
      format: 'wire-edm-project',
      schemaVersion: 2,
      source: { kind: 'upid' },
      content: { kind: 'upid-document' },
      savedRevisionIds: []
    });
    expect('machine' in result.project).toBe(false);
    expect('post' in result.project).toBe(false);
    expect(parseWorkbenchProjectDocument(JSON.stringify(result.project))).toEqual({
      ok: true,
      project: result.project
    });
  });

  it('rejects version-1 projects with a precise clean-break error', () => {
    expect(parseWorkbenchProjectDocument(JSON.stringify({
      schemaVersion: 1,
      id: 'legacy-project',
      machine: { id: 'legacy-machine' }
    }))).toEqual({
      ok: false,
      error: {
        code: 'WORKBENCH_PROJECT_VERSION_UNSUPPORTED',
        message: 'Workbench project schema version 1 is unsupported. Create or import a version-2 project.',
        foundVersion: 1,
        supportedVersion: 2
      }
    });
  });

  it('rejects source/content mismatches rather than guessing the editor model', () => {
    const created = createWorkbenchProjectDocument({
      id: 'external-program',
      name: 'External Program',
      source: {
        kind: 'external-gcode',
        files: [{
          name: 'input.iso',
          path: 'imports/input.iso',
          kind: 'external-gcode',
          createdAt: '2026-08-28T12:00:00.000Z'
        }]
      },
      content: { kind: 'external-gcode', activeFilePath: 'imports/input.iso' },
      now: new Date('2026-08-28T12:00:00.000Z')
    });
    if (!created.ok) throw new Error(created.error.message);
    const tampered = structuredClone(created.project) as Record<string, unknown>;
    tampered.content = { kind: 'upid-document', document: createUpidFromDxfEntities([]) };

    expect(parseWorkbenchProjectDocument(JSON.stringify(tampered))).toMatchObject({
      ok: false,
      error: { code: 'WORKBENCH_PROJECT_SCHEMA_INVALID' }
    });
  });
});
