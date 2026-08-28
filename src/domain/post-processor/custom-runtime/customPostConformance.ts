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
    };

export interface CustomPostConformanceFixtureSuccess {
  readonly fixtureId: string;
  readonly planFixture: string;
  readonly programText: string;
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
      programText: run.program.text
    });
  }
  return diagnostics.length > 0
    ? { ok: false, diagnostics }
    : { ok: true, fixtures };
}
