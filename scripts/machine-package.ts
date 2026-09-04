import { open, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { Value } from '@sinclair/typebox/value';

import { parseMachineDefinition } from '../src/domain/machine-definition/machineDefinition.ts';
import {
  buildMachinePackageArchive,
  MachinePackageSourceDocumentSchema,
  MAX_MACHINE_PACKAGE_ARCHIVE_BYTES,
  MAX_MACHINE_PACKAGE_EXPANDED_BYTES,
  parseMachinePackageArchive
} from '../src/domain/machine-package/machinePackage.ts';
import { parseWireEdmPostPackage } from '../src/domain/post-processor/postPackage.ts';

const SOURCE_FILE = 'machine-package.source.json';

class MachinePackageCliError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'MachinePackageCliError';
  }
}

await main();

async function main() {
  const [command, input, output] = process.argv.slice(2);
  if (!command || !input || !['build', 'validate-source', 'validate', 'inspect'].includes(command)) {
    return fail('MACHINE_PACKAGE_CLI_ARGUMENT_INVALID', 'Usage: machine-package <build|validate-source|validate|inspect> <source-directory-or-package> [output-package].');
  }
  try {
    if (command === 'build' || command === 'validate-source') {
      return await build(input, output, command === 'build');
    }
    return await validateOrInspect(input, command === 'inspect');
  } catch (error) {
    if (error instanceof MachinePackageCliError) return fail(error.code, error.message);
    return fail('MACHINE_PACKAGE_CLI_IO_FAILED', error instanceof Error ? error.message : String(error));
  }
}

async function build(sourceDirectory: string, outputPath: string | undefined, writeArchive: boolean) {
  const root = await realpath(path.resolve(sourceDirectory));
  const sourceBudget = { remainingBytes: MAX_MACHINE_PACKAGE_EXPANDED_BYTES };
  const sourceText = await readSafe(root, SOURCE_FILE, sourceBudget);
  let sourceValue: unknown;
  try {
    sourceValue = JSON.parse(new TextDecoder().decode(sourceText));
  } catch {
    return fail('MACHINE_PACKAGE_SOURCE_JSON_INVALID', `${SOURCE_FILE} is not valid JSON.`);
  }
  const sourceError = Value.Errors(MachinePackageSourceDocumentSchema, sourceValue).First();
  if (sourceError) {
    return fail('MACHINE_PACKAGE_SOURCE_SCHEMA_INVALID', `Source schema violation at ${sourceError.path || '/'}: ${sourceError.message}.`);
  }
  const source = Value.Decode(MachinePackageSourceDocumentSchema, sourceValue);
  const machineText = new TextDecoder().decode(await readSafe(root, source.machineFile, sourceBudget));
  const machine = parseMachineDefinition(machineText);
  if (!machine.ok) {
    return fail('MACHINE_PACKAGE_SOURCE_MACHINE_INVALID', machine.diagnostics.map(({ message }) => message).join('; '));
  }
  const posts = [];
  for (const postFile of source.postFiles) {
    const parsed = parseWireEdmPostPackage(new TextDecoder().decode(await readSafe(root, postFile, sourceBudget)));
    if (!parsed.ok) {
      return fail('MACHINE_PACKAGE_SOURCE_POST_INVALID', `${postFile}: ${parsed.diagnostics.map(({ message }) => message).join('; ')}`);
    }
    posts.push(parsed.package);
  }
  const evidencePaths = new Set([
    ...machine.machine.evidence.map(({ uri }) => uri),
    ...posts.flatMap((post) => post.sources.map(({ uri }) => uri))
  ]);
  const files: Record<string, Uint8Array> = {};
  for (const evidencePath of [...evidencePaths].sort()) {
    files[evidencePath] = await readSafe(root, evidencePath, sourceBudget);
  }
  const built = await buildMachinePackageArchive({
    document: {
      format: 'wire-edm-machine-package',
      schemaVersion: 1,
      manifest: source.manifest,
      machine: machine.machine,
      posts,
      activeBindingId: source.activeBindingId
    },
    files
  });
  if (!built.ok) return fail('MACHINE_PACKAGE_BUILD_INVALID', built.diagnostics);
  let destination: string | undefined;
  if (writeArchive) {
    destination = path.resolve(outputPath ?? path.join(root, `${source.manifest.id}-${source.manifest.version}.wireedm-package`));
    if (path.extname(destination) !== '.wireedm-package') {
      return fail('MACHINE_PACKAGE_OUTPUT_EXTENSION_INVALID', 'Built packages must use the .wireedm-package extension.');
    }
    await writeFile(destination, built.archive);
  }
  return succeed({
    stage: writeArchive ? 'build' : 'validate-source',
    ...(destination ? { output: destination } : {}),
    packageHash: built.package.contentHash,
    machine: { id: built.package.document.machine.id, name: built.package.document.machine.name },
    posts: built.package.postLibrary.installations.map(({ ref }) => ref)
  });
}

