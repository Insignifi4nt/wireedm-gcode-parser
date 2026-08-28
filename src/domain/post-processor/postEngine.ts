import type { WireEdmExecutionPlan } from '@/domain/execution-plan/executionPlan';

import {
  runCustomPost,
  type CustomPostDiagnostic
} from './custom-runtime/customPostRuntime';
import type { ControllerProgram } from './controllerProgram';
import type { PostInstallation } from './postLibrary';
import type { PostPropertyValue } from './postProperties';

export type PostEngineDiagnostic = CustomPostDiagnostic;

export type ControllerProgramResult =
  | { readonly ok: true; readonly program: ControllerProgram }
  | { readonly ok: false; readonly diagnostics: readonly PostEngineDiagnostic[] };

export interface RunPostInput {
  readonly installation: PostInstallation;
  readonly properties: Readonly<Record<string, PostPropertyValue>>;
}

/**
 * Executes every installed post package through the same isolated public runtime.
 * Controller policy belongs exclusively to the installed package snapshot.
 */
export function runPost(
  plan: WireEdmExecutionPlan,
  input: RunPostInput
): Promise<ControllerProgramResult> {
  return runCustomPost({
    package: input.installation.package,
    plan,
    properties: input.properties
  });
}
