import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

import {
  MachineDefinitionSchema,
  validateMachineDefinitionSemantics,
  validateMachinePostBindings,
  type MachineDefinition
} from '@/domain/machine-definition/machineDefinition';
import { canonicalJson } from '@/domain/post-processor/canonicalJson';
import {
  createEmptyPostLibrary,
  installPostPackage,
  postInstallationRefsEqual,
  type PostLibrary
} from '@/domain/post-processor/postLibrary';
import type { CustomPostConformanceDiagnostic } from '@/domain/post-processor/custom-runtime';
import {
  validateWireEdmPostPackageValue,
  type PostPackageDiagnostic
} from '@/domain/post-processor/postPackage';
import {
  PostIdentifierSchema,
  PostVersionSchema
} from '@/domain/post-processor/postFormatPrimitives';
import {
  WireEdmPostPackageSchema,
  type DeepReadonly,
  type WireEdmPostPackage
} from '@/domain/post-processor/postPackageSchema';

export const MACHINE_PACKAGE_ENTRY = 'wireedm-package.json';
export const MACHINE_PACKAGE_SCHEMA_VERSION = 1 as const;
export const MAX_MACHINE_PACKAGE_ARCHIVE_BYTES = 32 * 1024 * 1024;
export const MAX_MACHINE_PACKAGE_EXPANDED_BYTES = 64 * 1024 * 1024;
export const MAX_MACHINE_PACKAGE_ENTRIES = 2_048;

const strictObject = { additionalProperties: false } as const;

export const MachinePackageManifestSchema = Type.Object({
  id: PostIdentifierSchema,
  name: Type.String({ minLength: 1, maxLength: 160 }),
  version: PostVersionSchema,
  description: Type.String({ minLength: 1, maxLength: 4_096 })
}, strictObject);

export const MachinePackageSourceDocumentSchema = Type.Object({
  format: Type.Literal('wire-edm-machine-package-source'),
  schemaVersion: Type.Literal(MACHINE_PACKAGE_SCHEMA_VERSION),
  manifest: MachinePackageManifestSchema,
  machineFile: Type.String({ minLength: 1, maxLength: 1_024 }),
  postFiles: Type.Array(Type.String({ minLength: 1, maxLength: 1_024 }), { minItems: 1, maxItems: 64 }),
  activeBindingId: PostIdentifierSchema
}, {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://wire-edm.local/schemas/wire-edm-machine-package-source-v1.json',
  additionalProperties: false
});

export type MachinePackageSourceDocument = DeepReadonly<Static<typeof MachinePackageSourceDocumentSchema>>;

export const MachinePackageDocumentSchema = Type.Object({
  format: Type.Literal('wire-edm-machine-package'),
  schemaVersion: Type.Literal(MACHINE_PACKAGE_SCHEMA_VERSION),
  manifest: MachinePackageManifestSchema,
  machine: MachineDefinitionSchema,
  posts: Type.Array(WireEdmPostPackageSchema, { minItems: 1, maxItems: 64 }),
  activeBindingId: PostIdentifierSchema
}, {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://wire-edm.local/schemas/wire-edm-machine-package-v1.json',
  additionalProperties: false
});

type MutableMachinePackageDocumentValue = Static<typeof MachinePackageDocumentSchema>;
export type MachinePackageDocumentValue = DeepReadonly<MutableMachinePackageDocumentValue>;

export interface MachinePackageArchiveInput {
  readonly document: MachinePackageDocumentValue;
  readonly files: Readonly<Record<string, Uint8Array>>;
}

export interface MachinePackage {
  readonly document: MachinePackageDocumentValue;
  readonly files: Readonly<Record<string, Uint8Array>>;
  readonly postLibrary: PostLibrary;
  readonly contentHash: string;
}

