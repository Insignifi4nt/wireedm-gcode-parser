import { describe, expect, it } from 'vitest';

import { projectUpidDocument, withProjectUpid } from '../projectUpid';
import { createUpidFromDxfEntities, postUpidToGcodeBody } from '../upidDocument';

describe('UPID document boundary', () => {
  it('creates a Universal Path Intelligence Document from DXF entities and posts it at the export boundary', () => {
    const document = createUpidFromDxfEntities([
      {
        type: 'line',
        layer: 'CUT',
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 }
      }
    ]);

    expect(document.source.kind).toBe('dxf-entities');
    expect(document.segments).toHaveLength(1);
    expect(document.plan.operations).toHaveLength(1);
    expect(postUpidToGcodeBody(document)).toBe('G0 X0.000 Y0.000\nG1 X10.000 Y0.000');
  });

  it('reads the first-class UPID document from a project', () => {
    const document = createUpidFromDxfEntities([
      {
        type: 'line',
        layer: 'CUT',
        start: { x: 0, y: 0 },
        end: { x: 4, y: 0 }
      }
    ]);

    expect(projectUpidDocument(withProjectUpid(baseProject(), document))).toBe(document);
    expect(projectUpidDocument(baseProject())).toBeNull();
  });
});

function baseProject() {
  return {
    schemaVersion: 1 as const,
    id: 'upid-project',
    name: 'UPID Project',
    createdAt: '2026-05-31T00:00:00.000Z',
    updatedAt: '2026-05-31T00:00:00.000Z',
    source: {
      kind: 'dxf' as const,
      files: []
    },
    machine: {
      id: 'machine',
      name: 'Machine',
      templates: {
        header: '',
        footer: ''
      },
      output: {
        extension: 'iso' as const,
        lineEnding: 'crlf' as const
      },
      workArea: {
        widthMm: null,
        lengthMm: null
      },
      notes: ''
    },
    editor: {
      activeFilePath: null,
      pinnedLineNumbers: []
    }
  };
}
