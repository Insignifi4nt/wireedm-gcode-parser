import { describe, expect, it } from 'vitest';

import { parseGCodeProgram } from '@/domain/editor/gcodeParser';
import { initializeProjectCompensationIntents } from '@/domain/compensation/intent';
import { createVerifiedCharmillesRobofil100Profile } from '@/domain/machine/machineProfiles';
import { createDefaultMachineProfile } from '@/domain/workbench/defaultProject';
import {
  movePathOperation,
  reversePathOperation,
  setClosedOperationStartAtSegmentEndpoint,
  setClosedOperationStartNearPoint,
  setPathOperationClassification
} from '@/domain/path-editor/pathDocumentOperations';

import {
  composeProjectUpidGCodeExport,
  createProjectUpid,
  normalizeLegacyProjectUpidDocument,
  projectUpidDocument,
  withProjectUpid
} from '../projectUpid';
import {
  composeUpidGCodeExport,
  createUpidFromDxfEntities,
  postUpidToGcode,
  postUpidToGcodeBody
} from '../upidDocument';
import { projectUpidPathDiagnostic } from '../projectRail';

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

    expect(posted.status).toBe('ready');
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
    const document = createUpidFromDxfEntities(
      [
        {
          type: 'line',
          layer: 'CUT',
          start: { x: 0, y: 0 },
          end: { x: 10, y: 0 }
        }
      ],
      {},
      {
        fileName: 'trace-source.dxf',
        importedAt: '2026-05-31T10:00:00.000Z',
        projectId: 'trace-project',
        units: {
          code: 4,
          label: 'millimeters',
          scaleToMillimeters: 1,
          source: 'dxf-insunits'
        }
      }
    );

    const exportProgram = composeUpidGCodeExport(document, {
      header: '%\nG90 G21',
      footer: 'M30\n%',
      lineEnding: 'lf'
    });

    expect(exportProgram.documentTrace).toEqual({
      contourCount: 1,
      fileName: 'trace-source.dxf',
      format: 'Universal Path Intelligence Document',
      importedAt: '2026-05-31T10:00:00.000Z',
      operationCount: 1,
      pathElementCount: 1,
      projectId: 'trace-project',
      schemaVersion: 1,
      segmentCount: 1,
      sourceEntityCount: 1,
      sourceKind: 'dxf-entities',
      sourceUnits: {
        code: 4,
        label: 'millimeters',
        scaleToMillimeters: 1,
        source: 'dxf-insunits'
      }
    });
    expect(exportProgram.canDownload).toBe(true);
    expect(exportProgram.blockingDiagnostics).toEqual([]);
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

  it('carries UPID manual decision and edit metadata onto posted export operations', () => {
    const document = createUpidFromDxfEntities([
      line(0, 0, 10, 0),
      line(10, 0, 10, 5),
      line(10, 5, 0, 5),
      line(0, 5, 0, 0)
    ]);
    const operationId = document.plan.operations[0].id;
    const reversed = reversePathOperation(document, operationId);
    const started = setClosedOperationStartNearPoint(reversed!, operationId, { x: 5, y: 0 });

    const exportProgram = composeUpidGCodeExport(started!, {
      header: '',
      footer: '',
      lineEnding: 'lf'
    });

    expect(exportProgram.programOperations[0]).toMatchObject({
      editEventCount: 1,
      editedSegmentCount: 2,
      manualDecisionKinds: ['direction', 'start'],
      operationId
    });
  });

  it('carries exact manual start metadata onto posted export operations', () => {
    const document = createUpidFromDxfEntities([
      line(0, 0, 10, 0),
      line(10, 0, 10, 5),
      line(10, 5, 0, 5),
      line(0, 5, 0, 0)
    ]);
    const operation = document.plan.operations[0];
    const targetSegmentId = operation.segmentRefs[1].segmentId;
    const started = setClosedOperationStartAtSegmentEndpoint(
      document,
      operation.id,
      targetSegmentId,
      'start'
    );

    const exportProgram = composeUpidGCodeExport(started!, {
      header: '',
      footer: '',
      lineEnding: 'lf'
    });

    expect(exportProgram.programOperations[0].manualStart).toEqual({
      point: { x: 10, y: 0 },
      relation: 'existing-point',
      sourceSegmentId: targetSegmentId,
      sourceSegmentIndex: 1,
      pointRole: 'start',
      createdSegmentIds: []
    });
  });

  it('carries structured manual order, role, and direction metadata onto posted export operations', () => {
    const document = createUpidFromDxfEntities([
      ...rectangle(0, 0, 10, 5),
      ...rectangle(20, 0, 30, 5)
    ]);
    const editedOperationId = document.plan.operations[0].id;
    const moved = movePathOperation(document, editedOperationId, 1);
    const classified = setPathOperationClassification(moved!, editedOperationId, 'hole');
    const reversed = reversePathOperation(classified!, editedOperationId);

    const exportProgram = composeUpidGCodeExport(reversed!, {
      header: '',
      footer: '',
      lineEnding: 'lf'
    });
    const postedOperation = exportProgram.programOperations.find(
      (operation) => operation.operationId === editedOperationId
    );

    expect(exportProgram.planning.manualDecisionCount).toBe(4);
    expect(exportProgram.planning.manualDecisionCounts).toEqual({
      compensation: 0,
      direction: 1,
      'lead-in': 0,
      order: 2,
      role: 1,
      start: 0
    });
    expect(postedOperation).toMatchObject({
      manualClassification: { classification: 'hole' },
      manualDecisionKinds: ['order', 'role', 'direction'],
      manualDirection: { direction: 'reverse' },
      manualOrder: { orderIndex: 1 }
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
      manualDecisionCount: 0,
      manualDecisionCounts: {
        compensation: 0,
        direction: 0,
        'lead-in': 0,
        order: 0,
        role: 0,
        start: 0
      },
      manualOrderCount: 0,
      operationOrderStrategy: 'nearest'
    });
    expect(exportProgram.summary).toEqual({
      diagnosticCount: exportProgram.diagnostics.length,
      manualDecisionCount: 0,
      manualDecisionCounts: {
        compensation: 0,
        direction: 0,
        'lead-in': 0,
        order: 0,
        role: 0,
        start: 0
      },
      manualOrderCount: 0,
      operationCount: 1,
      operationOrderStrategy: 'nearest',
      postDiagnosticCount: exportProgram.post.diagnostics.length
    });
    expect(exportProgram.diagnostics.map((diagnostic) => diagnostic.code)).toContain('endpoint-cluster-snap');
    expect(exportProgram.diagnostics.map((diagnostic) => diagnostic.code)).toContain('post-bridged-gap');
    expect(exportProgram.diagnostics).toEqual([...document.diagnostics, ...exportProgram.post.diagnostics]);
    const bridgedGap = exportProgram.diagnostics.find((diagnostic) => diagnostic.code === 'post-bridged-gap');
    expect(bridgedGap).toBeTruthy();
    expect(projectUpidPathDiagnostic(document, bridgedGap!).metrics).toEqual([
      {
        key: 'gap',
        label: 'Gap',
        value: expect.closeTo(0.004)
      },
      {
        key: 'endpointTolerance',
        label: 'Tolerance',
        value: 0.01
      }
    ]);
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

  it('exports absolute arc centers when the program header selects absolute IJ mode', () => {
    const document = createUpidFromDxfEntities([
      {
        type: 'circle',
        layer: 'HOLE',
        center: { x: 30, y: 30 },
        radius: 5
      }
    ]);

    const exportProgram = composeUpidGCodeExport(document, {
      header: '%\nG60',
      footer: 'M02',
      lineEnding: 'lf'
    });
    const parsed = parseGCodeProgram(exportProgram.program.text);
    const arcs = parsed.path.filter((point) => point.type === 'arc');

    expect(exportProgram.body).toContain('G3 X25.000 Y30.000 I30.000 J30.000');
    expect(exportProgram.body).toContain('G3 X35.000 Y30.000 I30.000 J30.000');
    expect(arcs).toHaveLength(2);
    expect(arcs).toEqual([
      expect.objectContaining({
        centerX: 30,
        centerY: 30,
        endX: 25,
        endY: 30
      }),
      expect.objectContaining({
        centerX: 30,
        centerY: 30,
        endX: 35,
        endY: 30
      })
    ]);
  });

  it('keeps export and parser arc-center semantics aligned for compact modal header words', () => {
    const document = createUpidFromDxfEntities([
      {
        type: 'circle',
        layer: 'HOLE',
        center: { x: 30, y: 30 },
        radius: 5
      }
    ]);

    const exportProgram = composeUpidGCodeExport(document, {
      header: '%\nG90.1G17',
      footer: 'M02',
      lineEnding: 'lf'
    });
    const parsed = parseGCodeProgram(exportProgram.program.text);

    expect(exportProgram.body).toContain('G3 X25.000 Y30.000 I30.000 J30.000');
    expect(parsed.errors).toEqual([]);
    expect(parsed.path.filter((point) => point.type === 'arc')).toEqual([
      expect.objectContaining({ centerX: 30, centerY: 30 }),
      expect.objectContaining({ centerX: 30, centerY: 30 })
    ]);
  });

  it.each([
    {
      label: 'branched',
      entities: [line(-1, 0, 0, 0), line(0, 0, 1, 0), line(0, 0, 0, 1)]
    },
    {
      label: 'duplicate',
      entities: [line(0, 0, 1, 0), line(0, 0, 1, 0)]
    }
  ])('blocks a $label UPID document atomically', ({ entities }) => {
    const document = createUpidFromDxfEntities(entities);

    const posted = postUpidToGcode(document);

    expect(posted.status).toBe('blocked');
    expect(posted.body).toBe('');
    expect(posted.moves).toEqual([]);
    expect(posted.operations).toEqual([]);
    expect(posted.metrics).toEqual({ rapidCount: 0, cutMoveCount: 0 });
    expect(posted.diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'error' })
    );
    expect(postUpidToGcodeBody(document)).toBe('');
  });

  it('retains configured header/footer context for a blocked export without a downloadable body', () => {
    const document = createUpidFromDxfEntities([
      line(-1, 0, 1, 0),
      line(0, -1, 0, 1)
    ]);

    const exportProgram = composeUpidGCodeExport(document, {
      header: '%\nG90 G21 G17 G40',
      footer: 'M30\n%',
      lineEnding: 'lf'
    });

    expect(exportProgram.canDownload).toBe(false);
    expect(exportProgram.body).toBe('');
    expect(exportProgram.blockingDiagnostics).toContainEqual(
      expect.objectContaining({ severity: 'error', code: 'intersecting-topology' })
    );
    expect(exportProgram.program.text).toBe('%\nG90 G21 G17 G40\nM30\n%\n');
    expect(exportProgram.post.status).toBe('blocked');
    expect(exportProgram.post.moves).toEqual([]);
    expect(exportProgram.post.operations).toEqual([]);
    expect(exportProgram.post.metrics).toEqual({ rapidCount: 0, cutMoveCount: 0 });
    expect(exportProgram.programOperations).toEqual([]);
    expect(exportProgram.summary.operationCount).toBe(0);
    expect(new Set(exportProgram.diagnostics.map((diagnostic) => diagnostic.id)).size).toBe(
      exportProgram.diagnostics.length
    );
  });

  it('keeps structurally invalid Robofil composition executable-empty before intent checks', () => {
    const machine = createVerifiedCharmillesRobofil100Profile();
    machine.templates.header = 'G28 X100 Y100';
    machine.templates.footer = 'M99';
    const document = createUpidFromDxfEntities([line(0, 0, 4, 0)]);
    document.plan.operations[0].segmentRefs[0].segmentId = 'seg_missing';

    const exportProgram = composeUpidGCodeExport(document, { machine });

    expect(exportProgram.canDownload).toBe(false);
    expect(exportProgram.body).toBe('');
    expect(exportProgram.post).toMatchObject({
      status: 'blocked',
      programOwned: true,
      blocks: [],
      moves: [],
      operations: []
    });
    expect(exportProgram.program.lines).toEqual([]);
    expect(exportProgram.program.text.trim()).toBe('');
    expect(exportProgram.program.text).not.toContain('G28');
    expect(exportProgram.program.text).not.toContain('M99');
  });

  it('stamps projectless UPID documents when attaching them to a project', () => {
    const document = createUpidFromDxfEntities([line(0, 0, 4, 0)]);
    const projectDocument = projectUpidDocument(withProjectUpid(baseProject(), document));

    expect(projectDocument?.source.projectId).toBe('upid-project');
    expect(document.source.projectId).toBeUndefined();
    expect(projectUpidDocument(baseProject())).toBeNull();
  });

  it('creates project UPID state by stamping the current project id', () => {
    const document = createUpidFromDxfEntities([line(0, 0, 4, 0)]);
    const upid = createProjectUpid(baseProject(), document);

    expect(upid.document.source.projectId).toBe('upid-project');
    expect(document.source.projectId).toBeUndefined();
  });

  it('normalizes omitted schema-v1 layer filters at the project load boundary', () => {
    const project = withProjectUpid(
      baseProject(),
      createUpidFromDxfEntities([line(0, 0, 4, 0)])
    );
    const storedOptions = project.upid!.document.options;
    delete (storedOptions as Partial<typeof storedOptions>).includeLayers;
    delete (storedOptions as Partial<typeof storedOptions>).excludeLayers;

    const loaded = projectUpidDocument(project)!;

    expect(loaded.options.includeLayers).toEqual([]);
    expect(loaded.options.excludeLayers).toEqual([]);
    expect(storedOptions).not.toHaveProperty('includeLayers');
    expect(storedOptions).not.toHaveProperty('excludeLayers');
  });

  it('normalizes legacy documents to wire-centre without inventing compensation intent', () => {
    const legacy = createUpidFromDxfEntities([
      ...rectangle(0, 0, 10, 5),
      ...rectangle(20, 0, 30, 5)
    ]);
    delete (legacy as Partial<typeof legacy>).geometryBasis;
    legacy.plan.operations[0].compensationIntent = {
      mode: 'controller',
      keptMaterial: 'inside',
      source: 'automatic'
    };
    const automaticElement = legacy.pathElements.find(
      (element) => element.operationId === legacy.plan.operations[0].id
    )!;
    automaticElement.compensationIntent = structuredClone(
      legacy.plan.operations[0].compensationIntent
    );
    legacy.plan.operations[1].compensationIntent = {
      mode: 'controller',
      keptMaterial: 'outside',
      source: 'manual'
    };
    const manualElement = legacy.pathElements.find(
      (element) => element.operationId === legacy.plan.operations[1].id
    )!;
    manualElement.compensationIntent = structuredClone(
      legacy.plan.operations[1].compensationIntent
    );
    const before = structuredClone(legacy);

    const normalized = normalizeLegacyProjectUpidDocument(legacy);

    expect(normalized.geometryBasis).toBe('wire-centre');
    expect(normalized.plan.operations[0].compensationIntent).toBeUndefined();
    expect(normalized.pathElements.find(
      (element) => element.operationId === normalized.plan.operations[0].id
    )?.compensationIntent).toBeUndefined();
    expect(normalized.plan.operations[1].compensationIntent).toEqual({
      mode: 'controller',
      keptMaterial: 'outside',
      source: 'manual'
    });
    expect(normalized.pathElements.find(
      (element) => element.operationId === normalized.plan.operations[1].id
    )?.compensationIntent).toEqual(normalized.plan.operations[1].compensationIntent);
    expect(legacy).toEqual(before);
    expect(legacy).not.toHaveProperty('geometryBasis');
  });

  it('does not normalize an explicit malformed layer filter at the project load boundary', () => {
    const project = withProjectUpid(
      baseProject(),
      createUpidFromDxfEntities([line(0, 0, 4, 0)])
    );
    const storedOptions = project.upid!.document.options;
    storedOptions.includeLayers = null as never;
    delete (storedOptions as Partial<typeof storedOptions>).excludeLayers;

    expect(() => projectUpidDocument(project)).toThrow(
      'options.includeLayers must be an array of strings.'
    );
  });

  it('rejects attaching UPID state to external G-code projects', () => {
    const project = {
      ...baseProject(),
      source: {
        kind: 'external-gcode' as const,
        files: []
      }
    };
    const projectlessDocument = createUpidFromDxfEntities([line(0, 0, 4, 0)]);
    const projectDocument = createUpidFromDxfEntities([line(0, 0, 4, 0)], {}, {
      projectId: project.id
    });

    expect(() => createProjectUpid(project, projectlessDocument)).toThrow(
      'UPID path state can only be attached to DXF projects.'
    );
    expect(() => withProjectUpid(project, projectlessDocument)).toThrow(
      'UPID path state can only be attached to DXF projects.'
    );
    expect(() => composeProjectUpidGCodeExport(project, projectDocument)).toThrow(
      'UPID path state can only be attached to DXF projects.'
    );
  });

  it('composes project-owned UPID exports from project machine settings', () => {
    const project = withProjectUpid(baseProject(), createUpidFromDxfEntities([line(0, 0, 4, 0)]));
    const document = projectUpidDocument(project)!;

    const exportProgram = composeProjectUpidGCodeExport(project, document);

    expect(exportProgram.fileName).toBe('upid-project.iso');
    expect(exportProgram.machineName).toBe('Machine');
    expect(exportProgram.documentTrace.projectId).toBe('upid-project');
    expect(exportProgram.pathDocument).toBe(document);
    expect(exportProgram.program.text).toBe('G0 X0.000 Y0.000\r\nG1 X4.000 Y0.000\r\n');
  });

  it('passes project machine coordinate precision into UPID posting', () => {
    const project = withProjectUpid(
      {
        ...baseProject(),
        machine: {
          ...baseProject().machine,
          output: {
            ...baseProject().machine.output,
            coordinatePrecision: 5
          }
        }
      },
      createUpidFromDxfEntities([line(0, 0, 1.234567, 0)])
    );
    const document = projectUpidDocument(project)!;

    const exportProgram = composeProjectUpidGCodeExport(project, document);

    expect(exportProgram.body).toContain('X1.23457');
    expect(exportProgram.fileName).toBe('upid-project.iso');
  });

  it('composes verified Robofil modal blocks from only the project machine snapshot', () => {
    const libraryProfile = createVerifiedCharmillesRobofil100Profile(
      'robofil-project-snapshot',
      new Date('2026-07-13T00:00:00.000Z')
    );
    const project = {
      ...baseProject(),
      machine: structuredClone(libraryProfile)
    };
    const initialized = initializeProjectCompensationIntents(
      createUpidFromDxfEntities(rectangle(0, 0, 10, 5)),
      project.machine
    );
    const attached = withProjectUpid(project, initialized);
    const document = projectUpidDocument(attached)!;

    libraryProfile.compensation.preActivationCodes = ['G61'];
    const exportProgram = composeProjectUpidGCodeExport(attached, document);

    expect(exportProgram.canDownload).toBe(true);
    expect(exportProgram.program.text).toMatch(
      /^G92 X0 Y0\r\nG60\r\nG38\r\nG4[12] D0\r\nG90\r\nG1 /
    );
    expect(exportProgram.program.text).not.toContain('G61');
    expect(exportProgram.program.text.endsWith('M02\r\n')).toBe(true);
    expect(exportProgram.programBlocks.slice(0, 5)).toEqual([
      expect.objectContaining({ programLineNumber: 1, kind: 'setup', text: 'G92 X0 Y0' }),
      expect.objectContaining({ programLineNumber: 2, kind: 'setup', text: 'G60' }),
      expect.objectContaining({ programLineNumber: 3, kind: 'compensation-activation', text: 'G38' }),
      expect.objectContaining({ programLineNumber: 4, kind: 'compensation-activation' }),
      expect.objectContaining({ programLineNumber: 5, kind: 'setup', text: 'G90' })
    ]);
  });

  it('rejects project UPID exports for documents outside the current project', () => {
    const project = baseProject();
    const projectlessDocument = createUpidFromDxfEntities([line(0, 0, 4, 0)]);
    const foreignDocument = createUpidFromDxfEntities([line(0, 0, 4, 0)], {}, {
      projectId: 'other-project'
    });

    expect(() => composeProjectUpidGCodeExport(project, projectlessDocument)).toThrow(
      'UPID document project identity is required for upid-project.'
    );
    expect(() => composeProjectUpidGCodeExport(project, foreignDocument)).toThrow(
      'UPID document project mismatch: other-project cannot be used by upid-project.'
    );
  });

  it('rejects stored UPID project documents without project identity', () => {
    const document = createUpidFromDxfEntities([line(0, 0, 4, 0)]);
    const project = {
      ...baseProject(),
      upid: {
        format: 'upid' as const,
        schemaVersion: 1 as const,
        document
      }
    };

    expect(() => projectUpidDocument(project)).toThrow(
      'UPID document project identity is required for upid-project.'
    );
  });

  it('rejects UPID documents attached to a different workbench project id', () => {
    const document = createUpidFromDxfEntities([line(0, 0, 4, 0)], {}, {
      projectId: 'other-project'
    });

    expect(() => projectUpidDocument(withProjectUpid(baseProject(), document))).toThrow(
      'UPID document project mismatch: other-project cannot be used by upid-project.'
    );
  });

  it('rejects unsupported UPID project and document schema versions', () => {
    const document = createUpidFromDxfEntities([line(0, 0, 4, 0)]);
    const project = withProjectUpid(baseProject(), document);
    const unsupportedProjectSchema = {
      ...project,
      upid: {
        ...project.upid!,
        schemaVersion: 2
      }
    } as unknown as typeof project;
    const unsupportedDocumentSchema = {
      ...project,
      upid: {
        ...project.upid!,
        document: {
          ...project.upid!.document,
          schemaVersion: 2
        }
      }
    } as unknown as typeof project;

    expect(() => projectUpidDocument(unsupportedProjectSchema)).toThrow(
      'Unsupported UPID project schema version: 2.'
    );
    expect(() => projectUpidDocument(unsupportedDocumentSchema)).toThrow(
      'Unsupported UPID document schema version: 2.'
    );
  });

  it('rejects structurally corrupt stored UPID but loads topology-blocked state for inspection', () => {
    const healthy = withProjectUpid(
      baseProject(),
      createUpidFromDxfEntities([line(0, 0, 4, 0)])
    );
    const corrupt = structuredClone(healthy);
    corrupt.upid!.document.plan.operations[0].segmentRefs[0].segmentId = 'seg_missing';
    const topologyBlocked = withProjectUpid(
      baseProject(),
      createUpidFromDxfEntities([
        line(-1, 0, 0, 0),
        line(0, 0, 1, 0),
        line(0, 0, 0, 1)
      ])
    );

    expect(() => projectUpidDocument(corrupt)).toThrow('Invalid UPID document:');
    expect(projectUpidDocument(topologyBlocked)?.diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'error', code: 'branching-topology' })
    );
  });

  it('reports a structurally malformed stored source through the UPID validation error', () => {
    const project = withProjectUpid(
      baseProject(),
      createUpidFromDxfEntities([line(0, 0, 4, 0)])
    );
    project.upid!.document.source = null as never;

    expect(() => projectUpidDocument(project)).toThrow('Invalid UPID document:');
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
      ...createDefaultMachineProfile(),
      id: 'machine',
      name: 'Machine',
      templates: {
        header: '',
        footer: ''
      },
      output: {
        extension: 'iso' as const,
        lineEnding: 'crlf' as const,
        coordinatePrecision: 3
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

function rectangle(minX: number, minY: number, maxX: number, maxY: number) {
  return [
    line(minX, minY, maxX, minY),
    line(maxX, minY, maxX, maxY),
    line(maxX, maxY, minX, maxY),
    line(minX, maxY, minX, minY)
  ];
}
