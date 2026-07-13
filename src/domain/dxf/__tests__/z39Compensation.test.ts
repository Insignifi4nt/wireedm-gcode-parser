import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { initializeProjectCompensationIntents, setManualCompensationIntent } from '@/domain/compensation/intent';
import { resolveControllerCompensation } from '@/domain/compensation/resolveControllerCompensation';
import { createVerifiedCharmillesRobofil100Profile } from '@/domain/machine/machineProfiles';
import {
  previewClosedOperationStartNearPoint,
  reversePathOperation,
  setClosedOperationStartNearPoint,
  translatePathDocument
} from '@/domain/path-editor/pathDocumentOperations';
import { segmentMap, signedAreaOfPath } from '@/domain/path-intel/segments';
import type { GcodePostedBlock } from '@/domain/post/upidMachinePost';
import { composeUpidGCodeExport } from '@/domain/upid/upidDocument';

import { dxfEntitiesToUpidDocument } from '../dxfToUpid';
import { parseDxf } from '../parseDxf';

const fixtureText = readFileSync(
  resolve(process.cwd(), 'DXF-test-subjects/z39motocicleta.dxf'),
  'utf8'
);

describe('z39 compensation review acceptance', () => {
  it('keeps semantic material intent while reversal derives the opposite controller side', () => {
    const machine = createVerifiedCharmillesRobofil100Profile();
    const parsed = parseDxf(fixtureText);
    const document = initializeProjectCompensationIntents(
      dxfEntitiesToUpidDocument(parsed.entities),
      machine
    );
    const operation = document.plan.operations[0];
    const contour = document.contours.find((candidate) => candidate.id === operation.contourId)!;
    const forward = resolveControllerCompensation({ document, operation });
    const reversed = reversePathOperation(document, operation.id)!;
    const reverse = resolveControllerCompensation({
      document: reversed,
      operation: reversed.plan.operations[0]
    });

    expect(document.segments).toHaveLength(156);
    expect(document.plan.operations).toHaveLength(1);
    expect(operation.classification).toBe('exterior');
    expect(operation.metrics.cutLength).toBeCloseTo(178.637007, 5);
    expect(contour.area).toBeCloseTo(1216.888483, 5);
    expect(signedAreaOfPath(operation.segmentRefs, segmentMap(document.segments))).toBeCloseTo(
      1216.888483,
      5
    );
    expect(operation.compensationIntent).toMatchObject({ keptMaterial: 'inside' });
    expect(forward).toMatchObject({ status: 'ready', keptMaterial: 'inside' });
    expect(reverse).toMatchObject({ status: 'ready', keptMaterial: 'inside' });
    if (forward.status !== 'ready' || reverse.status !== 'ready') {
      throw new Error('Expected both z39 directions to resolve controller compensation.');
    }
    expect(reverse.code).not.toBe(forward.code);

    const posted = composeUpidGCodeExport(physicalZ39Document(parsed.entities, machine), { machine }).post;
    expect(auditRapidWhileCompensated(posted.blocks)).toEqual([]);
    expect(posted.blocks.some((block) => block.kind === 'lead-in')).toBe(true);
    expect(posted.blocks.some((block) => block.kind === 'program-end' && block.text === 'M02')).toBe(true);
    expect(posted.blocks.some((block) => (block.kind as string) === 'lead-out')).toBe(false);
    expect(document.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    expect(document.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'units-assumed-millimeters'
    ]);
  });

  it('persists a manual kept side as intent rather than literal G-code', () => {
    const machine = createVerifiedCharmillesRobofil100Profile();
    const document = physicalZ39Document(parseDxf(fixtureText).entities, machine);
    const operation = document.plan.operations[0];
    const manual = setManualCompensationIntent(document, operation.id, 'outside')!;
    const reversed = reversePathOperation(manual, operation.id)!;

    expect(manual.plan.operations[0].compensationIntent).toEqual({
      mode: 'controller',
      keptMaterial: 'outside',
      source: 'manual'
    });
    expect(reversed.plan.operations[0].compensationIntent).toEqual(
      manual.plan.operations[0].compensationIntent
    );
    expect(JSON.stringify(reversed)).not.toMatch(/"(?:G41|G42)"/);
  });
});

function auditRapidWhileCompensated(blocks: GcodePostedBlock[]) {
  return blocks.filter(
    (block) => block.kind === 'rapid' && block.compensationBefore !== 'G40'
  );
}

function physicalZ39Document(
  entities: ReturnType<typeof parseDxf>['entities'],
  machine: ReturnType<typeof createVerifiedCharmillesRobofil100Profile>
) {
  const initialized = initializeProjectCompensationIntents(
    dxfEntitiesToUpidDocument(entities),
    machine
  );
  const translated = translatePathDocument(initialized, { x: 6.894299, y: -19.024251 })!;
  const operation = translated.plan.operations[0];
  const preview = previewClosedOperationStartNearPoint(
    translated,
    operation.id,
    { x: -1.2, y: -18.946 },
    false
  )!;
  return setClosedOperationStartNearPoint(translated, operation.id, preview.point)!;
}
