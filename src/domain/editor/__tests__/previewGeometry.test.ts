import { describe, expect, it } from 'vitest';

import {
  initializeProjectCompensationIntents,
  setManualCompensationIntent
} from '@/domain/compensation/intent';
import {
  createCharmillesRobofil100V2CandidateProfile,
  createVerifiedCharmillesRobofil100Profile,
  markMachineProfileUserVerified
} from '@/domain/machine/machineProfiles';
import {
  setCircleOperationCenterPierceLeadIn,
  setManualInitialWirePosition,
  translatePathDocument
} from '@/domain/path-editor/pathDocumentOperations';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import { setMachiningSpanParticipation } from '@/domain/path-intel/machiningParticipation';
import { createDefaultMachineProfile } from '@/domain/workbench/defaultProject';

import { parseGCodeProgram } from '../gcodeParser';
import {
  buildEditorPathDocumentPreviewGeometry,
  buildEditorPreviewGeometry,
  deriveVerifiedRobofilPreviewTransitions,
  fitViewBoxToViewportAspect
} from '../previewGeometry';

describe('buildEditorPreviewGeometry', () => {
  it('turns parsed rapid, cut, and arc moves into preview paths with padded bounds', () => {
    const parseResult = parseGCodeProgram(
      ['G0 X0 Y0', 'G1 X10 Y0', 'G3 X20 Y10 I0 J10'].join('\n')
    );

    const preview = buildEditorPreviewGeometry(parseResult, {
      padding: 2
    });

    expect(preview.viewBox).toEqual({
      minX: -2,
      minY: -2,
      width: 24,
      height: 14
    });
    expect(preview.paths).toEqual([
      {
        type: 'rapid',
        bounds: {
          maxX: 0,
          maxY: 0,
          minX: 0,
          minY: 0
        },
        d: 'M 0 0 L 0 0',
        start: {
          x: 0,
          y: 0
        },
        end: {
          x: 0,
          y: 0
        },
        line: 1,
        source: 'gcode'
      },
      {
        type: 'cut',
        bounds: {
          maxX: 10,
          maxY: 0,
          minX: 0,
          minY: 0
        },
        d: 'M 0 0 L 10 0',
        start: {
          x: 0,
          y: 0
        },
        end: {
          x: 10,
          y: 0
        },
        line: 2,
        source: 'gcode'
      },
      {
        type: 'arc',
        bounds: {
          maxX: 20,
          maxY: 10,
          minX: 10,
          minY: 0
        },
        center: {
          x: 10,
          y: 10
        },
        d: 'M 10 0 A 10 10 0 0 1 20 10',
        start: {
          x: 10,
          y: 0
        },
        end: {
          x: 20,
          y: 10
        },
        line: 3,
        source: 'gcode'
      }
    ]);
    expect(preview.markers).toEqual([
      {
        type: 'start',
        x: 0,
        y: 0,
        label: 'START'
      },
      {
        type: 'end',
        x: 20,
        y: 10,
        label: 'END'
      }
    ]);
  });

  it('returns an empty preview for files without drawable motion', () => {
    const preview = buildEditorPreviewGeometry(parseGCodeProgram('G90\nM30'));

    expect(preview.paths).toEqual([]);
    expect(preview.markers).toEqual([]);
    expect(preview.viewBox).toEqual({
      minX: -1,
      minY: -1,
      width: 2,
      height: 2
    });
  });

  it('renders parsed full-circle arc moves as two drawable SVG arcs', () => {
    const preview = buildEditorPreviewGeometry(
      parseGCodeProgram(['G0 X15 Y20', 'G3 X15 Y20 I-5 J0'].join('\n'))
    );

    expect(preview.viewBox).toEqual({
      minX: 4,
      minY: 14,
      width: 12,
      height: 12
    });
    expect(preview.paths[1]).toEqual({
      type: 'arc',
      bounds: {
        maxX: 15,
        maxY: 20,
        minX: 10,
        minY: 20
      },
      center: {
        x: 10,
        y: 20
      },
      d: 'M 15 20 A 5 5 0 1 1 5 20 A 5 5 0 1 1 15 20',
      start: {
        x: 15,
        y: 20
      },
      end: {
        x: 15,
        y: 20
      },
      line: 2,
      source: 'gcode'
    });
  });

  it('turns path planning documents into preview paths without reparsing generated G-code', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      line(0, 0, 10, 0),
      line(10, 0, 10, 5),
      line(10, 5, 0, 5),
      line(0, 5, 0, 0)
    ]);

    const preview = buildEditorPathDocumentPreviewGeometry(document, {
      lineHints: [4, 5, 6, 7, 8],
      padding: 1
    });

    expect(preview.viewBox).toEqual({
      minX: -1,
      minY: -1,
      width: 12,
      height: 7
    });
    expect(preview.paths).toHaveLength(5);
    expect(preview.paths[0]).toMatchObject({
      d: 'M 0 0 L 0 0',
      line: 4,
      operationId: document.plan.operations[0].id,
      pathElementId: document.pathElements[0].id,
      source: 'path-document',
      type: 'rapid'
    });
    expect(preview.paths[1]).toMatchObject({
      d: 'M 0 0 L 10 0',
      line: 5,
      operationId: document.plan.operations[0].id,
      pathElementId: document.pathElements[0].id,
      segmentId: document.plan.operations[0].segmentRefs[0].segmentId,
      source: 'path-document',
      type: 'cut'
    });
    expect(preview.markers).toEqual([
      {
        type: 'start',
        x: 0,
        y: 0,
        label: 'START'
      },
      {
        type: 'end',
        x: 0,
        y: 0,
        label: 'END'
      }
    ]);
  });

  it('distinguishes inactive source reference geometry from derived active partial cuts', () => {
    const source = createPathPlanningDocumentFromDxfEntities([
      line(0, 0, 10, 0),
      line(10, 0, 10, 5),
      line(10, 5, 0, 5),
      line(0, 5, 0, 0)
    ]);
    const inactiveSegmentId = source.plan.operations[0].segmentRefs[0].segmentId;
    const document = setMachiningSpanParticipation(source, {
      sourceSegmentId: inactiveSegmentId,
      range: { start: 0, end: 1 },
      participation: 'inactive-reference'
    })!;

    const preview = buildEditorPathDocumentPreviewGeometry(document);
    const machiningPaths = preview.paths.filter((path) => path.segmentId);

    expect(machiningPaths.filter((path) => path.participation === 'active-cut')).toHaveLength(3);
    expect(machiningPaths.filter((path) => path.participation === 'inactive-reference'))
      .toEqual([expect.objectContaining({ segmentId: inactiveSegmentId })]);
  });

  it('matches path document circle preview paths to posted motion-line hints', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 },
      { type: 'circle', layer: 'CUT', center: { x: 20, y: 0 }, radius: 5 }
    ]);
    expect(document.plan.operations).toHaveLength(2);

    const preview = buildEditorPathDocumentPreviewGeometry(document, {
      lineHints: [4, 5, 6, 7, 8, 9],
      padding: 1
    });

    expect(preview.paths.map((path) => path.line)).toEqual([4, 5, 6, 7, 8, 9]);
    expect(preview.paths.map((path) => path.type)).toEqual([
      'rapid',
      'arc',
      'arc',
      'rapid',
      'arc',
      'arc'
    ]);
    expect(preview.paths.filter((path) => path.type === 'rapid')).toHaveLength(2);
    expect(preview.paths[1].segmentId).toBe(document.plan.operations[0].segmentRefs[0].segmentId);
    expect(preview.paths[2].segmentId).toBe(document.plan.operations[0].segmentRefs[0].segmentId);
  });

  it('renders a center pierce lead-in as an editable path-document preview move', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 10, y: 20 }, radius: 5 }
    ]);
    const edited = setCircleOperationCenterPierceLeadIn(document, document.plan.operations[0].id)!;

    const preview = buildEditorPathDocumentPreviewGeometry(edited, {
      lineHints: [4, 5, 6, 7],
      padding: 1
    });

    expect(preview.paths.map((path) => [path.type, path.travelRole ?? null])).toEqual([
      ['rapid', 'rapid-in'],
      ['cut', 'lead-in'],
      ['arc', null],
      ['arc', null]
    ]);
    expect(preview.paths[0]).toMatchObject({
      d: 'M 0 0 L 10 20',
      end: { x: 10, y: 20 },
      source: 'path-document',
      travelRole: 'rapid-in'
    });
    expect(preview.paths[1]).toMatchObject({
      d: 'M 10 20 L 15 20',
      end: { x: 15, y: 20 },
      operationId: edited.plan.operations[0].id,
      pathElementId: edited.pathElements[0].id,
      source: 'path-document',
      start: { x: 10, y: 20 },
      travelRole: 'lead-in',
      type: 'cut'
    });
  });

  it('renders supplied posted transitions as lead-in and lead-out roles without inventing either', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      line(5, 0, 15, 0),
      line(15, 0, 15, 5),
      line(15, 5, 5, 5),
      line(5, 5, 5, 0)
    ]);
    const operationId = document.plan.operations[0].id;

    const preview = buildEditorPathDocumentPreviewGeometry(document, {
      postedTransitions: [
        {
          kind: 'lead-in',
          operationId,
          startPoint: { x: 0, y: 0 },
          endPoint: { x: 5, y: 0 },
          programLineNumber: 6
        },
        {
          kind: 'lead-out',
          operationId,
          startPoint: { x: 5, y: 0 },
          endPoint: { x: 3, y: 0 },
          programLineNumber: 11
        }
      ],
      padding: 1
    });

    expect(preview.paths.filter((path) => path.travelSource === 'posted')).toEqual([
      expect.objectContaining({
        line: 6,
        start: { x: 0, y: 0 },
        end: { x: 5, y: 0 },
        travelRole: 'lead-in',
        type: 'cut'
      }),
      expect.objectContaining({
        line: 11,
        start: { x: 5, y: 0 },
        end: { x: 3, y: 0 },
        travelRole: 'lead-out',
        type: 'cut'
      })
    ]);
    expect(preview.paths.some((path) =>
      path.travelRole === 'rapid-in' && path.travelSource === 'posted'
    )).toBe(false);
    expect(preview.paths.some((path) =>
      path.travelRole === 'rapid-in' && path.travelSource === 'planned'
    )).toBe(true);
  });

  it('keeps canonical planned rapid travel visible when posted transition metadata is empty', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 10, y: 20 }, radius: 5 },
      { type: 'circle', layer: 'CUT', center: { x: 30, y: 20 }, radius: 5 }
    ]);

    const preview = buildEditorPathDocumentPreviewGeometry(document, {
      postedTransitions: []
    });
    const plannedRapids = preview.paths.filter((path) =>
      path.travelRole === 'rapid-in' && path.travelSource === 'planned'
    );

    expect(plannedRapids).toHaveLength(2);
    expect(plannedRapids.map((path) => [path.start, path.end])).toEqual([
      [{ x: 0, y: 0 }, { x: 15, y: 20 }],
      [{ x: 15, y: 20 }, { x: 35, y: 20 }]
    ]);
  });

  it('renders posted travel as a distinct overlay without replacing the editable planned route', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      line(5, 0, 15, 0),
      line(15, 0, 15, 5),
      line(15, 5, 5, 5),
      line(5, 5, 5, 0)
    ]);
    const operationId = document.plan.operations[0].id;

    const preview = buildEditorPathDocumentPreviewGeometry(document, {
      postedTransitions: [{
        kind: 'lead-in',
        operationId,
        startPoint: { x: 0, y: 0 },
        endPoint: { x: 5, y: 0 },
        programLineNumber: 6
      }]
    });

    expect(preview.paths.filter((path) => path.travelSource === 'planned')).toContainEqual(
      expect.objectContaining({ travelRole: 'rapid-in', type: 'rapid' })
    );
    expect(preview.paths.filter((path) => path.travelSource === 'posted')).toEqual([
      expect.objectContaining({ line: 6, travelRole: 'lead-in', type: 'cut' })
    ]);
  });

  it('shows only the real Robofil origin approach when no lead-out was posted', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      line(5, 0, 15, 0),
      line(15, 0, 15, 5),
      line(15, 5, 5, 5),
      line(5, 5, 5, 0)
    ]);
    const operationId = document.plan.operations[0].id;

    const preview = buildEditorPathDocumentPreviewGeometry(document, {
      postedTransitions: [
        {
          kind: 'lead-in',
          operationId,
          startPoint: { x: 0, y: 0 },
          endPoint: { x: 5, y: 0 },
          programLineNumber: 6
        }
      ]
    });

    expect(preview.paths.filter((path) => path.travelSource === 'posted').map((path) => path.travelRole)).toEqual([
      'lead-in'
    ]);
  });

  it('derives the verified Robofil G92-origin approach from actual posted block metadata', () => {
    const machine = createVerifiedCharmillesRobofil100Profile();
    const source = createPathPlanningDocumentFromDxfEntities([
      line(0, 0, 10, 0),
      line(10, 0, 10, 5),
      line(10, 5, 0, 5),
      line(0, 5, 0, 0)
    ]);
    let document = translatePathDocument(
      initializeProjectCompensationIntents(source, machine),
      { x: 5, y: 7 }
    )!;
    document = setManualInitialWirePosition(document, { x: 0, y: 0 })!;

    expect(deriveVerifiedRobofilPreviewTransitions(document, machine)).toEqual([
      {
        kind: 'lead-in',
        operationId: document.plan.operations[0].id,
        programLineNumber: 6,
        startPoint: { x: 0, y: 0 },
        endPoint: { x: 5, y: 7 }
      }
    ]);
    expect(
      deriveVerifiedRobofilPreviewTransitions(
        document,
        { ...machine, controller: { ...machine.controller, verification: { status: 'unverified' } } }
      )
    ).toEqual([]);
    expect(
      deriveVerifiedRobofilPreviewTransitions(document, createDefaultMachineProfile())
    ).toBeUndefined();
  });

  it('derives posted rapid and lead overlays from a ready Robofil v2 multi-contour program', () => {
    const machine = markMachineProfileUserVerified(
      createCharmillesRobofil100V2CandidateProfile()
    );
    let document = initializeProjectCompensationIntents(
      createPathPlanningDocumentFromDxfEntities([
        { type: 'circle', layer: 'CUT', center: { x: 10, y: 20 }, radius: 5 },
        { type: 'circle', layer: 'CUT', center: { x: 30, y: 20 }, radius: 5 }
      ]),
      machine
    );
    for (const operation of document.plan.operations) {
      document = setCircleOperationCenterPierceLeadIn(document, operation.id)!;
    }
    document = setManualInitialWirePosition(document, { x: 0, y: 0 })!;

    const transitions = deriveVerifiedRobofilPreviewTransitions(document, machine);

    expect(transitions?.map((transition) => transition.kind)).toEqual([
      'rapid', 'lead-in', 'rapid', 'lead-in'
    ]);
    expect(transitions?.filter((transition) => transition.kind === 'rapid').map((transition) => transition.endPoint))
      .toEqual([{ x: 10, y: 20 }, { x: 30, y: 20 }]);
  });

  it('suppresses synthetic transitions when an unsafe compensated center-pierce post is blocked', () => {
    const machine = createVerifiedCharmillesRobofil100Profile();
    const initialized = initializeProjectCompensationIntents(
      createPathPlanningDocumentFromDxfEntities([
        { type: 'circle', layer: 'CUT', center: { x: 30, y: 30 }, radius: 5 }
      ]),
      machine
    );
    const document = setCircleOperationCenterPierceLeadIn(
      initialized,
      initialized.plan.operations[0].id
    )!;

    expect(deriveVerifiedRobofilPreviewTransitions(document, machine)).toEqual([]);
  });

  it('suppresses synthetic transitions for verified Robofil wire-centre and missing-intent blockers', () => {
    const machine = createVerifiedCharmillesRobofil100Profile();
    const wireCentre = createPathPlanningDocumentFromDxfEntities([
      line(0, 0, 10, 0),
      line(10, 0, 10, 5),
      line(10, 5, 0, 5),
      line(0, 5, 0, 0)
    ]);
    const missingIntent = {
      ...wireCentre,
      geometryBasis: 'finished-contour' as const
    };

    expect(deriveVerifiedRobofilPreviewTransitions(wireCentre, machine)).toEqual([]);
    expect(deriveVerifiedRobofilPreviewTransitions(missingIntent, machine)).toEqual([]);
  });

  it('suppresses generic fallback for verified Robofil multi-operation and unsupported-envelope blockers', () => {
    const machine = createVerifiedCharmillesRobofil100Profile();
    const multiOperation = initializeProjectCompensationIntents(
      createPathPlanningDocumentFromDxfEntities([
        line(5, 0, 10, 0),
        line(10, 0, 10, 5),
        line(10, 5, 5, 5),
        line(5, 5, 5, 0),
        line(20, 0, 25, 0),
        line(25, 0, 25, 5),
        line(25, 5, 20, 5),
        line(20, 5, 20, 0)
      ]),
      machine
    );
    const unsupportedEnvelope = markMachineProfileUserVerified({
      ...machine,
      output: { ...machine.output, coordinatePrecision: 4 }
    });
    const singleOperation = initializeProjectCompensationIntents(
      createPathPlanningDocumentFromDxfEntities([
        line(5, 0, 10, 0),
        line(10, 0, 10, 5),
        line(10, 5, 5, 5),
        line(5, 5, 5, 0)
      ]),
      unsupportedEnvelope
    );

    expect(multiOperation.plan.operations).toHaveLength(2);
    expect(deriveVerifiedRobofilPreviewTransitions(multiOperation, machine)).toEqual([]);
    expect(
      deriveVerifiedRobofilPreviewTransitions(singleOperation, unsupportedEnvelope)
    ).toEqual([]);
  });

  it('suppresses a verified Robofil approach when fixed precision blocks the contour geometry', () => {
    const machine = createVerifiedCharmillesRobofil100Profile();
    const source = createPathPlanningDocumentFromDxfEntities(
      [{ type: 'circle', layer: 'CUT', center: { x: 1, y: 1 }, radius: 0.0004 }],
      { coincidenceEpsilon: 1e-12 }
    );
    source.geometryBasis = 'finished-contour';
    const document = setManualCompensationIntent(
      source,
      source.plan.operations[0].id,
      'inside'
    )!;

    expect(deriveVerifiedRobofilPreviewTransitions(document, machine)).toEqual([]);
  });

  it('keeps the posted approach when raw-coincident points format to distinct machine coordinates', () => {
    const machine = createVerifiedCharmillesRobofil100Profile();
    const source = createPathPlanningDocumentFromDxfEntities(
      [
        line(0.0006, 0, 10.0006, 0),
        line(10.0006, 0, 10.0006, 5),
        line(10.0006, 5, 0.0006, 5),
        line(0.0006, 5, 0.0006, 0)
      ],
      { coincidenceEpsilon: 0.001 }
    );
    let document = initializeProjectCompensationIntents(source, machine);
    document = setManualInitialWirePosition(document, { x: 0, y: 0 })!;

    expect(deriveVerifiedRobofilPreviewTransitions(document, machine)).toEqual([
      {
        kind: 'lead-in',
        operationId: document.plan.operations[0].id,
        programLineNumber: 6,
        startPoint: { x: 0, y: 0 },
        endPoint: { x: 0.0006, y: 0 }
      }
    ]);
  });

  it('uses stable synthetic line ids when path document preview has stale line hints', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      line(0, 0, 10, 0),
      line(10, 0, 10, 5),
      line(10, 5, 0, 5),
      line(0, 5, 0, 0)
    ]);

    const preview = buildEditorPathDocumentPreviewGeometry(document, {
      lineHints: [9],
      padding: 1
    });

    expect(preview.paths.map((path) => path.line)).toEqual([9, 2, 3, 4, 5]);
  });

  it('expands the fit viewBox to the rendered viewport aspect instead of letterboxing the SVG', () => {
    expect(
      fitViewBoxToViewportAspect(
        {
          minX: -42,
          minY: -1,
          width: 54,
          height: 12
        },
        1336,
        1158
      )
    ).toEqual({
      minX: -42,
      minY: -18.402695,
      width: 54,
      height: 46.805389
    });
  });
});

function line(startX: number, startY: number, endX: number, endY: number) {
  return {
    type: 'line' as const,
    layer: 'CUT',
    start: { x: startX, y: startY },
    end: { x: endX, y: endY }
  };
}
