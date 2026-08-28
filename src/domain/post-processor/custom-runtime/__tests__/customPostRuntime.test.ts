import { describe, expect, it } from 'vitest';

import { compileWireEdmExecutionPlan } from '@/domain/execution-plan/executionPlan';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { minimalPostPackage } from '@/domain/post-processor/__tests__/postPackageFixture';

import { runCustomPostConformance } from '../customPostConformance';
import { runCustomPost } from '../customPostRuntime';

describe('isolated custom JavaScript post runtime', () => {
  it('processes every neutral event once and derives motion trace from rendered parameters', async () => {
    const fixture = runtimeFixture();
    const result = await runCustomPost(fixture);

    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.program.text).toBe('G90\nG1 X0 Y0\nG1 X10 Y0\nM02');
    expect(result.program.eventDispositions).toHaveLength(fixture.plan.events.length);
    expect(result.program.blocks.filter(({ motion }) => motion !== null)).toEqual([
      expect.objectContaining({
        text: 'G1 X0 Y0',
        motion: expect.objectContaining({ start: { x: -2, y: 0 }, end: { x: 0, y: 0 } })
      }),
      expect.objectContaining({
        text: 'G1 X10 Y0',
        motion: expect.objectContaining({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } })
      })
    ]);
  });

  it('derives an audited circular center from the same declared offset parameters rendered in text', async () => {
    const fixture = runtimeFixture();
    const document = createUpidFromDxfEntities([{
      type: 'circle',
      layer: 'CUT',
      center: { x: 5, y: 5 },
      radius: 2
    }]);
    document.setup = {
      initialWirePosition: {
        kind: 'manual',
        point: { x: 7, y: 5 },
        review: 'reviewed'
      }
    };
    const compiled = compileWireEdmExecutionPlan(document);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    fixture.plan = compiled.plan;
    for (const id of ['motion.arc-clockwise', 'motion.arc-counterclockwise']) {
      fixture.package.dialect.commands[id] = {
        template: `${id === 'motion.arc-clockwise' ? 'G2' : 'G3'} X{x} Y{y} I{i} J{j}`,
        parameters: {
          x: { type: 'number', role: 'motion.end-x', description: 'X endpoint.' },
          y: { type: 'number', role: 'motion.end-y', description: 'Y endpoint.' },
          i: {
            type: 'number',
            role: 'motion.center-x',
            centerReference: { kind: 'fixed', mode: 'incremental' },
            description: 'Incremental X center.'
          },
          j: {
            type: 'number',
            role: 'motion.center-y',
            centerReference: { kind: 'fixed', mode: 'incremental' },
            description: 'Incremental Y center.'
          }
        },
        effects: ['position.changed'],
        requires: ['distance.absolute'],
        evidenceRefs: ['robofil-program']
      };
      fixture.package.evidence[0].supports.push({ kind: 'command', id });
    }
    fixture.package.source.code = `
      export function createPost(api) {
        return { onEvent(event) {
          if (event.kind === 'program-start') return api.emitCommand('distance.absolute', {});
          if (event.kind === 'motion') {
            const command = event.clockwise ? 'motion.arc-clockwise' : 'motion.arc-counterclockwise';
            return api.emitMotion(command, {
              x: event.end.x,
              y: event.end.y,
              i: event.center.x - event.start.x,
              j: event.center.y - event.start.y
            });
          }
          if (event.kind === 'program-end') return api.emitCommand('program.end', {});
          api.consume('No controller block required.');
        } };
      }
    `;

    const result = await runCustomPost(fixture);

    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const motion = result.program.blocks.find(({ motion }) => motion?.motion === 'circular');
    expect(motion).toMatchObject({
      text: expect.stringMatching(/ I-2 J0$/),
      motion: { center: { x: 5, y: 5 } }
    });
  });

  it('keeps property access exact and preserves a caught host failure as fatal', async () => {
    const fixture = runtimeFixture();
    fixture.package.source.code = `
      export function createPost(api) {
        return { onEvent(event) {
          try { api.getProperty('missing'); } catch {}
          api.consume('caught');
        } };
      }
    `;

    await expect(runCustomPost(fixture)).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: 'POST_CUSTOM_API_MISUSE' }]
    });
  });

  it('blocks imports, ambient nondeterminism, resource exhaustion, and dishonest motion text', async () => {
    const imported = runtimeFixture();
    imported.package.source.code = `
      import value from './ambient.js';
      export function createPost() { return { onEvent() {} }; }
    `;
    await expect(runCustomPost(imported)).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: 'POST_CUSTOM_SOURCE_INVALID' }]
    });

    const extraExport = runtimeFixture();
    extraExport.package.source.code = `
      export const metadata = 'not allowed';
      export function createPost() { return { onEvent() {} }; }
    `;
    await expect(runCustomPost(extraExport)).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: 'POST_CUSTOM_EXPORT_INVALID' }]
    });

    const ambient = runtimeFixture();
    ambient.package.source.code = `
      export function createPost(api) {
        if (Date !== undefined || Math.random !== undefined || typeof fetch !== 'undefined') {
          throw new Error('ambient host capability exposed');
        }
        return ${handlerSource()};
      }
    `;
    await expect(runCustomPost(ambient)).resolves.toMatchObject({ ok: true });

    const looping = runtimeFixture();
    looping.package.source.code = `
      export function createPost() {
        return { onEvent() { while (true) {} } };
      }
    `;
    await expect(runCustomPost({
      ...looping,
      limits: { deadlineMs: 20, interruptCycles: 1_000 }
    })).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: 'POST_CUSTOM_RESOURCE_LIMIT' }]
    });

    const eventLimited = runtimeFixture();
    await expect(runCustomPost({ ...eventLimited, limits: { events: 1 } })).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: 'POST_CUSTOM_EVENT_LIMIT' }]
    });

    const outputLimited = runtimeFixture();
    await expect(runCustomPost({ ...outputLimited, limits: { outputBytes: 2 } })).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: 'POST_CUSTOM_OUTPUT_LIMIT' }]
    });

    const actionLimited = runtimeFixture();
    await expect(runCustomPost({ ...actionLimited, limits: { actions: 1 } })).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: 'POST_CUSTOM_RESOURCE_LIMIT' }]
    });

    const dishonest = runtimeFixture();
    dishonest.package.source.code = `
      export function createPost(api) {
        return { onEvent(event) {
          if (event.kind === 'program-start') return api.emitCommand('distance.absolute', {});
          if (event.kind === 'position') return api.emitMotion('motion.linear', { x: event.to.x, y: event.to.y });
          if (event.kind === 'motion') return api.emitMotion('motion.linear', { x: event.end.x + 1, y: event.end.y });
          if (event.kind === 'program-end') return api.emitCommand('program.end', {});
          api.consume('No controller block required.');
        } };
      }
    `;
    await expect(runCustomPost(dishonest)).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: 'POST_CUSTOM_AUDIT_FAILED' }]
    });
  });

  it('enforces declared dialect state and exact conformance fixture output', async () => {
    const stateFailure = runtimeFixture();
    stateFailure.package.dialect.commands['program.end'].requires = ['distance.absolute'];
    stateFailure.package.dialect.commands['motion.linear'].requires = [];
    stateFailure.package.source.code = `
      export function createPost(api) {
        return { onEvent(event) {
          if (event.kind === 'position') return api.emitMotion('motion.linear', { x: event.to.x, y: event.to.y });
          if (event.kind === 'motion') return api.emitMotion('motion.linear', { x: event.end.x, y: event.end.y });
          if (event.kind === 'program-end') return api.emitCommand('program.end', {});
          api.consume('No controller block required.');
        } };
      }
    `;
    await expect(runCustomPost(stateFailure)).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: 'POST_CUSTOM_STATE_REQUIRED' }]
    });

    const fixture = runtimeFixture();
    const conformance = await runCustomPostConformance({
      packageValue: fixture.package,
      planFixtures: { 'core.test-plan.v1': fixture.plan }
    });
    expect(conformance).toMatchObject({
      ok: true,
      fixtures: [{ fixtureId: 'runtime-plan' }]
    });

    const mismatch = runtimeFixture();
    mismatch.package.fixtures[0].expectedProgram = 'DIFFERENT';
    await expect(runCustomPostConformance({
      packageValue: mismatch.package,
      planFixtures: { 'core.test-plan.v1': mismatch.plan }
    })).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: 'POST_CONFORMANCE_EXPECTED_PROGRAM_MISMATCH' }]
    });
  });
});

