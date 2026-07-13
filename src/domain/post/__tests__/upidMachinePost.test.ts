import { describe, expect, it } from 'vitest';

import { initializeProjectCompensationIntents } from '@/domain/compensation/intent';
import { resolveControllerCompensation } from '@/domain/compensation/resolveControllerCompensation';
import {
  createVerifiedCharmillesRobofil100Profile,
  markMachineProfileUserVerified
} from '@/domain/machine/machineProfiles';
import { reversePathOperation } from '@/domain/path-editor/pathDocumentOperations';
import { createDefaultMachineProfile } from '@/domain/workbench/defaultProject';
import { createUpidFromDxfEntities, postUpidToGcode } from '@/domain/upid/upidDocument';

import { postUpidForMachine } from '../upidMachinePost';

describe('postUpidForMachine', () => {
  it('posts the verified single-contour Robofil lifecycle as traceable blocks', () => {
    const machine = createVerifiedCharmillesRobofil100Profile(
      'robofil-snapshot',
      new Date('2026-07-13T00:00:00.000Z')
    );
    const document = compensatedRectangle(machine, 'G41');

    const posted = postUpidForMachine(document, machine);

    expect(posted.status).toBe('ready');
    expect(posted.body.split('\n').slice(0, 6)).toEqual([
      'G92 X0 Y0',
      'G60',
      'G38',
      'G41 D0',
      'G90',
      expect.stringMatching(/^G1 X-?\d+\.000 Y-?\d+\.000$/)
    ]);
    expect(posted.body.split('\n').at(-1)).toBe('M02');
    expect(posted.body).not.toMatch(/(?:^|\n)G0\b/);
    expect(posted.body).not.toMatch(/\b(?:G21|G17|G54|G40|M30)\b/);
    expect(posted.body.match(/\bD0\b/g)).toHaveLength(1);
    expect(posted.body).not.toMatch(/\bD0(?:\.|\s*[+-]?\d*\.\d)/);
    expect(posted.blocks.map((block) => block.kind).slice(0, 6)).toEqual([
      'setup',
      'setup',
      'compensation-activation',
      'compensation-activation',
      'setup',
      'contour'
    ]);
    expect(posted.blocks.at(-1)).toMatchObject({
      bodyLineIndex: posted.body.split('\n').length - 1,
      kind: 'program-end',
      text: 'M02'
    });
    expect(posted.metrics.rapidCount).toBe(0);
  });

  it('derives the opposite compensation code after reversing final refs', () => {
    const machine = createVerifiedCharmillesRobofil100Profile();
    const forward = compensatedRectangle(machine, 'G41');
    const operation = forward.plan.operations[0];
    const reversed = reversePathOperation(forward, operation.id)!;

    const before = postUpidForMachine(forward, machine);
    const after = postUpidForMachine(reversed, machine);

    expect(operation.compensationIntent).toEqual({
      mode: 'controller',
      keptMaterial: 'inside',
      source: 'automatic'
    });
    expect(reversed.plan.operations[0].compensationIntent).toEqual(operation.compensationIntent);
    expect(before.body).toContain('\nG41 D0\n');
    expect(after.body).toContain('\nG42 D0\n');
  });

  it('blocks a second compensated operation atomically', () => {
    const machine = createVerifiedCharmillesRobofil100Profile();
    const document = initializeProjectCompensationIntents(
      createUpidFromDxfEntities([
        ...clockwiseRectangle(0, 0, 10, 5),
        ...clockwiseRectangle(20, 0, 30, 5)
      ]),
      machine
    );

    const posted = postUpidForMachine(document, machine);

    expect(posted).toMatchObject({ status: 'blocked', body: '', blocks: [], moves: [] });
    expect(posted.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        details: expect.objectContaining({ reason: 'unsupported-operation-count' })
      })
    );
  });

  it.each(['unverified', 'stale-fingerprint'] as const)(
    'blocks an %s Robofil project snapshot atomically',
    (scenario) => {
      const verified = createVerifiedCharmillesRobofil100Profile();
      const document = compensatedRectangle(verified, 'G41');
      const machine = structuredClone(verified);
      if (scenario === 'unverified') machine.controller.verification = { status: 'unverified' };
      else machine.output.coordinatePrecision = 4;

      const posted = postUpidForMachine(document, machine);

      expect(posted).toMatchObject({ status: 'blocked', body: '', blocks: [], moves: [] });
      expect(posted.diagnostics).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          details: expect.objectContaining({ reason: 'unverified-machine-profile' })
        })
      );
    }
  );

  it('returns an empty body when the final profile-specific audit finds a forbidden word', () => {
    const base = createVerifiedCharmillesRobofil100Profile();
    const machine = markMachineProfileUserVerified({
      ...base,
      compensation: { ...base.compensation, preActivationCodes: ['G60', 'G21'] }
    });
    const document = compensatedRectangle(machine, 'G41');

    const posted = postUpidForMachine(document, machine);

    expect(posted).toMatchObject({ status: 'blocked', body: '', blocks: [], moves: [] });
    expect(posted.diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'error' })
    );
  });

  it('keeps generic centreline posting byte-compatible', () => {
    const machine = createDefaultMachineProfile();
    const document = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 30, y: 30 }, radius: 5 }
    ]);

    const legacy = postUpidToGcode(document, {
      coordinatePrecision: machine.output.coordinatePrecision
    });
    const posted = postUpidForMachine(document, machine);

    expect(posted.status).toBe('ready');
    expect(posted.body).toBe(legacy.body);
    expect(posted.moves).toEqual(legacy.moves);
    expect(posted.operations).toEqual(legacy.operations);
  });
});

function compensatedRectangle(
  machine: ReturnType<typeof createVerifiedCharmillesRobofil100Profile>,
  desiredCode: 'G41' | 'G42'
) {
  let document = initializeProjectCompensationIntents(
    createUpidFromDxfEntities(clockwiseRectangle(0, 0, 10, 5)),
    machine
  );
  const operation = document.plan.operations[0];
  const resolution = resolveControllerCompensation({ document, operation });
  if (resolution.status === 'ready' && resolution.code !== desiredCode) {
    document = reversePathOperation(document, operation.id)!;
  }
  return document;
}

function clockwiseRectangle(minX: number, minY: number, maxX: number, maxY: number) {
  return [
    line(minX, minY, minX, maxY),
    line(minX, maxY, maxX, maxY),
    line(maxX, maxY, maxX, minY),
    line(maxX, minY, minX, minY)
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
