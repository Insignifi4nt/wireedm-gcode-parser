import type { WireEdmExecutionPlan } from '@/domain/execution-plan/executionPlan';
import {
  validateWireEdmPostPackageValue,
  type PostPackageDiagnostic
} from '@/domain/post-processor/postPackage';
import type { WireEdmPostPackage } from '@/domain/post-processor/postPackageSchema';

import {
  runCustomPost,
  type CustomPostDiagnostic,
  type CustomPostRuntimeLimits
} from './customPostRuntime';

export const CUSTOM_POST_CONFORMANCE_DIAGNOSTIC_CODES = [
  'POST_CONFORMANCE_PACKAGE_INVALID',
  'POST_CONFORMANCE_PLAN_FIXTURE_NOT_FOUND',
  'POST_CONFORMANCE_RUNTIME_FAILED',
  'POST_CONFORMANCE_EXPECTED_PROGRAM_MISMATCH',
  'POST_CONFORMANCE_COMMAND_NOT_COVERED',
  'POST_CONFORMANCE_CAPABILITY_NOT_COVERED',
  'POST_CONFORMANCE_PROPERTY_BOUNDARY_NOT_COVERED'
] as const;

export type CustomPostConformanceDiagnosticCode =
  typeof CUSTOM_POST_CONFORMANCE_DIAGNOSTIC_CODES[number];

export type CustomPostConformanceDiagnostic =
  | {
      readonly code: 'POST_CONFORMANCE_PACKAGE_INVALID';
      readonly fixtureId: null;
      readonly message: string;
      readonly packageDiagnostic: PostPackageDiagnostic;
    }
  | {
      readonly code: 'POST_CONFORMANCE_PLAN_FIXTURE_NOT_FOUND';
      readonly fixtureId: string;
      readonly message: string;
    }
  | {
      readonly code: 'POST_CONFORMANCE_RUNTIME_FAILED';
      readonly fixtureId: string;
      readonly message: string;
      readonly runtimeDiagnostic: CustomPostDiagnostic;
    }
  | {
      readonly code: 'POST_CONFORMANCE_EXPECTED_PROGRAM_MISMATCH';
      readonly fixtureId: string;
      readonly message: string;
      readonly expectedProgram: string;
      readonly actualProgram: string;
    }
  | {
      readonly code:
        | 'POST_CONFORMANCE_COMMAND_NOT_COVERED'
        | 'POST_CONFORMANCE_CAPABILITY_NOT_COVERED'
        | 'POST_CONFORMANCE_PROPERTY_BOUNDARY_NOT_COVERED';
      readonly fixtureId: null;
      readonly message: string;
    };

export interface CustomPostConformanceFixtureSuccess {
  readonly fixtureId: string;
  readonly planFixture: string;
  readonly programText: string;
  readonly commandIds: readonly string[];
  readonly emittedEventIds: readonly string[];
}

export type CustomPostConformanceResult =
  | { readonly ok: true; readonly fixtures: readonly CustomPostConformanceFixtureSuccess[] }
  | { readonly ok: false; readonly diagnostics: readonly CustomPostConformanceDiagnostic[] };

export interface RunCustomPostConformanceInput {
  readonly packageValue: unknown;
  readonly planFixtures: Readonly<Record<string, WireEdmExecutionPlan>>;
  readonly limits?: Partial<CustomPostRuntimeLimits>;
}

export async function runCustomPostConformance(
  input: RunCustomPostConformanceInput
): Promise<CustomPostConformanceResult> {
  const parsed = validateWireEdmPostPackageValue(input.packageValue);
  if (!parsed.ok) {
    return {
      ok: false,
      diagnostics: parsed.diagnostics.map((packageDiagnostic) => ({
        code: 'POST_CONFORMANCE_PACKAGE_INVALID',
        fixtureId: null,
        message: packageDiagnostic.message,
        packageDiagnostic
      }))
    };
  }
  return runValidatedPackageConformance(parsed.package, input);
}