function runtimeFixture() {
  const document = createUpidFromDxfEntities([{
    type: 'line',
    layer: 'CUT',
    start: { x: 0, y: 0 },
    end: { x: 10, y: 0 }
  }]);
  document.setup = {
    initialWirePosition: {
      kind: 'manual',
      point: { x: -2, y: 0 },
      review: 'reviewed'
    }
  };
  const compiled = compileWireEdmExecutionPlan(document);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));

  const packageValue = minimalPostPackage();
  packageValue.manifest.capabilities.controllerCompensation = 'none';
  packageValue.manifest.capabilities.threading = 'none';
  packageValue.manifest.execution.compensationLifecycle = 'none';
  packageValue.manifest.execution.compensationRequiredForEveryOperation = false;
  packageValue.dialect.commands['motion.linear'] = {
    template: 'G1 X{x} Y{y}',
    parameters: {
      x: { type: 'number', role: 'motion.end-x', description: 'X endpoint.' },
      y: { type: 'number', role: 'motion.end-y', description: 'Y endpoint.' }
    },
    effects: ['position.changed'],
    requires: ['distance.absolute'],
    evidenceRefs: ['robofil-program']
  };
  packageValue.evidence[0].supports.push({ kind: 'command', id: 'motion.linear' });
  packageValue.source.code = `
    export function createPost(api) {
      api.getProperty('coordinatePrecision');
      return ${handlerSource()};
    }
  `;
  packageValue.fixtures = [{
    id: 'runtime-plan',
    description: 'Exact runtime plan fixture.',
    planFixture: 'core.test-plan.v1',
    properties: { coordinatePrecision: 3 },
    expectedProgram: 'G90\nG1 X0 Y0\nG1 X10 Y0\nM02',
    evidenceRefs: ['robofil-program']
  }];
  return {
    package: packageValue,
    plan: compiled.plan,
    properties: { coordinatePrecision: 3 }
  };
}

function handlerSource() {
  return `({ onEvent(event) {
    if (event.kind === 'program-start') return api.emitCommand('distance.absolute', {});
    if (event.kind === 'position') return api.emitMotion('motion.linear', { x: event.to.x, y: event.to.y });
    if (event.kind === 'motion') return api.emitMotion('motion.linear', { x: event.end.x, y: event.end.y });
    if (event.kind === 'program-end') return api.emitCommand('program.end', {});
    api.consume('No controller block required.');
  } })`;
}