export interface MachinePackageDiagnostic {
  readonly code:
    | 'MACHINE_PACKAGE_ARCHIVE_TOO_LARGE'
    | 'MACHINE_PACKAGE_ARCHIVE_INVALID'
    | 'MACHINE_PACKAGE_ENTRY_MISSING'
    | 'MACHINE_PACKAGE_ENTRY_DUPLICATE'
    | 'MACHINE_PACKAGE_FILE_DUPLICATE'
    | 'MACHINE_PACKAGE_ENTRY_COUNT_EXCEEDED'
    | 'MACHINE_PACKAGE_PATH_INVALID'
    | 'MACHINE_PACKAGE_EXPANDED_TOO_LARGE'
    | 'MACHINE_PACKAGE_JSON_INVALID'
    | 'MACHINE_PACKAGE_SCHEMA_INVALID'
    | 'MACHINE_PACKAGE_MACHINE_INVALID'
    | 'MACHINE_PACKAGE_POST_INVALID'
    | 'MACHINE_PACKAGE_POST_DUPLICATE'
    | 'MACHINE_PACKAGE_POST_INSTALL_FAILED'
    | 'MACHINE_PACKAGE_BINDING_INVALID'
    | 'MACHINE_PACKAGE_ACTIVE_BINDING_MISSING'
    | 'MACHINE_PACKAGE_ACTIVE_BINDING_CONFLICT'
    | 'MACHINE_PACKAGE_POST_UNBOUND'
    | 'MACHINE_PACKAGE_TARGET_MISMATCH'
    | 'MACHINE_PACKAGE_EVIDENCE_MISSING'
    | 'MACHINE_PACKAGE_EVIDENCE_HASH_MISMATCH'
    | 'MACHINE_PACKAGE_FILE_UNREFERENCED'
    | 'MACHINE_PACKAGE_HASH_UNAVAILABLE';
  readonly path: string;
  readonly message: string;
  readonly postDiagnostics?: readonly PostPackageDiagnostic[];
  readonly conformanceDiagnostics?: readonly CustomPostConformanceDiagnostic[];
}

export type BuildMachinePackageArchiveResult =
  | { readonly ok: true; readonly archive: Uint8Array; readonly package: MachinePackage }
  | { readonly ok: false; readonly diagnostics: readonly MachinePackageDiagnostic[] };

export type ParseMachinePackageArchiveResult =
  | { readonly ok: true; readonly package: MachinePackage }
  | { readonly ok: false; readonly diagnostics: readonly MachinePackageDiagnostic[] };

export async function buildMachinePackageArchive(
  input: MachinePackageArchiveInput
): Promise<BuildMachinePackageArchiveResult> {
  if (Object.hasOwn(input.files, MACHINE_PACKAGE_ENTRY)) {
    return failure(
      'MACHINE_PACKAGE_ENTRY_DUPLICATE',
      `/${MACHINE_PACKAGE_ENTRY}`,
      `${MACHINE_PACKAGE_ENTRY} is generated from the package document and cannot also appear in files.`
    );
  }
  const document = {
    ...input.document,
    machine: {
      ...input.document.machine,
      activeBindingId: input.document.activeBindingId
    }
  };
  const inputFileNames = Object.keys(input.files);
  if (inputFileNames.length + 1 > MAX_MACHINE_PACKAGE_ENTRIES) {
    return failure(
      'MACHINE_PACKAGE_ENTRY_COUNT_EXCEEDED',
      '',
      `Machine package contains ${inputFileNames.length + 1} entries; the maximum is ${MAX_MACHINE_PACKAGE_ENTRIES}.`
    );
  }
  let rawFileBytes = 0;
  for (const name of inputFileNames) {
    rawFileBytes += input.files[name].byteLength;
    if (rawFileBytes > MAX_MACHINE_PACKAGE_EXPANDED_BYTES) {
      return failure(
        'MACHINE_PACKAGE_EXPANDED_TOO_LARGE',
        '',
        `Expanded machine package exceeds ${MAX_MACHINE_PACKAGE_EXPANDED_BYTES} bytes.`
      );
    }
  }
  if (!jsonFitsUtf8Bytes(document, MAX_MACHINE_PACKAGE_EXPANDED_BYTES - rawFileBytes - 1)) {
    return failure(
      'MACHINE_PACKAGE_EXPANDED_TOO_LARGE',
      '',
      `Expanded machine package exceeds ${MAX_MACHINE_PACKAGE_EXPANDED_BYTES} bytes.`
    );
  }
  let normalizedDocument: MachinePackageDocumentValue;
  try {
    normalizedDocument = JSON.parse(JSON.stringify(document)) as MachinePackageDocumentValue;
  } catch (error) {
    return failure(
      'MACHINE_PACKAGE_SCHEMA_INVALID',
      '',
      `Machine package document is not JSON-serializable: ${errorMessage(error)}.`
    );
  }
  const validated = await validateMachinePackage(normalizedDocument, input.files);
  if (!validated.ok) return validated;

  const entries: Record<string, Uint8Array> = {
    [MACHINE_PACKAGE_ENTRY]: strToU8(`${canonicalJson(validated.package.document)}\n`)
  };
  for (const path of Object.keys(validated.package.files).sort()) {
    entries[path] = validated.package.files[path];
  }
  const entryNames = Object.keys(entries);
  if (entryNames.length > MAX_MACHINE_PACKAGE_ENTRIES) {
    return failure(
      'MACHINE_PACKAGE_ENTRY_COUNT_EXCEEDED',
      '',
      `Machine package contains ${entryNames.length} entries; the maximum is ${MAX_MACHINE_PACKAGE_ENTRIES}.`
    );
  }
  const expandedBytes = entryNames.reduce((total, name) => total + entries[name].byteLength, 0);
  if (expandedBytes > MAX_MACHINE_PACKAGE_EXPANDED_BYTES) {
    return failure(
      'MACHINE_PACKAGE_EXPANDED_TOO_LARGE',
      '',
      `Expanded machine package exceeds ${MAX_MACHINE_PACKAGE_EXPANDED_BYTES} bytes.`
    );
  }
  const archive = zipSync(entries, {
    level: 9,
    mtime: new Date(1980, 0, 1, 0, 0, 0)
  });
  if (archive.byteLength > MAX_MACHINE_PACKAGE_ARCHIVE_BYTES) {
    return failure(
      'MACHINE_PACKAGE_ARCHIVE_TOO_LARGE',
      '',
      `Machine package archive is ${archive.byteLength} bytes; the maximum is ${MAX_MACHINE_PACKAGE_ARCHIVE_BYTES}.`
    );
  }
  const contentHash = await sha256(archive);
  if (!contentHash) return hashUnavailable();
  return {
    ok: true,
    archive,
    package: deepFreeze({ ...validated.package, contentHash })
  };
}

