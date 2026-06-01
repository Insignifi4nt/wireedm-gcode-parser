import { describe, expect, it } from 'vitest';

import { projectUpidDocument, withProjectUpid } from '../projectUpid';
import {
  composeUpidGCodeExport,
  createUpidFromDxfEntities,
  postUpidToGcode,
  postUpidToGcodeBody
} from '../upidDocument';

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

  it('composes a UPID export program with final G-code line metadata', () => {
    const document = createUpidFromDxfEntities([
      {
        type: 'line',
        layer: 'CUT',
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 }
      }
    ]);

    const exportProgram = composeUpidGCodeExport(document, {
      header: '%\nG90 G21',
      footer: 'M30\n%',
      lineEnding: 'lf'
    });

    expect(exportProgram.body).toBe('G0 X0.000 Y0.000\nG1 X10.000 Y0.000');
    expect(exportProgram.program.text).toBe('%\nG90 G21\nG0 X0.000 Y0.000\nG1 X10.000 Y0.000\nM30\n%\n');
    expect(exportProgram.program.sections.body).toEqual({
      endLineNumber: 4,
      lineCount: 2,
      lineOffset: 2,
      startLineNumber: 3
    });
    expect(exportProgram.program.lines[2]).toEqual({
      lineNumber: 3,
      section: 'body',
      sectionLineNumber: 1,
      text: 'G0 X0.000 Y0.000'
    });
    expect(exportProgram.post.metrics).toEqual({
      cutMoveCount: 1,
      rapidCount: 1
    });
    expect(exportProgram.post.operations[0]).toMatchObject({
      bodyLineEnd: 1,
      bodyLineStart: 0,
      operationId: document.plan.operations[0].id
    });
    expect(exportProgram.programOperations[0]).toMatchObject({
      bodyLineEnd: 1,
      bodyLineStart: 0,
      operationId: document.plan.operations[0].id,
      programLineEnd: 4,
      programLineStart: 3
    });
    expect(exportProgram.programOperations[0].moves[0]).toMatchObject({
      bodyLineIndex: 0,
      programLineNumber: 3,
      reason: 'operation-start',
      text: 'G0 X0.000 Y0.000'
    });
    expect(exportProgram.programOperations[0].moves[1]).toMatchObject({
      bodyLineIndex: 1,
      programLineNumber: 4,
      reason: 'segment-cut',
      text: 'G1 X10.000 Y0.000'
    });
  });

  it('keeps UPID path-element and segment trace metadata on posted export moves', () => {
    const document = createUpidFromDxfEntities([
      line(0, 0, 10, 0),
      line(10, 0, 10, 5)
    ]);
    const operation = document.plan.operations[0];
    const pathElement = document.pathElements.find((element) => element.operationId === operation.id);
    const firstSegmentId = operation.segmentRefs[0].segmentId;
    const secondSegmentId = operation.segmentRefs[1].segmentId;

    expect(pathElement).not.toBeUndefined();

    const exportProgram = composeUpidGCodeExport(document, {
      header: '',
      footer: '',
      lineEnding: 'lf'
    });

    expect(exportProgram.programOperations[0]).toMatchObject({
      operationId: operation.id,
      pathElementId: pathElement!.id
    });
    expect(exportProgram.programOperations[0].moves[0]).toMatchObject({
      pathElementId: pathElement!.id,
      segmentId: null,
      segmentIndex: null,
      segmentOrdinal: null
    });
    expect(exportProgram.programOperations[0].moves[1]).toMatchObject({
      pathElementId: pathElement!.id,
      segmentId: firstSegmentId,
      segmentIndex: 0,
      segmentOrdinal: 1
    });
    expect(exportProgram.programOperations[0].moves[2]).toMatchObject({
      pathElementId: pathElement!.id,
      segmentId: secondSegmentId,
      segmentIndex: 1,
      segmentOrdinal: 2
    });
  });

  it('summarizes UPID export planning and diagnostics in the export artifact', () => {
    const document = createUpidFromDxfEntities(
      [
        line(0, 0, 10, 0),
        line(10.004, 0, 10, 5),
        line(10, 5, 0, 5),
        line(0, 5, 0, 0)
      ],
      {
        endpointTolerance: 0.01,
        operationOrderStrategy: 'nearest'
      }
    );

    const exportProgram = composeUpidGCodeExport(document, {
      header: '',
      footer: '',
      lineEnding: 'lf'
    });

    expect(exportProgram.planning).toEqual({
      manualOrderCount: 0,
      operationOrderStrategy: 'nearest'
    });
    expect(exportProgram.summary).toEqual({
      diagnosticCount: exportProgram.diagnostics.length,
      manualOrderCount: 0,
      operationCount: 1,
      operationOrderStrategy: 'nearest',
      postDiagnosticCount: exportProgram.post.diagnostics.length
    });
    expect(exportProgram.diagnostics.map((diagnostic) => diagnostic.code)).toContain('endpoint-cluster-snap');
    expect(exportProgram.diagnostics.map((diagnostic) => diagnostic.code)).toContain('post-bridged-gap');
    expect(exportProgram.diagnostics).toEqual([...document.diagnostics, ...exportProgram.post.diagnostics]);
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

function line(startX: number, startY: number, endX: number, endY: number) {
  return {
    type: 'line' as const,
    layer: 'CUT',
    start: { x: startX, y: startY },
    end: { x: endX, y: endY }
  };
}
