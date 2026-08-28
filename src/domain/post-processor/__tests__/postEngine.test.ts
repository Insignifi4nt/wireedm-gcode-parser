import { describe, expect, it } from 'vitest';

import { setManualCompensationIntent } from '@/domain/compensation/intent';
import { compileWireEdmExecutionPlan, type WireEdmExecutionPlan } from '@/domain/execution-plan/executionPlan';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';

import { builtInPostPackage, type BuiltInPostKey } from '../builtInPostPackages';
import { auditControllerProgram } from '../controllerProgram';
import { runBuiltInPost } from '../postEngine';
import { createEmptyPostLibrary, installPostPackage, type PostInstallation } from '../postLibrary';
import type { WireEdmPostPackageValue } from '../postPackageSchema';

describe('exact-hash built-in post engine', () => {
  it('renders generic ISO from neutral motion and acknowledges every event', async () => {
    const plan = compilePlan(centerlineRectangle());
    const installation = await installationFor('generic-iso');

    const result = runBuiltInPost(plan, {
      installation,
      properties: { coordinatePrecision: 3, arcCenterMode: 'incremental' }
    });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));

    expect(result.program.lines.slice(0, 6)).toEqual([
      '%', 'G90', 'G21', 'G17', 'G40', 'G54'
    ]);
    expect(result.program.lines).toContain('G0 X0.000 Y0.000');
    expect(result.program.lines.slice(-3)).toEqual(['G40', 'M30', '%']);
    expect(result.program.eventDispositions).toHaveLength(plan.events.length);
    expect(result.program.blocks.filter(({ motion }) => motion)).toHaveLength(
      plan.events.filter(({ kind }) => kind === 'position' || kind === 'motion').length
    );
  });

  it('renders explicit-linear activation and cancellation only on reviewed lead geometry', async () => {
    const document = compensatedRectangle();
    const operation = document.plan.operations[0];
    operation.transitions = {
      entry: {
        strategy: 'manual-straight',
        move: 'cut',
        from: { x: -2, y: 0 },
        to: { x: 0, y: 0 },
        review: 'reviewed'
      },
      exit: {
        strategy: 'manual-straight',
        move: 'cut',
        from: { x: 0, y: 0 },
        to: { x: -2, y: 0 },
        review: 'reviewed'
      }
    };
    const plan = compilePlan(document);
    const installation = await installationFor('generic-explicit-linear');

    const result = runBuiltInPost(plan, {
      installation,
      properties: { coordinatePrecision: 3, offsetIndex: 7, arcCenterMode: 'incremental' }
    });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));

    expect(result.program.text).toContain('G41 D7 G1 X0.000 Y0.000');
    expect(result.program.text).toContain('G40 G1 X-2.000 Y0.000');
  });

  it('preserves the evidenced Robofil v1 setup and program-scoped lifecycle', async () => {
    const plan = compilePlan(compensatedRectangle());
    const installation = await installationFor('robofil-v1');

    const result = runBuiltInPost(plan, {
      installation,
      properties: { coordinatePrecision: 3, offsetIndex: 0 }
    });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));

    expect(result.program.lines.slice(0, 6)).toEqual([
      'G92 X-2.000 Y0.000',
      'G60',
      'G38',
      'G41 D0',
      'G90',
      'G1 X0.000 Y0.000'
    ]);
    expect(result.program.lines.at(-1)).toBe('M02');
    expect(result.program.text).not.toMatch(/(?:^|\n)G0\b/);
  });

  it('renders Robofil v2 compensation boundaries before positioning and at program end', async () => {
    const plan = compilePlan(compensatedRectangle());
    const installation = await installationFor('robofil-v2');

    const result = runBuiltInPost(plan, {
      installation,
      properties: { coordinatePrecision: 3, offsetIndex: 0 }
    });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));

    expect(result.program.lines.slice(0, 9)).toEqual([
      'G92 X-2.000 Y0.000',
      'G60',
      'G38',
      'G90',
      'G39',
      'G40',
      'G0 X0.000 Y0.000',
      'G41 D0',
      'G1 X10.000 Y0.000'
    ]);
    expect(result.program.lines.slice(-3)).toEqual(['G39', 'G40', 'M02']);
  });

  it('rejects modified package content instead of choosing a post by ID or version', async () => {
    const modified = structuredClone(builtInPostPackage('generic-iso')) as WireEdmPostPackageValue;
    modified.source.code += '\n// modified package content';
    const installed = await installPostPackage(createEmptyPostLibrary(), modified);
    if (!installed.ok) throw new Error(installed.error.message);

    expect(runBuiltInPost(compilePlan(centerlineRectangle()), {
      installation: installed.installation,
      properties: { coordinatePrecision: 3, arcCenterMode: 'incremental' }
    })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'POST_BUILTIN_NOT_RUNNABLE' }]
    });
  });

  it('detects a motion trace changed after rendering', async () => {
    const plan = compilePlan(centerlineRectangle());
    const installation = await installationFor('generic-iso');
    const result = runBuiltInPost(plan, {
      installation,
      properties: { coordinatePrecision: 3, arcCenterMode: 'incremental' }
    });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const tampered = structuredClone(result.program);
    const motionBlock = tampered.blocks.find(({ motion }) => motion);
    if (!motionBlock?.motion) throw new Error('Expected a motion block.');
    motionBlock.motion.end.x += 1;

    expect(auditControllerProgram(
      plan,
      tampered,
      new Set(Object.keys(installation.package.dialect.commands))
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'POST_AUDIT_MOTION_MISMATCH' })
    ]));
  });
});

function centerlineRectangle() {
  const document = createUpidFromDxfEntities(rectangle());
  document.setup = {
    initialWirePosition: {
      kind: 'manual', point: { x: -2, y: 0 }, review: 'reviewed'
    }
  };
  return document;
}

function compensatedRectangle() {
  const source = centerlineRectangle();
  source.geometryBasis = 'finished-contour';
  const operation = source.plan.operations[0];
  const document = setManualCompensationIntent(source, operation.id, 'outside');
  if (!document) throw new Error('Expected a closed contour fixture.');
  return document;
}

function compilePlan(document: ReturnType<typeof centerlineRectangle>): WireEdmExecutionPlan {
  const compiled = compileWireEdmExecutionPlan(document);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  return compiled.plan;
}

async function installationFor(key: BuiltInPostKey): Promise<PostInstallation> {
  const installed = await installPostPackage(createEmptyPostLibrary(), builtInPostPackage(key));
  if (!installed.ok) throw new Error(installed.error.message);
  return installed.installation;
}

function rectangle() {
  return [
    { type: 'line' as const, layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    { type: 'line' as const, layer: 'CUT', start: { x: 10, y: 0 }, end: { x: 10, y: 10 } },
    { type: 'line' as const, layer: 'CUT', start: { x: 10, y: 10 }, end: { x: 0, y: 10 } },
    { type: 'line' as const, layer: 'CUT', start: { x: 0, y: 10 }, end: { x: 0, y: 0 } }
  ];
}
