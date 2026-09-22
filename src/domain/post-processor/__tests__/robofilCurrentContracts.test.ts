import { beforeAll, describe, expect, it } from 'vitest';

import { setManualCompensationIntent } from '@/domain/compensation/intent';
import { compileWireEdmExecutionPlan } from '@/domain/execution-plan/executionPlan';
import { reversePathOperation } from '@/domain/path-editor/pathDocumentOperations';
import {
  setMachiningSpanParticipation, setPartialContourCompensationSide,
  setPartialContourEntryReview, setPartialContourExitReview
} from '@/domain/path-intel/machiningParticipation';
import type { OperationThreadingTransition, PathPlanningDocument } from '@/domain/path-intel/types';
import { compileSimulation, sampleSimulation } from '@/domain/simulation';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';

import packageJson from '../../../../tests/fixtures/machine-packages/robofil-100-v2/cristian-robofil-100-v2.wireedm-post.json';
import { serializeControllerOutput } from '../controllerOutput';
import { runPost } from '../postEngine';
import { createEmptyPostLibrary, hashPostPackage, installPostPackage, type PostInstallation } from '../postLibrary';
import { parseWireEdmPostPackage } from '../postPackage';

let installation: PostInstallation;
beforeAll(async () => {
  const parsed = parseWireEdmPostPackage(JSON.stringify(packageJson));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const installed = await installPostPackage(createEmptyPostLibrary(), parsed.package);
  if (!installed.ok) throw new Error(installed.error.message);
  installation = installed.installation;
});

function circleJob(radii = [5]) {
  let source = createUpidFromDxfEntities(radii.map(radius => ({
    type: 'circle', layer: 'CUT', center: { x: 10, y: 20 }, radius
  })));
  source.schemaVersion = 2;
  source.geometryBasis = 'finished-contour';
  for (const operation of source.plan.operations) {
    source = setManualCompensationIntent(source, operation.id, 'outside')!;
  }
  source.setup = { initialWirePosition: { kind: 'manual', point: { ...source.plan.operations[0].startPoint }, review: 'reviewed' },
    threadingDefault: { mode: 'manual', wireSeparation: 'automatic-during-positioning' } };
  return source;
}

function plan(source: PathPlanningDocument) {
  const compiled = compileWireEdmExecutionPlan(source);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  return compiled.plan;
}

async function posted(source: PathPlanningDocument) {
  const result = await runPost(plan(source), { installation, properties: { coordinatePrecision: 3, offsetIndex: 0 } });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.program;
}

