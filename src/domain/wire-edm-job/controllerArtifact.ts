import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import type { ControllerProgram } from '@/domain/post-processor/controllerProgram';
import {
  runBuiltInPost,
  type PostEngineDiagnostic
} from '@/domain/post-processor/postEngine';
import type { PostInstallationRef } from '@/domain/post-processor/postLibrary';

import {
  WIRE_EDM_ENGINE_VERSION,
  isValidatedSavedWireEdmJobRevision,
  type SavedRevisionHashes,
  type SavedWireEdmJobRevision
} from './savedWireEdmJobRevision';

export const CONTROLLER_PROGRAM_ARTIFACT_SCHEMA_VERSION = 1 as const;

const strictObject = { additionalProperties: false } as const;
const ConfiguredControllerArtifactPreferenceSchema = Type.Object({
  status: Type.Literal('configured'),
  fileExtension: Type.Union([
    Type.Object({
      kind: Type.Literal('standard'),
      extension: Type.Union([
        Type.Literal('iso'),
        Type.Literal('nc'),
        Type.Literal('gcode')
      ])
    }, strictObject),
    Type.Object({
      kind: Type.Literal('custom'),
      extension: Type.String({ minLength: 1, maxLength: 16, pattern: '^[A-Za-z0-9]+$' })
    }, strictObject)
  ]),
  lineEnding: Type.Union([Type.Literal('lf'), Type.Literal('crlf')])
}, strictObject);

export type ConfiguredControllerArtifactPreference =
  | {
      readonly status: 'configured';
      readonly fileExtension: {
        readonly kind: 'standard';
        readonly extension: 'iso' | 'nc' | 'gcode';
      };
      readonly lineEnding: 'lf' | 'crlf';
    }
  | {
      readonly status: 'configured';
      readonly fileExtension: {
        readonly kind: 'custom';
        readonly extension: string;
      };
      readonly lineEnding: 'lf' | 'crlf';
    };

export interface ControllerProgramArtifact {
  readonly format: 'wire-edm-controller-artifact';
  readonly schemaVersion: typeof CONTROLLER_PROGRAM_ARTIFACT_SCHEMA_VERSION;
  readonly engineVersion: typeof WIRE_EDM_ENGINE_VERSION;
  readonly revisionId: string;
  readonly revisionHashes: SavedRevisionHashes;
  readonly fileName: string;
  readonly preference: Omit<ConfiguredControllerArtifactPreference, 'status'>;
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
  | {
      readonly code: 'CONTROLLER_ARTIFACT_PREFERENCE_INVALID';
      readonly message: string;
      readonly path: string;
    }
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
      readonly code: 'CONTROLLER_ARTIFACT_HASH_UNAVAILABLE';
      readonly message: string;
    };

export type ControllerArtifactResult =
  | { readonly ok: true; readonly artifact: ControllerProgramArtifact }
  | { readonly ok: false; readonly error: ControllerArtifactError };

export async function generateControllerArtifact(
  revision: SavedWireEdmJobRevision,
  preference: ConfiguredControllerArtifactPreference
): Promise<ControllerArtifactResult> {
  if (!isValidatedSavedWireEdmJobRevision(revision)) {
    return artifactFailure({
      code: 'CONTROLLER_ARTIFACT_REVISION_UNVALIDATED',
      message: 'Controller artifacts require a saved revision returned by the revision creator or parser.'
    });
  }
  const preferenceError = Value.Errors(
    ConfiguredControllerArtifactPreferenceSchema,
    preference
  ).First();
  if (preferenceError) {
    return artifactFailure({
      code: 'CONTROLLER_ARTIFACT_PREFERENCE_INVALID',
      message: `Controller artifact preference is invalid at ${preferenceError.path || '/'}: ${preferenceError.message}.`,
      path: preferenceError.path
    });
  }

  const posted = runBuiltInPost(revision.executionPlan, {
    installation: revision.post.installation,
    properties: revision.post.properties
  });
  if (!posted.ok) {
    const notRunnable = posted.diagnostics.find(
      ({ code }) => code === 'POST_BUILTIN_NOT_RUNNABLE'
    );
    if (notRunnable) {
      return artifactFailure({
        code: 'CONTROLLER_ARTIFACT_POST_NOT_RUNNABLE',
        message: notRunnable.message,
        post: structuredClone(revision.post.installation.ref)
      });
    }
    return artifactFailure({
      code: 'CONTROLLER_ARTIFACT_POST_FAILED',
      message: 'The exact saved post could not generate an audited controller program.',
      diagnostics: posted.diagnostics
    });
  }

  const separator = preference.lineEnding === 'crlf' ? '\r\n' : '\n';
  const text = posted.program.text.replace(/\r\n|\r|\n/g, separator);
  const hash = await sha256(text);
  if (!hash) {
    return artifactFailure({
      code: 'CONTROLLER_ARTIFACT_HASH_UNAVAILABLE',
      message: 'SHA-256 is unavailable; the controller artifact cannot be identified exactly.'
    });
  }
  const extension = preference.fileExtension.extension;
  return {
    ok: true,
    artifact: deepFreeze({
      format: 'wire-edm-controller-artifact',
      schemaVersion: CONTROLLER_PROGRAM_ARTIFACT_SCHEMA_VERSION,
      engineVersion: WIRE_EDM_ENGINE_VERSION,
      revisionId: revision.revisionId,
      revisionHashes: structuredClone(revision.hashes),
      fileName: `${revision.project.id}.${extension}`,
      preference: {
        fileExtension: structuredClone(preference.fileExtension),
        lineEnding: preference.lineEnding
      },
      post: structuredClone(revision.post.installation.ref),
      program: structuredClone(posted.program),
      text,
      sha256: hash
    })
  };
}

async function sha256(value: string) {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
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
