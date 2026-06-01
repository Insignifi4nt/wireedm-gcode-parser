import { describe, expect, it } from 'vitest';

import { projectUpidDocument, withProjectUpid } from '../projectUpid';
import { createUpidFromDxfEntities, postUpidToGcode, postUpidToGcodeBody } from '../upidDocument';

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

  it('keeps a structured operation map when posting UPID to G-code', () => {
    const document = createUpidFromDxfEntities([
      {
        type: 'line',
        layer: 'CUT',
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 }
      }
    ]);
    const operation = document.plan.operations[0];
    const segmentId = operation.segmentRefs[0].segmentId;

    const posted = postUpidToGcode(document);

    expect(posted.body).toBe('G0 X0.000 Y0.000\nG1 X10.000 Y0.000');
    expect(posted.moves.map((move) => move.text)).toEqual(posted.body.split('\n'));
    expect(posted.operations).toHaveLength(1);
    expect(posted.operations[0]).toMatchObject({
      operationId: operation.id,
      contourId: operation.contourId,
      displayName: operation.displayName,
      classification: operation.classification,
      bodyLineStart: 0,
      bodyLineEnd: 1,
      rapidCount: 1,
      cutMoveCount: 1
    });
    expect(posted.operations[0].moves).toEqual(posted.moves);
    expect(posted.moves[0]).toMatchObject({
      bodyLineIndex: 0,
      command: 'G0',
      kind: 'rapid',
      operationId: operation.id,
      reason: 'operation-start',
      segmentId: null,
      text: 'G0 X0.000 Y0.000'
    });
    expect(posted.moves[1]).toMatchObject({
      bodyLineIndex: 1,
      command: 'G1',
      kind: 'cut',
      operationId: operation.id,
      reason: 'segment-cut',
      segmentId,
      text: 'G1 X10.000 Y0.000'
    });
  });

  it('posts line, arc, and circle geometry only from the UPID export boundary', () => {
    const document = createUpidFromDxfEntities([
      {
        type: 'line',
        layer: 'CUT',
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 }
      },
      {
        type: 'arc',
        layer: 'CUT',
        center: { x: 10, y: 10 },
        radius: 10,
        startAngle: 270,
        endAngle: 180,
        clockwise: false,
        start: { x: 10, y: 0 },
        end: { x: 0, y: 10 }
      },
      {
        type: 'circle',
        layer: 'HOLE',
        center: { x: 30, y: 30 },
        radius: 5
      }
    ]);

    const body = postUpidToGcodeBody(document);

    expect(body).toBe(
      [
        'G0 X0.000 Y0.000',
        'G1 X10.000 Y0.000',
        'G3 X0.000 Y10.000 I0.000 J10.000',
        'G0 X35.000 Y30.000',
        'G3 X25.000 Y30.000 I-5.000 J0.000',
        'G3 X35.000 Y30.000 I5.000 J0.000'
      ].join('\n')
    );
    expect(body).not.toMatch(/\bF\d/);
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
