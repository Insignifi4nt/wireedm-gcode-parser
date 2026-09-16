import { describe, expect, it } from 'vitest';

import { compileWireEdmExecutionPlan } from '@/domain/execution-plan/executionPlan';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { minimalPostPackage } from '@/domain/post-processor/__tests__/postPackageFixture';

import { runCustomPostConformance } from '../customPostConformance';
import { runCustomPost } from '../customPostRuntime';

describe('isolated custom JavaScript post runtime', () => {
  it.each(['consume', 'unrelated-command'] as const)(
    'rejects a later retention stop handled with %s even after an earlier stop',
    async (handling) => {
      const fixture = runtimeFixture();
      const document = createUpidFromDxfEntities([
        { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
      ]);
      document.setup = {
        initialWirePosition: { kind: 'manual', point: { x: 0, y: 0 }, review: 'reviewed' }
      };
      document.plan.operations[0].programStops = [
        { id: 'first', enabled: true, reason: 'part-retention', placement: { kind: 'before-entry' } },
        { id: 'retain', enabled: true, reason: 'part-retention', placement: { kind: 'before-operation-end', remainingCutLengthMm: 2 } }
      ];
      const compiled = compileWireEdmExecutionPlan(document);
      if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
      fixture.plan = compiled.plan;
      fixture.package.manifest.capabilities.programStops = true;
      fixture.package.dialect.commands['operator.stop'] = {
        template: 'M00', parameters: {}, effects: ['program.paused'], requires: [], evidenceRefs: ['robofil-program']
      };
      fixture.package.source.code = fixture.package.source.code.replace(
        "if (event.kind === 'program-start')",
        `if (event.kind === 'program-stop') {
          if (event.stopId === 'first') return api.emitCommand('operator.stop', {});
          return ${handling === 'consume' ? "api.consume('Skip stop.')" : "api.emitCommand('distance.absolute', {})"};
        }
        if (event.kind === 'program-start')`
      );
      const stop = fixture.plan.events.find((event) => event.kind === 'program-stop' && event.stopId === 'retain');

      await expect(runCustomPost(fixture)).resolves.toMatchObject({
        ok: false,
        diagnostics: [{ code: 'POST_CUSTOM_LIFECYCLE_INVALID', eventId: stop?.id }]
      });
    }
  );

  it.each(['wire-separate', 'wire-thread'] as const)('requires the %s action at each operation transition', async (skipped) => {
    const fixture = runtimeFixture();
    const document = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { type: 'line', layer: 'CUT', start: { x: 20, y: 0 }, end: { x: 30, y: 0 } }
    ]);
    document.setup = {
      initialWirePosition: { kind: 'manual', point: { x: 0, y: 0 }, review: 'reviewed' },
      threadingDefault: { mode: 'manual', wireSeparation: 'manual-before-positioning' }
    };
    const compiled = compileWireEdmExecutionPlan(document);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    fixture.plan = compiled.plan;
    fixture.package.manifest.capabilities.operations = 'multiple';
    fixture.package.manifest.capabilities.threading = 'manual';
    fixture.package.manifest.capabilities.wireSeparation = true;
    for (const [id, effect] of [['wire-separate', 'wire.separated'], ['wire-thread', 'wire.threaded']]) {
      fixture.package.dialect.commands[id] = {
        template: 'M00', parameters: {}, effects: [effect], requires: [], evidenceRefs: ['robofil-program']
      };
    }
    fixture.package.source.code = fixture.package.source.code.replace(
      "if (event.kind === 'program-start')",
      `if (event.kind === 'wire-separate' || event.kind === 'wire-thread') {
        if (event.kind === '${skipped}') return api.consume('Skip wire action.');
        return api.emitCommand(event.kind, {});
      }
      if (event.kind === 'program-start')`
    );

    await expect(runCustomPost(fixture)).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: 'POST_CUSTOM_LIFECYCLE_INVALID', eventId: fixture.plan.events.find(({ kind }) => kind === skipped)?.id }]
    });
  });

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

  it('renders numeric parameters with the declared deterministic controller format', async () => {
    const fixture = runtimeFixture();
    const command = fixture.package.dialect.commands['motion.linear'];
    for (const parameter of Object.values(command.parameters)) {
      if (parameter.type !== 'number') continue;
      parameter.format.decimalSeparator = ',';
      parameter.format.trimTrailingZeros = false;
      parameter.format.negativeZero = 'zero';
    }
    fixture.plan = {
      ...fixture.plan,
      events: fixture.plan.events.map((event) => event.kind === 'position'
        ? { ...event, to: { ...event.to, x: -0.0004 } }
        : event)
    };
    const result = await runCustomPost(fixture);

    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.program.text).toBe('G90\nG1 X0,000 Y0,000\nG1 X10,000 Y0,000\nM02');
    expect(result.program.blocks[1].motion?.end.x).toBe(0);
  });

  it('rejects controller precision that rounds away the requested cut', async () => {
    const fixture = runtimeFixture();
    fixture.properties.coordinatePrecision = 0;
    fixture.plan = {
      ...fixture.plan,
      events: fixture.plan.events.map((event) => event.kind === 'motion'
        ? { ...event, end: { x: 0.1, y: 0 } }
        : event)
    };

    await expect(runCustomPost(fixture)).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: 'POST_CUSTOM_AUDIT_FAILED' }]
    });
  });

  it('starts each motion at the previous formatted endpoint across events', async () => {
    const fixture = runtimeFixture();
    fixture.plan = {
      ...fixture.plan,
      events: fixture.plan.events.map((event) => {
        if (event.kind === 'position') return { ...event, to: { x: 0.0004, y: 0 } };
        if (event.kind === 'motion') return { ...event, start: { x: 0.0004, y: 0 } };
        return event;
      })
    };

    const result = await runCustomPost(fixture);

    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.program.blocks[2].motion?.start).toEqual({ x: 0, y: 0 });
  });

  it.each([
    { name: 'correct direction', reverseCommand: false, splitAtStop: false },
    { name: 'reversed direction', reverseCommand: true, splitAtStop: false },
    { name: 'missing legacy direction', reverseCommand: false, splitAtStop: false },
    { name: 'a stop leaving a short final arc', reverseCommand: false, splitAtStop: true }
  ])('audits circular centers and $name', async ({ name, reverseCommand, splitAtStop }) => {
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
    if (splitAtStop) {
      document.plan.operations[0].programStops = [{
        id: 'retain-part', enabled: true, reason: 'part-retention',
        placement: { kind: 'before-operation-end', remainingCutLengthMm: 0.0005 }
      }];
      fixture.properties.coordinatePrecision = 6;
      fixture.package.manifest.capabilities.programStops = true;
      fixture.package.dialect.commands['operator.stop'] = {
        template: 'M00', parameters: {}, effects: ['program.paused'],
        requires: [], evidenceRefs: ['robofil-program']
      };
    }
    const compiled = compileWireEdmExecutionPlan(document);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    fixture.plan = compiled.plan;
    fixture.package.manifest.capabilities.circularInterpolation = 'both';
    for (const id of ['motion.arc-clockwise', 'motion.arc-counterclockwise']) {
      fixture.package.dialect.commands[id] = {
        template: `${id === 'motion.arc-clockwise' ? 'G2' : 'G3'} X{x} Y{y} I{i} J{j}`,
        arcDirection: id === 'motion.arc-clockwise' ? 'clockwise' : 'counterclockwise',
        parameters: {
          x: { type: 'number', role: 'motion.end-x', description: 'X endpoint.', format: numberFormat() },
          y: { type: 'number', role: 'motion.end-y', description: 'Y endpoint.', format: numberFormat() },
          i: {
            type: 'number',
            role: 'motion.center-x',
            centerReference: { kind: 'fixed', mode: 'incremental' },
            description: 'Incremental X center.',
            format: numberFormat()
          },
          j: {
            type: 'number',
            role: 'motion.center-y',
            centerReference: { kind: 'fixed', mode: 'incremental' },
            description: 'Incremental Y center.',
            format: numberFormat()
          }
        },
        effects: ['position.changed'],
        requires: ['distance.absolute'],
        evidenceRefs: ['robofil-program']
      };
      if (name === 'missing legacy direction') delete fixture.package.dialect.commands[id].arcDirection;
      fixture.package.evidence[0].supports.push({ kind: 'command', id });
    }
    fixture.package.source.code = `
      export function createPost(api) {
        return { onEvent(event) {
          if (event.kind === 'program-start') return api.emitCommand('distance.absolute', {});
          if (event.kind === 'program-stop') return api.emitCommand('operator.stop', {});
          if (event.kind === 'motion') {
            const command = ${reverseCommand ? '!event.clockwise' : 'event.clockwise'} ? 'motion.arc-clockwise' : 'motion.arc-counterclockwise';
            if (event.fullCircle) {
              api.emitMotion(command, {
                x: 2 * event.center.x - event.start.x,
                y: 2 * event.center.y - event.start.y,
                i: event.center.x - event.start.x,
                j: event.center.y - event.start.y
              });
            }
            return api.emitMotion(command, {
              x: event.end.x,
              y: event.end.y,
              i: event.center.x - (event.fullCircle ? 2 * event.center.x - event.start.x : event.start.x),
              j: event.center.y - (event.fullCircle ? 2 * event.center.y - event.start.y : event.start.y)
            });
          }
          if (event.kind === 'program-end') return api.emitCommand('program.end', {});
          api.consume('No controller block required.');
        } };
      }
    `;

    const result = await runCustomPost(fixture);

    if (name === 'missing legacy direction') {
      expect(result).toMatchObject({
        ok: false,
        diagnostics: [{ code: 'POST_CUSTOM_MOTION_ROLE_INVALID', message: expect.stringContaining('no arcDirection') }]
      });
      return;
    }
    if (reverseCommand) {
      expect(result).toMatchObject({
        ok: false,
        diagnostics: [{ code: 'POST_CUSTOM_AUDIT_FAILED' }]
      });
      return;
    }
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const motions = result.program.blocks.filter(({ motion }) => motion?.motion === 'circular');
    expect(motions).toHaveLength(2);
    expect(motions[0]).toMatchObject({
      text: expect.stringMatching(/ I-2 J0$/),
      motion: { center: { x: 5, y: 5 } }
    });
    expect(motions[1]?.motion?.start).toEqual(motions[0]?.motion?.end);
    if (splitAtStop) {
      expect(result.program.lines).toContain('M00');
      expect(motions.every(({ motion }) => motion?.fullCircle === false)).toBe(true);
      expect(motions[1]?.motion?.start.y).toBeCloseTo(4.9995, 6);
    }
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

  it('rejects untraced movement emitted as an ordinary lifecycle command', async () => {
    const fixture = runtimeFixture();
    fixture.package.source.code = fixture.package.source.code.replace(
      "if (event.kind === 'program-end') return api.emitCommand('program.end', {});",
      "if (event.kind === 'program-end') { api.emitCommand('motion.linear', { x: 1000, y: 1000 }); return api.emitCommand('program.end', {}); }"
    );

    await expect(runCustomPost(fixture)).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: 'POST_CUSTOM_MOTION_ROLE_INVALID', commandId: 'motion.linear' }]
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
      fixtures: [
        { fixtureId: 'runtime-plan' },
        { fixtureId: 'runtime-precision-minimum' },
        { fixtureId: 'runtime-precision-maximum' }
      ]
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

    const artifactMismatch = runtimeFixture();
    artifactMismatch.package.manifest.output.programEnvelope.prefix = ['%'];
    await expect(runCustomPostConformance({
      packageValue: artifactMismatch.package,
      planFixtures: { 'core.test-plan.v1': artifactMismatch.plan }
    })).resolves.toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'POST_CONFORMANCE_EXPECTED_ARTIFACT_MISMATCH' })
      ])
    });
  });

  it('rejects incomplete fixture coverage and an unfinished final lifecycle', async () => {
    const uncovered = runtimeFixture();
    uncovered.package.manifest.capabilities.programStops = true;
    uncovered.package.dialect.commands['program.alternate-end'] = {
      template: 'M30',
      parameters: {},
      effects: ['program.ended'],
      requires: [],
      evidenceRefs: ['robofil-program']
    };
    uncovered.package.evidence[0].supports.push({ kind: 'command', id: 'program.alternate-end' });
    uncovered.package.fixtures = uncovered.package.fixtures.filter(({ id }) => id !== 'runtime-precision-maximum');
    const coverage = await runCustomPostConformance({
      packageValue: uncovered.package,
      planFixtures: { 'core.test-plan.v1': uncovered.plan }
    });
    expect(coverage).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'POST_CONFORMANCE_COMMAND_NOT_COVERED' }),
        expect.objectContaining({ code: 'POST_CONFORMANCE_CAPABILITY_NOT_COVERED' }),
        expect.objectContaining({ code: 'POST_CONFORMANCE_PROPERTY_BOUNDARY_NOT_COVERED' })
      ])
    });

    const unfinished = runtimeFixture();
    unfinished.package.source.code = unfinished.package.source.code.replace(
      "if (event.kind === 'program-end') return api.emitCommand('program.end', {});",
      "if (event.kind === 'program-end') return api.consume('No explicit program end.');"
    );
    expect(await runCustomPost(unfinished)).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'POST_CUSTOM_LIFECYCLE_INVALID' })]
    });

    const terminatedEarly = runtimeFixture();
    terminatedEarly.package.dialect.commands['program.end'].effects = [
      'program.ended',
      'distance.absolute'
    ];
    terminatedEarly.package.source.code = terminatedEarly.package.source.code
      .replace(
        "if (event.kind === 'program-start') return api.emitCommand('distance.absolute', {});",
        "if (event.kind === 'program-start') return api.emitCommand('program.end', {});"
      )
      .replace(
        "if (event.kind === 'program-end') return api.emitCommand('program.end', {});",
        "if (event.kind === 'program-end') return api.consume('Program was ended early.');"
      );
    expect(await runCustomPost(terminatedEarly)).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'POST_CUSTOM_LIFECYCLE_INVALID' })]
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
  packageValue.manifest.capabilities.circularInterpolation = 'none';
  packageValue.manifest.capabilities.controllerCompensation = 'none';
  packageValue.manifest.capabilities.threading = 'none';
  packageValue.manifest.execution.compensationLifecycle = 'none';
  packageValue.manifest.execution.compensationRequiredForEveryOperation = false;
  packageValue.dialect.commands['motion.linear'] = {
    template: 'G1 X{x} Y{y}',
    parameters: {
      x: { type: 'number', role: 'motion.end-x', description: 'X endpoint.', format: numberFormat() },
      y: { type: 'number', role: 'motion.end-y', description: 'Y endpoint.', format: numberFormat() }
    },
    effects: ['position.changed'],
    requires: ['distance.absolute'],
    evidenceRefs: ['robofil-program']
  };
  packageValue.source.code = `
    export function createPost(api) {
      api.getProperty('coordinatePrecision');
      return ${handlerSource()};
    }
  `;
  packageValue.fixtures = [
    {
      id: 'runtime-plan',
      description: 'Exact runtime plan fixture.',
      planFixture: 'core.test-plan.v1',
      properties: { coordinatePrecision: 3 },
      expectedProgram: 'G90\nG1 X0 Y0\nG1 X10 Y0\nM02',
      expectedArtifact: 'G90\r\nG1 X0 Y0\r\nG1 X10 Y0\r\nM02\r\n',
      evidenceRefs: ['robofil-program']
    },
    {
      id: 'runtime-precision-minimum',
      description: 'Minimum coordinate precision fixture.',
      planFixture: 'core.test-plan.v1',
      properties: { coordinatePrecision: 0 },
      expectedProgram: 'G90\nG1 X0 Y0\nG1 X10 Y0\nM02',
      expectedArtifact: 'G90\r\nG1 X0 Y0\r\nG1 X10 Y0\r\nM02\r\n',
      evidenceRefs: ['robofil-program']
    },
    {
      id: 'runtime-precision-maximum',
      description: 'Maximum coordinate precision fixture.',
      planFixture: 'core.test-plan.v1',
      properties: { coordinatePrecision: 6 },
      expectedProgram: 'G90\nG1 X0 Y0\nG1 X10 Y0\nM02',
      expectedArtifact: 'G90\r\nG1 X0 Y0\r\nG1 X10 Y0\r\nM02\r\n',
      evidenceRefs: ['robofil-program']
    }
  ];
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

function numberFormat() {
  return {
    style: 'fixed' as const,
    fractionDigits: { kind: 'property' as const, property: 'coordinatePrecision' },
    decimalSeparator: '.' as const,
    trimTrailingZeros: true,
    negativeZero: 'zero' as const
  };
}