async function validateOrInspect(packagePath: string, inspect: boolean) {
  const archive = await readBoundedFile(
    path.resolve(packagePath),
    MAX_MACHINE_PACKAGE_ARCHIVE_BYTES,
    'MACHINE_PACKAGE_ARCHIVE_TOO_LARGE',
    'Machine package archive'
  );
  const parsed = await parseMachinePackageArchive(archive);
  if (!parsed.ok) return fail('MACHINE_PACKAGE_VALIDATION_FAILED', parsed.diagnostics);
  return succeed(inspect ? {
    stage: 'inspect',
    packageHash: parsed.package.contentHash,
    manifest: parsed.package.document.manifest,
    machine: {
      id: parsed.package.document.machine.id,
      name: parsed.package.document.machine.name,
      activeBindingId: parsed.package.document.activeBindingId,
      setups: parsed.package.document.machine.bindings.map(({ id, name, post }) => ({ id, name, post }))
    },
    posts: parsed.package.postLibrary.installations.map(({ ref, package: post }) => ({ ref, output: post.manifest.output })),
    files: Object.keys(parsed.package.files).sort()
  } : {
    stage: 'validate',
    packageHash: parsed.package.contentHash,
    packageId: parsed.package.document.manifest.id,
    packageVersion: parsed.package.document.manifest.version
  });
}

async function readSafe(
  root: string,
  relativePath: string,
  budget: { remainingBytes: number }
) {
  const normalized = relativePath.replaceAll('\\', '/');
  if (
    normalized !== relativePath ||
    path.posix.normalize(relativePath) !== relativePath ||
    relativePath.startsWith('/') ||
    relativePath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`Source path must be a normalized relative POSIX path: ${relativePath}.`);
  }
  const target = path.resolve(root, ...relativePath.split('/'));
  const resolved = await realpath(target);
  const prefix = `${root}${path.sep}`;
  if (!resolved.startsWith(prefix)) throw new Error(`Source path escapes the package directory: ${relativePath}.`);
  const bytes = await readBoundedFile(
    resolved,
    budget.remainingBytes,
    'MACHINE_PACKAGE_EXPANDED_TOO_LARGE',
    'Machine package source inputs'
  );
  budget.remainingBytes -= bytes.byteLength;
  return bytes;
}

async function readBoundedFile(
  filePath: string,
  maximumBytes: number,
  diagnosticCode: string,
  label: string
) {
  const handle = await open(filePath, 'r');
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error(`Input is not a regular file: ${filePath}.`);
    if (metadata.size > maximumBytes) {
      throw new MachinePackageCliError(
        diagnosticCode,
        `${label} is ${metadata.size} bytes; the remaining maximum is ${maximumBytes}.`
      );
    }
    const bytes = new Uint8Array(metadata.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const read = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (read.bytesRead === 0) throw new Error(`Input changed while it was being read: ${filePath}.`);
      offset += read.bytesRead;
    }
    const probe = new Uint8Array(1);
    if ((await handle.read(probe, 0, 1, offset)).bytesRead !== 0) {
      throw new MachinePackageCliError(
        diagnosticCode,
        `${label} grew beyond its checked size while it was being read.`
      );
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

function succeed(details: unknown) {
  process.stdout.write(`${JSON.stringify({ ok: true, ...asRecord(details) }, null, 2)}\n`);
}

function fail(code: string, details: unknown) {
  process.exitCode = 1;
  const message = typeof details === 'string' ? details : 'Machine package operation failed.';
  process.stderr.write(`${JSON.stringify({ ok: false, code, message, details }, null, 2)}\n`);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { result: value };
}