/** Bounded archive decoding for repair tools. Contents remain unvalidated and cannot be installed. */
export function readMachinePackageArchiveContents(
  archive: Uint8Array
): { ok: true; document: unknown; files: Readonly<Record<string, Uint8Array>> }
  | Extract<ParseMachinePackageArchiveResult, { ok: false }> {
  if (archive.byteLength > MAX_MACHINE_PACKAGE_ARCHIVE_BYTES) {
    return failure(
      'MACHINE_PACKAGE_ARCHIVE_TOO_LARGE',
      '',
      `Machine package archive is ${archive.byteLength} bytes; the maximum is ${MAX_MACHINE_PACKAGE_ARCHIVE_BYTES}.`
    );
  }

  const directory = inspectZipDirectory(archive);
  if (!directory.ok) return directory;
  if (directory.names.length > MAX_MACHINE_PACKAGE_ENTRIES) {
    return failure(
      'MACHINE_PACKAGE_ENTRY_COUNT_EXCEEDED',
      '',
      `Machine package contains ${directory.names.length} entries; the maximum is ${MAX_MACHINE_PACKAGE_ENTRIES}.`
    );
  }
  const seenNames = new Set<string>();
  for (const name of directory.names) {
    if (seenNames.has(name)) {
      return failure(
        name === MACHINE_PACKAGE_ENTRY ? 'MACHINE_PACKAGE_ENTRY_DUPLICATE' : 'MACHINE_PACKAGE_FILE_DUPLICATE',
        `/${name}`,
        `Machine package archive contains a duplicate entry: ${name}.`
      );
    }
    seenNames.add(name);
  }

  let expandedBytes = 0;
  let expandedTooLarge = false;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(archive, {
      filter(file) {
        expandedBytes += file.originalSize;
        if (expandedBytes > MAX_MACHINE_PACKAGE_EXPANDED_BYTES) {
          expandedTooLarge = true;
          return false;
        }
        return true;
      }
    });
  } catch (error) {
    return failure(
      'MACHINE_PACKAGE_ARCHIVE_INVALID',
      '',
      `Machine package is not a supported ZIP archive: ${errorMessage(error)}.`
    );
  }
  if (expandedTooLarge) {
    return failure(
      'MACHINE_PACKAGE_EXPANDED_TOO_LARGE',
      '',
      `Expanded machine package exceeds ${MAX_MACHINE_PACKAGE_EXPANDED_BYTES} bytes.`
    );
  }

  for (const path of Object.keys(entries)) {
    const pathError = packagePathDiagnostic(path);
    if (pathError) return { ok: false, diagnostics: [pathError] };
  }
  const documentBytes = entries[MACHINE_PACKAGE_ENTRY];
  if (!documentBytes) {
    return failure(
      'MACHINE_PACKAGE_ENTRY_MISSING',
      '',
      `Machine package archive must contain ${MACHINE_PACKAGE_ENTRY}.`
    );
  }

  let unknownDocument: unknown;
  try {
    unknownDocument = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(documentBytes));
  } catch {
    return failure(
      'MACHINE_PACKAGE_JSON_INVALID',
      `/${MACHINE_PACKAGE_ENTRY}`,
      `${MACHINE_PACKAGE_ENTRY} is not valid UTF-8 JSON.`
    );
  }
  return {
    ok: true, document: unknownDocument,
    files: Object.fromEntries(Object.entries(entries).filter(([path]) => path !== MACHINE_PACKAGE_ENTRY))
  };
}