async function runValidatedPackageConformance(
  packageValue: WireEdmPostPackage,
  input: RunCustomPostConformanceInput
): Promise<CustomPostConformanceResult> {
  const fixtures: CustomPostConformanceFixtureSuccess[] = [];
  const diagnostics: CustomPostConformanceDiagnostic[] = [];
  for (const fixture of packageValue.fixtures) {
    const plan = input.planFixtures[fixture.planFixture];
    if (!plan) {
      diagnostics.push({
        code: 'POST_CONFORMANCE_PLAN_FIXTURE_NOT_FOUND',
        fixtureId: fixture.id,
        message: `Plan fixture ${fixture.planFixture} was not provided for ${fixture.id}.`
      });
      continue;
    }
    const run = await runCustomPost({
      package: packageValue,
      plan,
      properties: fixture.properties,
      limits: input.limits
    });
    if (!run.ok) {
      diagnostics.push(...run.diagnostics.map((runtimeDiagnostic) => ({
        code: 'POST_CONFORMANCE_RUNTIME_FAILED' as const,
        fixtureId: fixture.id,
        message: runtimeDiagnostic.message,
        runtimeDiagnostic
      })));
      continue;
    }
    if (run.program.text !== fixture.expectedProgram) {
      diagnostics.push({
        code: 'POST_CONFORMANCE_EXPECTED_PROGRAM_MISMATCH',
        fixtureId: fixture.id,
        message: `Fixture ${fixture.id} output differs from its exact expected program.`,
        expectedProgram: fixture.expectedProgram,
        actualProgram: run.program.text
      });
      continue;
    }
    fixtures.push({
      fixtureId: fixture.id,
      planFixture: fixture.planFixture,
      programText: run.program.text,
      commandIds: [...new Set(run.program.blocks.flatMap(({ commandIds }) => commandIds))],
      emittedEventIds: run.program.eventDispositions
        .filter(({ kind }) => kind === 'emitted')
        .map(({ eventId }) => eventId)
    });
  }
  if (diagnostics.length === 0) {
    diagnostics.push(...coverageDiagnostics(packageValue, input.planFixtures, fixtures));
  }
  return diagnostics.length > 0
    ? { ok: false, diagnostics }
    : { ok: true, fixtures };
}

function coverageDiagnostics(
  packageValue: WireEdmPostPackage,
  planFixtures: Readonly<Record<string, WireEdmExecutionPlan>>,
  successes: readonly CustomPostConformanceFixtureSuccess[]
): CustomPostConformanceDiagnostic[] {
  const diagnostics: CustomPostConformanceDiagnostic[] = [];
  const coveredCommandIds = new Set<string>();
  const coveredExecutions: {
    readonly plan: WireEdmExecutionPlan;
    readonly emittedEventIds: ReadonlySet<string>;
  }[] = [];
  for (const success of successes) {
    const plan = planFixtures[success.planFixture];
    if (plan) {
      coveredExecutions.push({ plan, emittedEventIds: new Set(success.emittedEventIds) });
    }
    for (const commandId of success.commandIds) coveredCommandIds.add(commandId);
  }
  for (const commandId of Object.keys(packageValue.dialect.commands)) {
    if (coveredCommandIds.has(commandId)) continue;
    diagnostics.push({
      code: 'POST_CONFORMANCE_COMMAND_NOT_COVERED',
      fixtureId: null,
      message: `Declared command ${commandId} is not exercised by any successful fixture.`
    });
  }
  for (const capability of missingCapabilityCoverage(packageValue, coveredExecutions)) {
    diagnostics.push({
      code: 'POST_CONFORMANCE_CAPABILITY_NOT_COVERED',
      fixtureId: null,
      message: `Declared capability ${capability} is not exercised by any successful fixture.`
    });
  }
  for (const boundary of missingPropertyBoundaryCoverage(packageValue)) {
    diagnostics.push({
      code: 'POST_CONFORMANCE_PROPERTY_BOUNDARY_NOT_COVERED',
      fixtureId: null,
      message: `Post property boundary ${boundary} is not exercised by any fixture.`
    });
  }
  return diagnostics;
}