describe('Robofil 2.6 compatibility with current UPID and simulation contracts', () => {
  it.each([false, true])('posts spatial circle stops with exact absolute centers and resolved direction, reversed=%s', async reversed => {
    let source = circleJob();
    if (reversed) source = reversePathOperation(source, source.plan.operations[0].id)!;
    source.plan.operations[0].programStops = [{ id: 'inspect-quarter', enabled: true, reason: 'operator-check',
      note: 'Verifică piesă – 🧵', placement: { kind: 'before-operation-end', remainingCutLengthMm: 7.5 * Math.PI } }];
    const execution = plan(source);
    const stop = execution.events.find(event => event.kind === 'program-stop')!;
    expect(stop).toMatchObject({ point: { x: expect.closeTo(10, 12), y: reversed ? 15 : 25 },
      trace: [{ kind: 'program-stop', operationId: source.plan.operations[0].id, stopId: 'inspect-quarter' }] });
    const program = await posted(source);
    const arc = reversed ? 'G2' : 'G3';
    expect(program.lines).toEqual([
      'G92 X15.000 Y20.000', reversed ? 'G42' : 'G41', 'G38 D0',
      `${arc} X10.000 Y${reversed ? '15' : '25'}.000 I10.000 J20.000`,
      'M00', `${arc} X15.000 Y20.000 I10.000 J20.000`, 'G40', 'G39', 'M02'
    ]);
    expect(program.blocks.filter(block => block.eventId === stop.id)).toEqual([
      expect.objectContaining({ text: 'M00', commandIds: ['operator.program-stop'], motion: null })
    ]);
    const output = serializeControllerOutput(program, installation.package.manifest.output);
    if (!output.ok) throw new Error(output.error.message);
    expect(output.text).toBe(`%\r\n${program.lines.map((line, index) => `N${(index + 1) * 10} ${line}`).join('\r\n')}\r\n`);
    expect(output.bytes.every(byte => byte < 128)).toBe(true);
  });

  it('posts only a reviewed partial circular span with its explicit wire side and original source-range trace', async () => {
    let source = circleJob();
    const operationId = source.plan.operations[0].id;
    const segmentId = source.segments[0].id;
    source.plan.operations[0].transitions = { entry: { strategy: 'none', review: 'reviewed' }, exit: { strategy: 'none', review: 'reviewed' } };
    source = setMachiningSpanParticipation(source, {
      sourceSegmentId: segmentId, range: { start: 0.75, end: 1 }, participation: 'inactive-reference'
    })!;
    source = setPartialContourCompensationSide(source, operationId, 'right')!;
    source = setPartialContourEntryReview(source, operationId, true)!;
    source = setPartialContourExitReview(source, operationId, true)!;
    const execution = plan(source);
    const cuts = execution.events.filter(event => event.kind === 'motion');
    expect(cuts).toHaveLength(1);
    expect(cuts[0]).toMatchObject({ sourceSegmentId: segmentId, sourceRange: { start: 0, end: 0.75 },
      start: { x: 15, y: 20 }, end: { x: expect.closeTo(10, 12), y: 15 }, fullCircle: false });
    expect((await posted(source)).lines).toEqual([
      'G92 X15.000 Y20.000', 'G42', 'G38 D0', 'G3 X10.000 Y15.000 I10.000 J20.000', 'G40', 'G39', 'M02'
    ]);
  });

  it('keeps simulation retention, waste removal, support and reverse seeks independent of the exact controller output', async () => {
    const source = circleJob([2, 5]);
    const original = structuredClone(source);
    const before = await posted(source);
    for (const wasteHandling of ['keep', 'remove-before-next-operation'] as const) {
      for (const retention of ['retain', 'fall'] as const) {
        const simulation = compileSimulation(source, { stock: { originX: 0, originY: 10, width: 20, depth: 20, thickness: 10, bottomZ: 0 },
          wireDiameter: 0.25, cutSpeedMmPerSecond: 10, rapidSpeedMmPerSecond: 20,
          guideClearanceMm: 20, supportFloorZ: -20, wasteHandling, retention });
        if (!simulation.ok) throw new Error(JSON.stringify(simulation.diagnostics));
        sampleSimulation(simulation.plan, Infinity);
        sampleSimulation(simulation.plan, 0);
      }
    }
    expect(source).toEqual(original);
    expect(await posted(source)).toEqual(before);
    expect(await hashPostPackage(installation.package)).toBe('95b530e9a22abbf4ba1f8a80bbdaa1536abd6380ac9165348a82afb1d4c45a5f');
  });

  it.each([
    ['manual', 'manual-before-positioning', 'POST_CUSTOM_CAPABILITY_UNSUPPORTED'],
    ['automatic', 'automatic-before-positioning', 'POST_CUSTOM_CAPABILITY_UNSUPPORTED'],
    ['manual', 'already-separated', 'POST_CUSTOM_RUNTIME_FAILED']
  ] as const)('retains the existing failure boundary for %s / %s', async (mode, wireSeparation, code) => {
    const source = circleJob([2, 5]);
    const transition: OperationThreadingTransition = { mode, wireSeparation, source: 'operation-override' };
    source.plan.operations[1].threadingTransition = transition;
    const result = await runPost(plan(source), { installation, properties: { coordinatePrecision: 3, offsetIndex: 0 } });
    expect(result).toMatchObject({ ok: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code })]) });
  });
});