export async function parseMachinePackageArchive(archive: Uint8Array): Promise<ParseMachinePackageArchiveResult> {
  const contents = readMachinePackageArchiveContents(archive);
  if (!contents.ok) return contents;
  const { document: unknownDocument, files } = contents;
  const schemaError = Value.Errors(MachinePackageDocumentSchema, unknownDocument).First();
  if (schemaError) {
    return failure(
      'MACHINE_PACKAGE_SCHEMA_INVALID',
      `/${MACHINE_PACKAGE_ENTRY}${schemaError.path}`,
      `Machine package schema violation at ${schemaError.path || '/'}: ${schemaError.message}.`
    );
  }
  const document: MachinePackageDocumentValue = Value.Decode(
    MachinePackageDocumentSchema,
    unknownDocument
  );
  const validated = await validateMachinePackage(document, files);
  if (!validated.ok) return validated;
  const contentHash = await sha256(archive);
  if (!contentHash) return hashUnavailable();
  return {
    ok: true,
    package: deepFreeze({ ...validated.package, contentHash })
  };
}

async function validateMachinePackage(
  document: MachinePackageDocumentValue,
  files: Readonly<Record<string, Uint8Array>>
): Promise<ParseMachinePackageArchiveResult> {
  const schemaError = Value.Errors(MachinePackageDocumentSchema, document).First();
  if (schemaError) {
    return failure(
      'MACHINE_PACKAGE_SCHEMA_INVALID',
      schemaError.path,
      `Machine package schema violation at ${schemaError.path || '/'}: ${schemaError.message}.`
    );
  }
  const machineResult = validateMachineDefinitionSemantics(
    Value.Decode(MachineDefinitionSchema, document.machine)
  );
  if (!machineResult.ok) {
    return failure(
      'MACHINE_PACKAGE_MACHINE_INVALID',
      '/machine',
      `Machine definition is invalid: ${machineResult.diagnostics.map(({ message }) => message).join('; ')}.`
    );
  }

  let postLibrary = createEmptyPostLibrary();
  const postClaims = new Set<string>();
  for (const [index, postValue] of document.posts.entries()) {
    const postClaim = `${postValue.manifest.id}\u0000${postValue.manifest.version}`;
    if (postClaims.has(postClaim)) {
      return failure(
        'MACHINE_PACKAGE_POST_DUPLICATE',
        `/posts/${index}`,
        `Post requirement ${postValue.manifest.id}@${postValue.manifest.version} is duplicated.`
      );
    }
    postClaims.add(postClaim);
    const parsedPost = validateWireEdmPostPackageValue(postValue);
    if (!parsedPost.ok) {
      return {
        ok: false,
        diagnostics: [{
          code: 'MACHINE_PACKAGE_POST_INVALID',
          path: `/posts/${index}`,
          message: `Post processor at /posts/${index} is invalid.`,
          postDiagnostics: parsedPost.diagnostics
        }]
      };
    }
    const installed = await installPostPackage(postLibrary, parsedPost.package);
    if (!installed.ok) {
      if (installed.error.code === 'POST_LIBRARY_CONFORMANCE_FAILED') {
        return {
          ok: false,
          diagnostics: [{
            code: 'MACHINE_PACKAGE_POST_INSTALL_FAILED',
            path: `/posts/${index}`,
            message: installed.error.message,
            conformanceDiagnostics: installed.error.diagnostics
          }]
        };
      }
      return failure(
        'MACHINE_PACKAGE_POST_INSTALL_FAILED',
        `/posts/${index}`,
        installed.error.message
      );
    }
    postLibrary = installed.library;
  }

  const bindingsValid = await validateMachinePostBindings(machineResult.machine, postLibrary);
  if (!bindingsValid.ok) {
    const diagnosticCode = bindingsValid.error.code === 'MACHINE_POST_BINDING_TARGET_MISMATCH'
      ? 'MACHINE_PACKAGE_TARGET_MISMATCH'
      : 'MACHINE_PACKAGE_BINDING_INVALID';
    return failure(
      diagnosticCode,
      `/machine/bindings/${machineResult.machine.bindings.indexOf(bindingsValid.binding)}`,
      bindingsValid.error.message
    );
  }
  if (!machineResult.machine.bindings.some(({ id }) => id === document.activeBindingId)) {
    return failure(
      'MACHINE_PACKAGE_ACTIVE_BINDING_MISSING',
      '/activeBindingId',
      `Active machine setup not found: ${document.activeBindingId}.`
    );
  }
  if (machineResult.machine.activeBindingId !== document.activeBindingId) {
    return failure(
      'MACHINE_PACKAGE_ACTIVE_BINDING_CONFLICT',
      '/activeBindingId',
      `Package selection ${document.activeBindingId} conflicts with the machine selection ${machineResult.machine.activeBindingId ?? 'none'}.`
    );
  }
  for (const [index, installation] of postLibrary.installations.entries()) {
    const bound = machineResult.machine.bindings.some(({ post }) => (
      postInstallationRefsEqual(post, installation.ref)
    ));
    if (!bound) {
      return failure(
        'MACHINE_PACKAGE_POST_UNBOUND',
        `/posts/${index}`,
        `Included post ${installation.ref.packageId}@${installation.ref.version} has no complete machine setup.`
      );
    }
    if (!postTargetsMachine(installation.package, machineResult.machine)) {
      return failure(
        'MACHINE_PACKAGE_TARGET_MISMATCH',
        `/posts/${index}/manifest/targets`,
        `Post ${installation.ref.packageId}@${installation.ref.version} does not target ${machineResult.machine.identity.manufacturer} ${machineResult.machine.identity.model} with controller ${machineResult.machine.identity.controller.manufacturer} ${machineResult.machine.identity.controller.model} firmware ${machineResult.machine.identity.controller.firmware ?? 'unknown'}.`
      );
    }
  }

  const evidence = evidenceClaims(machineResult.machine, document.posts);
  for (const claim of evidence) {
    const pathError = packagePathDiagnostic(claim.uri);
    if (pathError) return { ok: false, diagnostics: [pathError] };
    const file = files[claim.uri];
    if (!file) {
      return failure(
        'MACHINE_PACKAGE_EVIDENCE_MISSING',
        claim.path,
        `Referenced evidence file is missing from the package: ${claim.uri}.`
      );
    }
    const actualHash = await sha256(file);
    if (!actualHash) return hashUnavailable();
    if (actualHash !== claim.contentSha256) {
      return failure(
        'MACHINE_PACKAGE_EVIDENCE_HASH_MISMATCH',
        claim.path,
        `Evidence ${claim.uri} has hash ${actualHash}; expected ${claim.contentSha256}.`
      );
    }
  }
  const referencedFiles = new Set(evidence.map(({ uri }) => uri));
  const unreferenced = Object.keys(files).find((path) => !referencedFiles.has(path));
  if (unreferenced) {
    return failure(
      'MACHINE_PACKAGE_FILE_UNREFERENCED',
      `/${unreferenced}`,
      `Machine package file is not referenced by machine or post evidence: ${unreferenced}.`
    );
  }

  return {
    ok: true,
    package: deepFreeze({
      document: {
        ...document,
        machine: machineResult.machine,
        posts: postLibrary.installations.map(({ package: packageValue }) => packageValue)
      },
      files: cloneFiles(files),
      postLibrary,
      contentHash: ''
    })
  };
}

