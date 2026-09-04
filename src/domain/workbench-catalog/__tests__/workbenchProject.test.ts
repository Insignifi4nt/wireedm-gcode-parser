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

  it('migrates a version-1 UPID project without carrying controller-specific machine state', () => {
    const document = createUpidFromDxfEntities([]);
    expect(parseWorkbenchProjectDocument(JSON.stringify({
      schemaVersion: 1,
      id: 'legacy-project',
      name: 'Legacy project',
      createdAt: '2026-08-28T12:00:00.000Z',
      updatedAt: '2026-08-28T12:00:00.000Z',
      source: { kind: 'upid', files: [] },
      upid: { format: 'upid', schemaVersion: 1, document },
      machine: { id: 'legacy-machine', controller: { family: 'generic-iso' } },
      editor: { activeFilePath: null, pinnedLineNumbers: [2] }
    }))).toMatchObject({
      ok: true,
      project: {
        format: 'wire-edm-project',
        schemaVersion: 2,
        id: 'legacy-project',
        content: { kind: 'upid-document', document },
        editor: { pinnedLineNumbers: [2] },
        savedRevisionIds: []
      }
    });
  });

  it('keeps a valid empty version-1 machine-program project openable', () => {
    expect(parseWorkbenchProjectDocument(JSON.stringify({
      schemaVersion: 1,
      id: 'legacy-empty-program',
      name: 'Legacy empty program',
      createdAt: '2026-08-28T12:00:00.000Z',
      updatedAt: '2026-08-28T12:00:00.000Z',
      source: { kind: 'external-gcode', files: [] },
      machine: { id: 'legacy-machine' },
      editor: { activeFilePath: null, pinnedLineNumbers: [] }
    }))).toMatchObject({
      ok: true,
      project: {
        content: {
          kind: 'external-gcode',
          activeFilePath: 'projects/legacy-empty-program/legacy-empty.txt'
        },
        source: {
          files: [{
            path: 'projects/legacy-empty-program/legacy-empty.txt',
            kind: 'external-gcode'
          }]
        }
      }
    });
  });

  it('keeps a valid version-1 path project openable when its optional UPID was never created', () => {
    expect(parseWorkbenchProjectDocument(JSON.stringify({
      schemaVersion: 1,
      id: 'legacy-empty-path',
      name: 'Legacy empty path',
      createdAt: '2026-08-28T12:00:00.000Z',
      updatedAt: '2026-08-28T12:00:00.000Z',
      source: { kind: 'dxf', files: [] },
      machine: { id: 'legacy-machine' },
      editor: { activeFilePath: null, pinnedLineNumbers: [] }
    }))).toMatchObject({
      ok: true,
      project: {
        source: { kind: 'dxf' },
        content: { kind: 'upid-document' }
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
