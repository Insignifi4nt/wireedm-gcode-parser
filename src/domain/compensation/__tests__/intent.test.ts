import { describe, expect, it } from 'vitest';

import { createVerifiedCharmillesRobofil100Profile } from '@/domain/machine/machineProfiles';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';

import {
  initializeProjectCompensationIntents,
  setManualCompensationIntent,
  suggestCompensationIntent
} from '../intent';

describe('compensation intent', () => {
  it.each([
    ['exterior', 'inside'],
    ['island', 'inside'],
    ['hole', 'outside']
  ] as const)('suggests %s as keep-%s only for eligible finished contours', (classification, keptMaterial) => {
    const document = eligibleContour(classification);

    expect(suggestCompensationIntent({ document, operation: document.plan.operations[0] })).toEqual({
      mode: 'controller',
      keptMaterial,
      source: 'automatic'
    });
  });

  it.each([
    ['wire-centre', 'exterior'],
    ['finished-contour', 'ambiguous'],
    ['finished-contour', 'open-chain']
  ] as const)('does not suggest controller compensation for %s/%s geometry', (geometryBasis, classification) => {
    const document = classification === 'open-chain'
      ? createPathPlanningDocumentFromDxfEntities([line(0, 0, 10, 0)])
      : eligibleContour(classification);
    document.geometryBasis = geometryBasis;
    document.plan.operations[0].classification = classification;

    expect(suggestCompensationIntent({ document, operation: document.plan.operations[0] })).toBeUndefined();
  });

  it('rejects automatic intent for degenerate or topology-diagnosed contours', () => {
    const degenerate = eligibleContour('exterior');
    degenerate.segments = degenerate.segments.map((segment) => ({
      ...segment,
      start: { x: segment.start.x, y: 0 },
      end: { x: segment.end.x, y: 0 }
    }));
    expect(suggestCompensationIntent({ document: degenerate, operation: degenerate.plan.operations[0] }))
      .toBeUndefined();

    const intersecting = eligibleContour('exterior');
    const diagnostic = {
      id: 'diag_test_intersection',
      severity: 'warning' as const,
      code: 'self-intersection' as const,
      message: 'Self-intersection blocks automatic compensation.',
      relatedContourIds: [intersecting.plan.operations[0].contourId]
    };
    intersecting.diagnostics.push(diagnostic);
    intersecting.contours[0].diagnosticIds.push(diagnostic.id);
    expect(suggestCompensationIntent({ document: intersecting, operation: intersecting.plan.operations[0] }))
      .toBeUndefined();
  });

  it('rejects automatic intent when final oriented refs are no longer continuous', () => {
    const document = eligibleContour('exterior');
    const refs = document.plan.operations[0].segmentRefs;
    document.plan.operations[0].segmentRefs = [refs[0], refs[2], refs[1], refs[3]];

    expect(document.plan.operations[0].closed).toBe(true);
    expect(document.chains[0].closed).toBe(true);
    expect(suggestCompensationIntent({ document, operation: document.plan.operations[0] }))
      .toBeUndefined();
  });

  it('initializes only with a supported, enabled, validly verified project machine snapshot', () => {
    const profile = createVerifiedCharmillesRobofil100Profile('project-machine', new Date('2026-07-13T10:00:00Z'));
    const document = createPathPlanningDocumentFromDxfEntities(rectangle());

    const initialized = initializeProjectCompensationIntents(document, profile);

    expect(initialized.geometryBasis).toBe('finished-contour');
    expect(initialized.plan.operations[0].compensationIntent).toEqual({
      mode: 'controller',
      keptMaterial: 'inside',
      source: 'automatic'
    });
    expect(document.geometryBasis).toBe('wire-centre');
    expect(document.plan.operations[0].compensationIntent).toBeUndefined();

    const disabled = structuredClone(profile);
    disabled.compensation.enabledByDefault = false;
    const disabledResult = initializeProjectCompensationIntents(document, disabled);
    expect(disabledResult.geometryBasis).toBe('wire-centre');
    expect(disabledResult.plan.operations[0].compensationIntent).toBeUndefined();

    const staleVerification = structuredClone(profile);
    staleVerification.compensation.offsetSelection.index = 7;
    const staleResult = initializeProjectCompensationIntents(document, staleVerification);
    expect(staleResult.geometryBasis).toBe('wire-centre');
    expect(staleResult.plan.operations[0].compensationIntent).toBeUndefined();
  });

  it('sets semantic manual intent without persisting a literal controller code', () => {
    const document = eligibleContour('exterior');
    const operationId = document.plan.operations[0].id;

    const outside = setManualCompensationIntent(document, operationId, 'outside');
    const centerline = setManualCompensationIntent(outside!, operationId, 'centerline');

    expect(outside?.plan.operations[0].compensationIntent).toEqual({
      mode: 'controller',
      keptMaterial: 'outside',
      source: 'manual'
    });
    expect(outside?.plan.operations[0].compensationIntent).not.toHaveProperty('code');
    expect(centerline?.plan.operations[0].compensationIntent).toEqual({
      mode: 'centerline',
      source: 'manual'
    });
    expect(document.plan.operations[0].compensationIntent).toBeUndefined();
  });

  it('does not allow controller-side intent on an open operation', () => {
    const document = createPathPlanningDocumentFromDxfEntities([line(0, 0, 10, 0)]);
    document.geometryBasis = 'finished-contour';

    expect(setManualCompensationIntent(document, document.plan.operations[0].id, 'inside')).toBeNull();
    expect(setManualCompensationIntent(document, document.plan.operations[0].id, 'centerline')?.plan.operations[0].compensationIntent)
      .toEqual({ mode: 'centerline', source: 'manual' });
  });
});

function eligibleContour(classification: 'exterior' | 'hole' | 'island' | 'ambiguous') {
  const document = createPathPlanningDocumentFromDxfEntities(rectangle());
  document.geometryBasis = 'finished-contour';
  document.plan.operations[0].classification = classification;
  document.contours[0].classification = classification;
  return document;
}

function rectangle() {
  return [
    line(0, 0, 10, 0),
    line(10, 0, 10, 5),
    line(10, 5, 0, 5),
    line(0, 5, 0, 0)
  ];
}

function line(startX: number, startY: number, endX: number, endY: number) {
  return {
    type: 'line' as const,
    layer: 'CUT',
    start: { x: startX, y: startY },
    end: { x: endX, y: endY }
  };
}