function postTargetsMachine(post: WireEdmPostPackage, machine: MachineDefinition) {
  return post.manifest.targets.some((target) => (
    target.manufacturer === machine.identity.manufacturer &&
    target.controllerManufacturer === machine.identity.controller.manufacturer &&
    target.controller === machine.identity.controller.model &&
    (target.firmware.status === 'unknown'
      ? machine.identity.controller.firmware === undefined
      : machine.identity.controller.firmware !== undefined &&
        target.firmware.versions.includes(machine.identity.controller.firmware)) &&
    (target.machineModels.length === 0 || target.machineModels.includes(machine.identity.model))
  ));
}

function evidenceClaims(
  machine: MachineDefinition,
  posts: readonly WireEdmPostPackage[]
) {
  return [
    ...machine.evidence.map((source, index) => ({
      uri: source.uri,
      contentSha256: source.contentSha256,
      path: `/machine/evidence/${index}/uri`
    })),
    ...posts.flatMap((post, postIndex) => post.sources.map((source, sourceIndex) => ({
      uri: source.uri,
      contentSha256: source.contentSha256,
      path: `/posts/${postIndex}/sources/${sourceIndex}/uri`
    })))
  ];
}

function packagePathDiagnostic(path: string): MachinePackageDiagnostic | null {
  const segments = path.split('/');
  if (
    path.length === 0 ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\u0000') ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    return {
      code: 'MACHINE_PACKAGE_PATH_INVALID',
      path: `/${path}`,
      message: `Machine package path must be a normalized relative path: ${JSON.stringify(path)}.`
    };
  }
  return null;
}