function missingCapabilityCoverage(
  packageValue: WireEdmPostPackage,
  executions: readonly {
    readonly plan: WireEdmExecutionPlan;
    readonly emittedEventIds: ReadonlySet<string>;
  }[]
) {
  const missing: string[] = [];
  const { capabilities } = packageValue.manifest;
  const plans = executions.map(({ plan }) => plan);
  const emittedEvents = executions.flatMap(({ plan, emittedEventIds }) => plan.events.filter(({ id }) => emittedEventIds.has(id)));
  const arcDirections = new Set(plans.flatMap(({ requirements }) => requirements.circularInterpolation));
  if (capabilities.circularInterpolation === 'clockwise-only' && !arcDirections.has('clockwise')) missing.push('circularInterpolation:clockwise');
  if (capabilities.circularInterpolation === 'counterclockwise-only' && !arcDirections.has('counterclockwise')) missing.push('circularInterpolation:counterclockwise');
  if (capabilities.circularInterpolation === 'both') {
    if (!arcDirections.has('clockwise')) missing.push('circularInterpolation:clockwise');
    if (!arcDirections.has('counterclockwise')) missing.push('circularInterpolation:counterclockwise');
  }
  if (capabilities.controllerCompensation === 'left-right') {
    const sides = new Set(emittedEvents
      .filter((event) => event.kind === 'compensation-start')
      .map((event) => event.wireSide));
    if (!sides.has('left')) missing.push('controllerCompensation:left');
    if (!sides.has('right')) missing.push('controllerCompensation:right');
  }
  if (capabilities.operations === 'multiple' && !plans.some(({ requirements }) => requirements.operationCount > 1)) missing.push('operations:multiple');
  if (capabilities.passes === 'multiple' && !plans.some(({ events }) => events.filter((event) => event.kind === 'pass-start').length > 1)) missing.push('passes:multiple');
  if (capabilities.threading === 'manual' || capabilities.threading === 'manual-and-automatic') {
    if (!emittedEvents.some((event) => event.kind === 'wire-thread' && event.method === 'manual')) missing.push('threading:manual');
  }
  if (capabilities.threading === 'automatic' || capabilities.threading === 'manual-and-automatic') {
    if (!emittedEvents.some((event) => event.kind === 'wire-thread' && event.method === 'automatic')) missing.push('threading:automatic');
  }
  if (capabilities.wireSeparation && !emittedEvents.some((event) => event.kind === 'wire-separate')) missing.push('wireSeparation');
  if (capabilities.programStops && !emittedEvents.some((event) => event.kind === 'program-stop')) missing.push('programStops');
  if (capabilities.taperAxes) missing.push('taperAxes (engine API v1 has no taper fixture event)');
  if (capabilities.technologySelection) missing.push('technologySelection (engine API v1 has no technology fixture event)');
  if (!plans.some(({ events }) => events.some((event) => event.kind === 'program-start'))) missing.push('initialWirePosition');
  return missing;
}

function missingPropertyBoundaryCoverage(packageValue: WireEdmPostPackage) {
  const missing: string[] = [];
  for (const [name, definition] of Object.entries(packageValue.manifest.properties)) {
    const values = packageValue.fixtures.map(({ properties }) => properties[name]);
    if (definition.type === 'boolean') {
      if (!values.includes(false)) missing.push(`${name}:false`);
      if (!values.includes(true)) missing.push(`${name}:true`);
    } else if (definition.type === 'choice') {
      for (const choice of definition.choices) if (!values.includes(choice)) missing.push(`${name}:${choice}`);
    } else if (definition.type === 'integer' || definition.type === 'number') {
      if (definition.minimum !== undefined && !values.includes(definition.minimum)) missing.push(`${name}:minimum`);
      if (definition.maximum !== undefined && !values.includes(definition.maximum)) missing.push(`${name}:maximum`);
    }
  }
  return missing;
}
