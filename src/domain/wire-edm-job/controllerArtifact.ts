import type { ControllerProgram } from '@/domain/post-processor/controllerProgram';
import { serializeControllerOutput } from '@/domain/post-processor/controllerOutput';
import {
  runPost,
  type PostEngineDiagnostic
} from '@/domain/post-processor/postEngine';
import type { PostInstallationRef } from '@/domain/post-processor/postLibrary';
import type { WireEdmPostPackage } from '@/domain/post-processor/postPackageSchema';
import { compileWireEdmExecutionPlan, type ExecutionPlanDiagnostic } from '@/domain/execution-plan/executionPlan';
import { canonicalJson } from '@/domain/post-processor/canonicalJson';

import {
  isValidatedSavedWireEdmJobRevision,
  type SavedRevisionHashes,
  type SavedWireEdmJobRevision
} from './savedWireEdmJobRevision';

export const CONTROLLER_PROGRAM_ARTIFACT_SCHEMA_VERSION = 1 as const;

export interface ControllerProgramArtifact {
  readonly format: 'wire-edm-controller-artifact';
  readonly schemaVersion: typeof CONTROLLER_PROGRAM_ARTIFACT_SCHEMA_VERSION;
  readonly engineVersion: SavedWireEdmJobRevision['engineVersion'];
  readonly revisionId: string;
  readonly revisionHashes: SavedRevisionHashes;
  readonly fileName: string;
  readonly output: WireEdmPostPackage['manifest']['output'];
  readonly post: PostInstallationRef;
  readonly program: ControllerProgram;
  readonly text: string;
  readonly sha256: string;
}

export type ControllerArtifactError =
  | {
      readonly code: 'CONTROLLER_ARTIFACT_REVISION_UNVALIDATED';
      readonly message: string;
    }
  | { readonly code: 'CONTROLLER_ARTIFACT_ENCODING_INVALID'; readonly message: string }
  | { readonly code: 'CONTROLLER_ARTIFACT_NUMBERING_OVERFLOW'; readonly message: string }
  | {
      readonly code: 'CONTROLLER_ARTIFACT_POST_NOT_RUNNABLE';
      readonly message: string;
      readonly post: PostInstallationRef;
    }
  | {
      readonly code: 'CONTROLLER_ARTIFACT_POST_FAILED';
      readonly message: string;
      readonly diagnostics: readonly PostEngineDiagnostic[];
    }
  | {
      readonly code: 'CONTROLLER_ARTIFACT_EXECUTION_PLAN_INVALID';
      readonly message: string;
      readonly diagnostics: readonly ExecutionPlanDiagnostic[];
    }
  | {
      readonly code: 'CONTROLLER_ARTIFACT_HASH_UNAVAILABLE';
      readonly message: string;
    };

export type ControllerArtifactResult =
  | { readonly ok: true; readonly artifact: ControllerProgramArtifact }
  | { readonly ok: false; readonly error: ControllerArtifactError };

export async function generateControllerArtifact(
  revision: SavedWireEdmJobRevision
): Promise<ControllerArtifactResult> {
  if (!isValidatedSavedWireEdmJobRevision(revision)) {
    return artifactFailure({
      code: 'CONTROLLER_ARTIFACT_REVISION_UNVALIDATED',
      message: 'Controller artifacts require a saved revision returned by the revision creator or parser.'
    });
  }
  if (revision.engineVersion === '1') {
    const current = compileWireEdmExecutionPlan(revision.project.content.document);
    if (!current.ok) return artifactFailure({
      code: 'CONTROLLER_ARTIFACT_EXECUTION_PLAN_INVALID',
      message: 'This legacy revision is readable, but its manufacturing intent needs current review before generation.',
      diagnostics: current.diagnostics
    });
    if (canonicalJson(current.plan) !== canonicalJson(revision.executionPlan)) return artifactFailure({
      code: 'CONTROLLER_ARTIFACT_EXECUTION_PLAN_INVALID',
      message: 'This legacy execution plan differs from the current compiler and requires a new saved revision.',
      diagnostics: []
    });
  }
  const posted = await runPost(revision.executionPlan, {
    installation: revision.post.installation,
    properties: revision.post.properties
  });
  if (!posted.ok) {
    return artifactFailure({
      code: 'CONTROLLER_ARTIFACT_POST_FAILED',
      message: 'The exact saved post could not generate an audited controller program.',
      diagnostics: posted.diagnostics
    });
  }

  const output = revision.post.installation.package.manifest.output;
  const serialized = serializeControllerOutput(posted.program, output);
  if (!serialized.ok) {
    return artifactFailure(serialized.error.code === 'POST_OUTPUT_ENCODING_INVALID'
      ? { code: 'CONTROLLER_ARTIFACT_ENCODING_INVALID', message: serialized.error.message }
      : { code: 'CONTROLLER_ARTIFACT_NUMBERING_OVERFLOW', message: serialized.error.message });
  }
  const { bytes, text } = serialized;
  const hash = await sha256(bytes);
  if (!hash) {
    return artifactFailure({
      code: 'CONTROLLER_ARTIFACT_HASH_UNAVAILABLE',
      message: 'SHA-256 is unavailable; the controller artifact cannot be identified exactly.'
    });
  }
  const extension = output.fileExtension;
  return {
    ok: true,
    artifact: deepFreeze({
      format: 'wire-edm-controller-artifact',
      schemaVersion: CONTROLLER_PROGRAM_ARTIFACT_SCHEMA_VERSION,
      engineVersion: revision.engineVersion,
      revisionId: revision.revisionId,
      revisionHashes: structuredClone(revision.hashes),
      fileName: `${revision.project.id}.${extension}`,
      output: structuredClone(output),
      post: structuredClone(revision.post.installation.ref),
      program: structuredClone(posted.program),
      text,
      sha256: hash
    })
  };
}

async function sha256(value: Uint8Array) {
  if (!globalThis.crypto?.subtle) return null;
  const copied = new Uint8Array(value.byteLength);
  copied.set(value);
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    copied.buffer
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function artifactFailure(error: ControllerArtifactError): ControllerArtifactResult {
  return { ok: false, error };
}

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach((entry) => deepFreeze(entry));
  }
  return value;
}