function inspectZipDirectory(archive: Uint8Array):
  | { readonly ok: true; readonly names: readonly string[] }
  | { readonly ok: false; readonly diagnostics: readonly MachinePackageDiagnostic[] } {
  const minimumEocdBytes = 22;
  const maximumCommentBytes = 65_535;
  const firstCandidate = Math.max(0, archive.byteLength - minimumEocdBytes - maximumCommentBytes);
  let eocdOffset = -1;
  for (let index = archive.byteLength - minimumEocdBytes; index >= firstCandidate; index -= 1) {
    if (readUint32(archive, index) === 0x06054b50) {
      eocdOffset = index;
      break;
    }
  }
  if (eocdOffset < 0) return invalidZipDirectory('ZIP end-of-central-directory record is missing.');
  const disk = readUint16(archive, eocdOffset + 4);
  const centralDisk = readUint16(archive, eocdOffset + 6);
  const diskEntries = readUint16(archive, eocdOffset + 8);
  const totalEntries = readUint16(archive, eocdOffset + 10);
  const centralSize = readUint32(archive, eocdOffset + 12);
  const centralOffset = readUint32(archive, eocdOffset + 16);
  const commentLength = readUint16(archive, eocdOffset + 20);
  if (
    disk === null ||
    centralDisk === null ||
    diskEntries === null ||
    totalEntries === null ||
    centralSize === null ||
    centralOffset === null ||
    commentLength === null
  ) {
    return invalidZipDirectory('ZIP end-of-central-directory record is truncated.');
  }
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) {
    return invalidZipDirectory('Multi-disk ZIP archives are not supported.');
  }
  if (eocdOffset + minimumEocdBytes + commentLength !== archive.byteLength) {
    return invalidZipDirectory('ZIP end record or comment length is inconsistent.');
  }
  if (centralOffset + centralSize !== eocdOffset) {
    return invalidZipDirectory('ZIP central-directory bounds are inconsistent.');
  }
  const names: string[] = [];
  let cursor = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (readUint32(archive, cursor) !== 0x02014b50) {
      return invalidZipDirectory('ZIP central-directory entry is malformed.');
    }
    const nameLength = readUint16(archive, cursor + 28);
    const extraLength = readUint16(archive, cursor + 30);
    const entryCommentLength = readUint16(archive, cursor + 32);
    if (nameLength === null || extraLength === null || entryCommentLength === null) {
      return invalidZipDirectory('ZIP central-directory entry is truncated.');
    }
    const nameStart = cursor + 46;
    const next = nameStart + nameLength + extraLength + entryCommentLength;
    if (next > eocdOffset) return invalidZipDirectory('ZIP central-directory entry exceeds its declared bounds.');
    names.push(strFromU8(archive.subarray(nameStart, nameStart + nameLength)));
    cursor = next;
  }
  if (cursor !== eocdOffset) return invalidZipDirectory('ZIP central directory contains undeclared trailing data.');
  return { ok: true, names };
}

