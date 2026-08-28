import { canonicalJson } from './canonicalJson';
import { resolveBuiltInPostKey } from './builtInPostPackages';
import { CANONICAL_POST_PLAN_FIXTURES } from './custom-runtime/canonicalPostConformanceFixtures';
import {
  runCustomPostConformance,
  type CustomPostConformanceDiagnostic
} from './custom-runtime/customPostConformance';
import type { PostInstallationRef } from './postFormatPrimitives';
import type { WireEdmPostPackage } from './postPackageSchema';

export type { PostInstallationRef } from './postFormatPrimitives';

export interface PostInstallation {
  readonly ref: PostInstallationRef;
  readonly package: WireEdmPostPackage;
}

export interface PostLibrary {
  readonly schemaVersion: 1;
  readonly installations: readonly PostInstallation[];
}

export interface MachineBindingPostReference {
  readonly machineId: string;
  readonly bindingId: string;
  readonly post: PostInstallationRef;
}

export type InstallPostPackageResult =
  | {
      ok: true;
      kind: 'installed' | 'already-installed';
      library: PostLibrary;
      installation: PostInstallation;
    }
  | {
      ok: false;
      error:
        | {
            code: 'POST_LIBRARY_VERSION_CONFLICT';
            message: string;
            packageId: string;
            version: string;
            installedHash: string;
            importedHash: string;
          }
        | {
            code: 'POST_LIBRARY_HASH_UNAVAILABLE';
            message: string;
          }
        | {
            code: 'POST_LIBRARY_CONFORMANCE_FAILED';
            message: string;
            diagnostics: readonly CustomPostConformanceDiagnostic[];
          };
    };

export type ResolvePostInstallationResult =
  | { ok: true; installation: PostInstallation }
  | {
      ok: false;
      error: { code: 'POST_LIBRARY_INSTALLATION_NOT_FOUND'; message: string };
    };

export type RemovePostInstallationResult =
  | { ok: true; library: PostLibrary; removed: PostInstallation }
  | {
      ok: false;
      error:
        | { code: 'POST_LIBRARY_INSTALLATION_NOT_FOUND'; message: string }
        | {
            code: 'POST_LIBRARY_INSTALLATION_IN_USE';
            message: string;
            bindings: readonly { machineId: string; bindingId: string }[];
          };
    };

export function createEmptyPostLibrary(): PostLibrary {
  return Object.freeze({ schemaVersion: 1, installations: Object.freeze([]) });
}

export async function installPostPackage(
  library: PostLibrary,
  packageValue: WireEdmPostPackage
): Promise<InstallPostPackageResult> {
  const contentHash = await sha256(canonicalJson(packageValue));
  if (!contentHash) {
    return {
      ok: false,
      error: {
        code: 'POST_LIBRARY_HASH_UNAVAILABLE',
        message: 'SHA-256 is unavailable; the post package cannot be installed without content identity.'
      }
    };
  }

  const packageId = packageValue.manifest.id;
  const version = packageValue.manifest.version;
  const sameClaim = library.installations.find(({ ref }) => (
    ref.packageId === packageId && ref.version === version
  ));
  if (sameClaim) {
    if (sameClaim.ref.contentHash === contentHash) {
      return { ok: true, kind: 'already-installed', library, installation: sameClaim };
    }
    return {
      ok: false,
      error: {
        code: 'POST_LIBRARY_VERSION_CONFLICT',
        message: `${packageId}@${version} is already installed with different content. Publish a new version instead of overwriting it.`,
        packageId,
        version,
        installedHash: sameClaim.ref.contentHash,
        importedHash: contentHash
      }
    };
  }

  if (!resolveBuiltInPostKey(packageValue)) {
    const conformance = await runCustomPostConformance({
      packageValue,
      planFixtures: CANONICAL_POST_PLAN_FIXTURES
    });
    if (!conformance.ok) {
      return {
        ok: false,
        error: {
          code: 'POST_LIBRARY_CONFORMANCE_FAILED',
          message: `${packageId}@${version} failed custom post conformance and was not installed.`,
          diagnostics: conformance.diagnostics
        }
      };
    }
  }

  const installation = Object.freeze({
    ref: Object.freeze({ packageId, version, contentHash }),
    package: packageValue
  });
  const nextLibrary = Object.freeze({
    schemaVersion: 1 as const,
    installations: Object.freeze([...library.installations, installation])
  });
  return { ok: true, kind: 'installed', library: nextLibrary, installation };
}

export function resolvePostInstallation(
  library: PostLibrary,
  ref: PostInstallationRef
): ResolvePostInstallationResult {
  const installation = library.installations.find(({ ref: candidate }) => postInstallationRefsEqual(candidate, ref));
  return installation
    ? { ok: true, installation }
    : { ok: false, error: installationNotFound(ref) };
}

export function removePostInstallation(
  library: PostLibrary,
  ref: PostInstallationRef,
  bindings: readonly MachineBindingPostReference[]
): RemovePostInstallationResult {
  const resolved = resolvePostInstallation(library, ref);
  if (!resolved.ok) return resolved;

  const matchingBindings = bindings
    .filter(({ post }) => postInstallationRefsEqual(post, ref))
    .map(({ machineId, bindingId }) => ({ machineId, bindingId }));
  if (matchingBindings.length > 0) {
    const names = matchingBindings.map(({ machineId, bindingId }) => `${machineId}/${bindingId}`).join(', ');
    return {
      ok: false,
      error: {
        code: 'POST_LIBRARY_INSTALLATION_IN_USE',
        message: `Post installation is used by ${matchingBindings.length} machine binding${matchingBindings.length === 1 ? '' : 's'}: ${names}.`,
        bindings: matchingBindings
      }
    };
  }

  return {
    ok: true,
    library: Object.freeze({
      schemaVersion: 1,
      installations: Object.freeze(library.installations.filter(({ ref: candidate }) => !postInstallationRefsEqual(candidate, ref)))
    }),
    removed: resolved.installation
  };
}

export function postInstallationRefsEqual(left: PostInstallationRef, right: PostInstallationRef) {
  return (
    left.packageId === right.packageId &&
    left.version === right.version &&
    left.contentHash === right.contentHash
  );
}

function installationNotFound(ref: PostInstallationRef) {
  return {
    code: 'POST_LIBRARY_INSTALLATION_NOT_FOUND' as const,
    message: `Post installation not found: ${ref.packageId}@${ref.version} with hash ${ref.contentHash}.`
  };
}

async function sha256(value: string) {
  if (!globalThis.crypto?.subtle) return null;
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
