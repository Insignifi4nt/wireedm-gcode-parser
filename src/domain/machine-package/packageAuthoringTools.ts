import { Value } from '@sinclair/typebox/value';
import { APP_VERSION } from '@/domain/release/appRelease';
import { parsePortableUpid } from '@/domain/upid/portableUpidProject';
import { validateUpidDocument } from '@/domain/upid/validateUpidDocument';
import { parseWireEdmPostPackage } from '@/domain/post-processor/postPackage';
import { hashPostPackage } from '@/domain/post-processor/postLibrary';
import { runCustomPostConformance } from '@/domain/post-processor/custom-runtime/customPostConformance';
import { CANONICAL_POST_PLAN_FIXTURES } from '@/domain/post-processor/custom-runtime/canonicalPostConformanceFixtures';
import {
  buildMachinePackageArchive, parseMachinePackageArchive, readMachinePackageArchiveContents, MachinePackageDocumentSchema,
  MAX_MACHINE_PACKAGE_ARCHIVE_BYTES, MAX_MACHINE_PACKAGE_EXPANDED_BYTES, MAX_MACHINE_PACKAGE_ENTRIES,
  type MachinePackage
} from './machinePackage';

export interface AuthoringFile { readonly path: string; readonly bytes: Uint8Array }
/** Browser and future tool adapters call the same storage-free operations. */
export type PackageAuthoringRequest =
  | { readonly operation: 'validate-upid'; readonly text: string }
  | { readonly operation: 'check-post'; readonly text: string }
  | { readonly operation: 'build-package'; readonly text: string; readonly files: readonly AuthoringFile[] }
  | { readonly operation: 'inspect-package'; readonly bytes: Uint8Array };

export interface PackageAuthoringResult {
  readonly report: {
    readonly ok: boolean;
    readonly operation: PackageAuthoringRequest['operation'];
    readonly appVersion: string;
    readonly details: unknown;
  };
  readonly output?: {
    readonly fileName?: string;
    readonly archive?: Uint8Array;
    readonly documentText: string;
    readonly files: readonly AuthoringFile[];
  };
}

export async function runPackageAuthoringTool(request: PackageAuthoringRequest): Promise<PackageAuthoringResult> {
  const result = (ok: boolean, details: unknown, output?: PackageAuthoringResult['output']): PackageAuthoringResult => ({
    report: { ok, operation: request.operation, appVersion: APP_VERSION, details }, ...(output ? { output } : {})
  });
  const fail = (code: string, message: string) => result(false, { diagnostics: [{ code, message }] });
  try {
    if (request.operation === 'validate-upid') {
      if (new TextEncoder().encode(request.text).byteLength > 512 * 1024) return fail('INPUT_TOO_LARGE', 'Inline UPID is limited to 512 KiB. Use the normal file import for larger documents.');
      const parsed = parsePortableUpid(request.text);
      if (!parsed.ok) return result(false, { diagnostics: [parsed.error] });
      const report = validateUpidDocument(parsed.document);
      return result(report.valid, { structurallyValid: report.structurallyValid, planningValid: report.valid,
        diagnostics: report.diagnostics.slice(0, 30), omittedDiagnosticCount: Math.max(0, report.diagnostics.length - 30),
        verification: 'UPID structure and planning only; no machine fit, post execution or controller verification.' });
    }
    if (request.operation === 'check-post') {
      const parsed = parseWireEdmPostPackage(request.text);
      if (!parsed.ok) return result(false, { diagnostics: parsed.diagnostics });
      const contentHash = await hashPostPackage(parsed.package);
      if (!contentHash) return fail('AUTHORING_HASH_UNAVAILABLE', 'SHA-256 is unavailable in this browser.');
      const conformance = await runCustomPostConformance({ packageValue: parsed.package, planFixtures: CANONICAL_POST_PLAN_FIXTURES });
      return result(conformance.ok, {
        post: { packageId: parsed.package.manifest.id, version: parsed.package.manifest.version, contentHash },
        conformance
      });
    }
    if (request.operation === 'inspect-package') {
      if (request.bytes.byteLength > MAX_MACHINE_PACKAGE_ARCHIVE_BYTES) return fail('AUTHORING_INPUT_TOO_LARGE', 'Package exceeds the 32 MiB archive limit.');
      const parsed = await parseMachinePackageArchive(request.bytes);
      if (parsed.ok) return result(true, packageSummary(parsed.package), packageOutput(parsed.package));
      const repair = readMachinePackageArchiveContents(request.bytes);
      return result(false, { diagnostics: parsed.diagnostics, editableContents: repair.ok ? 'Unvalidated; repair and rebuild before installation.' : 'Unavailable: archive could not be decoded safely.' }, repair.ok ? {
        documentText: JSON.stringify(repair.document, null, 2),
        files: Object.entries(repair.files).map(([path, bytes]) => ({ path, bytes }))
      } : undefined);
    }
    if (request.files.length + 1 > MAX_MACHINE_PACKAGE_ENTRIES) return fail('AUTHORING_TOO_MANY_FILES', 'Too many evidence files.');
    const total = new TextEncoder().encode(request.text).byteLength + request.files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
    if (total > MAX_MACHINE_PACKAGE_EXPANDED_BYTES) return fail('AUTHORING_INPUT_TOO_LARGE', 'Document and evidence exceed the 64 MiB expanded limit.');
    let unknownDocument: unknown;
    try { unknownDocument = JSON.parse(request.text); }
    catch { return fail('AUTHORING_JSON_INVALID', 'Package document must be valid JSON.'); }
    const schemaError = Value.Errors(MachinePackageDocumentSchema, unknownDocument).First();
    if (schemaError) return fail('MACHINE_PACKAGE_SCHEMA_INVALID', `At ${schemaError.path || '/'}: ${schemaError.message}`);
    const paths = new Set<string>();
    for (const file of request.files) {
      if (paths.has(file.path)) return fail('MACHINE_PACKAGE_FILE_DUPLICATE', `Duplicate evidence path: ${file.path}`);
      paths.add(file.path);
    }
    const built = await buildMachinePackageArchive({
      document: Value.Decode(MachinePackageDocumentSchema, unknownDocument),
      files: Object.fromEntries(request.files.map((file) => [file.path, file.bytes]))
    });
    return built.ok ? result(true, packageSummary(built.package), {
      ...packageOutput(built.package), archive: built.archive,
      fileName: `${built.package.document.manifest.id}-${built.package.document.manifest.version}.wireedm-package`
    }) : result(false, { diagnostics: built.diagnostics });
  } catch (error) {
    return fail('AUTHORING_OPERATION_FAILED', error instanceof Error ? error.message : String(error));
  }
}

function packageOutput(value: MachinePackage) {
  return {
    documentText: JSON.stringify(value.document, null, 2),
    files: Object.entries(value.files).map(([path, bytes]) => ({ path, bytes }))
  };
}

function packageSummary(value: MachinePackage) {
  return {
    archiveHash: value.contentHash,
    manifest: value.document.manifest,
    machine: value.document.machine.identity,
    activeBindingId: value.document.activeBindingId,
    posts: value.postLibrary.installations.map(({ ref }) => ref),
    evidencePaths: Object.keys(value.files),
    verification: 'Software validation and conformance only; no physical-machine verification.'
  };
}