function readUint16(bytes: Uint8Array, offset: number) {
  if (offset < 0 || offset + 2 > bytes.byteLength) return null;
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes: Uint8Array, offset: number) {
  if (offset < 0 || offset + 4 > bytes.byteLength) return null;
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function invalidZipDirectory(message: string) {
  return failure('MACHINE_PACKAGE_ARCHIVE_INVALID', '', message);
}

function cloneFiles(files: Readonly<Record<string, Uint8Array>>) {
  return Object.freeze(Object.fromEntries(
    Object.entries(files).map(([path, bytes]) => [path, bytes.slice()])
  ));
}

function failure(
  code: MachinePackageDiagnostic['code'],
  path: string,
  message: string
): { ok: false; diagnostics: readonly MachinePackageDiagnostic[] } {
  return { ok: false, diagnostics: [{ code, path, message }] };
}

function hashUnavailable() {
  return failure(
    'MACHINE_PACKAGE_HASH_UNAVAILABLE',
    '',
    'SHA-256 is unavailable; the machine package cannot be identified exactly.'
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function jsonFitsUtf8Bytes(value: unknown, maximumBytes: number) {
  if (maximumBytes < 0) return false;
  let bytes = 0;
  const ancestors = new WeakSet<object>();
  const add = (count: number) => {
    bytes += count;
    return bytes <= maximumBytes;
  };
  const visit = (candidate: unknown, arrayElement = false): boolean => {
    if (candidate === null) return add(4);
    if (typeof candidate === 'string') return add(jsonStringUtf8Bytes(candidate, maximumBytes - bytes));
    if (typeof candidate === 'boolean') return add(candidate ? 4 : 5);
    if (typeof candidate === 'number') return add(JSON.stringify(candidate).length);
    if (typeof candidate === 'undefined' || typeof candidate === 'function' || typeof candidate === 'symbol') {
      return arrayElement ? add(4) : true;
    }
    if (typeof candidate !== 'object') return false;
    if (ancestors.has(candidate)) return false;
    ancestors.add(candidate);
    let fits = add(2);
    if (Array.isArray(candidate)) {
      for (let index = 0; fits && index < candidate.length; index += 1) {
        if (index > 0) fits = add(1);
        if (fits) fits = visit(candidate[index], true);
      }
    } else {
      let emitted = 0;
      for (const key of Object.keys(candidate)) {
        const child = (candidate as Record<string, unknown>)[key];
        if (typeof child === 'undefined' || typeof child === 'function' || typeof child === 'symbol') continue;
        if (emitted > 0) fits = add(1);
        if (fits) fits = add(jsonStringUtf8Bytes(key, maximumBytes - bytes));
        if (fits) fits = add(1);
        if (fits) fits = visit(child);
        emitted += 1;
        if (!fits) break;
      }
    }
    ancestors.delete(candidate);
    return fits;
  };
  return visit(value);
}

function jsonStringUtf8Bytes(value: string, maximumBytes: number) {
  let bytes = 2;
  for (let index = 0; index < value.length && bytes <= maximumBytes; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) {
      bytes += 2;
    } else if (code < 0x20 || (code >= 0xd800 && code <= 0xdfff && !isSurrogatePair(value, index))) {
      bytes += 6;
    } else if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function isSurrogatePair(value: string, index: number) {
  const code = value.charCodeAt(index);
  if (code < 0xd800 || code > 0xdbff || index + 1 >= value.length) return false;
  const next = value.charCodeAt(index + 1);
  return next >= 0xdc00 && next <= 0xdfff;
}

async function sha256(value: Uint8Array) {
  if (!globalThis.crypto?.subtle) return null;
  const copied = new Uint8Array(value.byteLength);
  copied.set(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copied.buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach((entry) => deepFreeze(entry));
  }
  return value;
}
