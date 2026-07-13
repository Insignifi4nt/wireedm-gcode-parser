import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { initializeProjectCompensationIntents } from '@/domain/compensation/intent';
import { createVerifiedCharmillesRobofil100Profile } from '@/domain/machine/machineProfiles';
import {
  previewClosedOperationStartNearPoint,
  reversePathOperation,
  setClosedOperationStartNearPoint,
  translatePathDocument
} from '@/domain/path-editor/pathDocumentOperations';
import { segmentMap, signedAreaOfPath } from '@/domain/path-intel/segments';
import { composeUpidGCodeExport } from '@/domain/upid/upidDocument';

import { dxfEntitiesToUpidDocument } from '../dxfToUpid';
import { parseDxf } from '../parseDxf';

const fixtureText = readFileSync(
  resolve(process.cwd(), 'DXF-test-subjects/z39motocicleta.dxf'),
  'utf8'
);

describe('z39 verified Robofil post acceptance', () => {
  it('posts all 78 canonical arcs with the physically verified dialect and rounding bound', () => {
    const machine = createVerifiedCharmillesRobofil100Profile(
      'z39-robofil-snapshot',
      new Date('2026-07-13T00:00:00.000Z')
    );
    const document = physicalZ39Document(machine);
    const operation = document.plan.operations[0];
    const area = signedAreaOfPath(operation.segmentRefs, segmentMap(document.segments));

    expect(document.plan.operations).toHaveLength(1);
    expect(operation.segmentRefs).toHaveLength(156);
    expect(operation.classification).toBe('exterior');
    expect(operation.compensationIntent).toEqual({
      mode: 'controller',
      keptMaterial: 'inside',
      source: 'automatic'
    });
    expect(operation.metrics.cutLength).toBeCloseTo(178.6370073617, 8);
    expect(area).toBeCloseTo(1216.888482811, 4);

    const exported = composeUpidGCodeExport(document, { machine });
    const lines = exported.body.split('\n');
    const arcBlocks = exported.post.blocks.filter(
      (block) => block.kind === 'contour' && block.command === 'G3'
    );

    expect(exported.canDownload).toBe(true);
    expect(exported.post.status).toBe('ready');
    expect(exported.post.metrics.rapidCount).toBe(0);
    expect(exported.post.blocks.filter((block) => block.kind === 'rapid')).toEqual([]);
    expect(lines.slice(0, 5)).toEqual(['G92 X0 Y0', 'G60', 'G38', 'G42 D0', 'G90']);
    expect(lines.slice(5, 7)).toEqual([
      'G1 X-1.200 Y-18.946',
      'G1 X-0.500 Y-20.228'
    ]);
    expect(exported.post.blocks[5]).toMatchObject({
      kind: 'lead-in',
      startPoint: { x: 0, y: 0 },
      endPoint: expect.objectContaining({ x: expect.closeTo(-1.2, 3), y: expect.closeTo(-18.946, 3) })
    });
    expect(exported.post.blocks[6]).toMatchObject({
      kind: 'contour',
      segmentId: operation.segmentRefs[0].segmentId
    });
    expect(lines.at(-1)).toBe('M02');
    expect(exported.body).not.toMatch(/\b(?:G21|G17|G54|G40|M30)\b/);
    expect(exported.program.text.endsWith('M02\r\n')).toBe(true);
    expect(exported.program.text).not.toMatch(/(?<!\r)\n/);
    expect(arcBlocks).toHaveLength(78);

    const segments = segmentMap(document.segments);
    let maximumRadiusMismatch = 0;
    for (const block of arcBlocks) {
      const segment = segments.get(block.segmentId!);
      expect(segment?.kind).toBe('arc');
      if (!segment || segment.kind !== 'arc') continue;

      const words = numericWords(block.text);
      expect(words.I).toBe(Number(segment.center.x.toFixed(3)));
      expect(words.J).toBe(Number(segment.center.y.toFixed(3)));
      expect(Number.isFinite(words.I)).toBe(true);
      expect(Number.isFinite(words.J)).toBe(true);

      const start = roundedPoint(block.startPoint!, 3);
      const end = { x: words.X, y: words.Y };
      const startRadius = Math.hypot(start.x - words.I, start.y - words.J);
      const endRadius = Math.hypot(end.x - words.I, end.y - words.J);
      expect(Number.isFinite(startRadius)).toBe(true);
      expect(Number.isFinite(endRadius)).toBe(true);
      maximumRadiusMismatch = Math.max(
        maximumRadiusMismatch,
        Math.abs(startRadius - endRadius)
      );
    }
    expect(maximumRadiusMismatch).toBeLessThanOrEqual(0.001106 + 1e-9);
  });

  it('reverses traversal and compensation side while preserving canonical XY/I/J geometry', () => {
    const machine = createVerifiedCharmillesRobofil100Profile();
    const forward = physicalZ39Document(machine);
    const operation = forward.plan.operations[0];
    const reversed = reversePathOperation(forward, operation.id)!;

    const forwardPost = composeUpidGCodeExport(forward, { machine }).post;
    const reversedPost = composeUpidGCodeExport(reversed, { machine }).post;
    const forwardBySegment = contourBlockMap(forwardPost.blocks);
    const reversedBySegment = contourBlockMap(reversedPost.blocks);

    expect(forward.plan.operations[0].compensationIntent).toEqual(
      reversed.plan.operations[0].compensationIntent
    );
    expect(forwardPost.body).toContain('\nG42 D0\n');
    expect(reversedPost.body).toContain('\nG41 D0\n');
    expect([...reversedBySegment.keys()].sort()).toEqual([...forwardBySegment.keys()].sort());

    for (const [segmentId, forwardBlock] of forwardBySegment) {
      const reversedBlock = reversedBySegment.get(segmentId)!;
      const forwardWords = numericWords(forwardBlock.text);
      const reversedWords = numericWords(reversedBlock.text);
      expect({ I: reversedWords.I, J: reversedWords.J }).toEqual({
        I: forwardWords.I,
        J: forwardWords.J
      });
      expect({ x: reversedWords.X, y: reversedWords.Y }).toEqual(
        roundedPoint(forwardBlock.startPoint!, 3)
      );
      expect(roundedPoint(reversedBlock.startPoint!, 3)).toEqual({
        x: forwardWords.X,
        y: forwardWords.Y
      });
    }
  });
});

function physicalZ39Document(
  machine: ReturnType<typeof createVerifiedCharmillesRobofil100Profile>
) {
  const initialized = initializeProjectCompensationIntents(
    dxfEntitiesToUpidDocument(parseDxf(fixtureText).entities),
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

function numericWords(line: string) {
  return Object.fromEntries(
    [...line.matchAll(/\b([XYIJ])([+-]?(?:\d+(?:\.\d*)?|\.\d+))/g)].map((match) => [
      match[1],
      Number(match[2])
    ])
  ) as Record<'X' | 'Y' | 'I' | 'J', number>;
}

function roundedPoint(point: { x: number; y: number }, precision: number) {
  return {
    x: Number(point.x.toFixed(precision)) || 0,
    y: Number(point.y.toFixed(precision)) || 0
  };
}

function contourBlockMap(
  blocks: Array<{ kind: string; segmentId: string | null; text: string; startPoint: { x: number; y: number } | null }>
) {
  return new Map(
    blocks
      .filter((block) => block.kind === 'contour' && block.segmentId)
      .map((block) => [block.segmentId!, block])
  );
}
