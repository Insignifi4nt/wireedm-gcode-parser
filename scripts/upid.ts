import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { compileWireEdmExecutionPlan } from '../src/domain/execution-plan/executionPlan.ts';
import { MAX_PORTABLE_UPID_BYTES, parsePortableUpid } from '../src/domain/upid/portableUpidProject.ts';

const args = process.argv.slice(2);
const requireExecutable = args.includes('--require-executable');
const files = args.filter((argument) => !argument.startsWith('--'));
const unknownOptions = args.filter((argument) => argument.startsWith('--') &&
  argument !== '--require-executable' && argument !== '--help');

if (args.includes('--help')) {
  console.log('Usage: npm run upid:validate -- <file.upid.json> [...] [--require-executable]');
  console.log('Prints one JSON report per file. Exit 0: valid; 1: invalid/unreadable; 2: usage error.');
  console.log('--require-executable also fails when controller-neutral execution planning is blocked.');
} else if (files.length === 0 || unknownOptions.length > 0) {
  console.error(unknownOptions.length > 0
    ? `Unknown option: ${unknownOptions.join(', ')}`
    : 'Provide at least one portable UPID file. Use --help for usage.');
  process.exitCode = 2;
} else {
  for (const file of files) {
    const absolutePath = path.resolve(file);
    try {
      const metadata = await stat(absolutePath);
      if (!metadata.isFile()) throw new Error('The path is not a regular file.');
      if (metadata.size > MAX_PORTABLE_UPID_BYTES) {
        console.log(JSON.stringify({ file: absolutePath, ok: false, error: {
          code: 'PORTABLE_UPID_TOO_LARGE', actualBytes: metadata.size, maximumBytes: MAX_PORTABLE_UPID_BYTES
        } }));
        process.exitCode = 1;
        continue;
      }
      const bytes = await readFile(absolutePath);
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      } catch {
        console.log(JSON.stringify({ file: absolutePath, ok: false, error: {
          code: 'PORTABLE_UPID_ENCODING_INVALID', message: 'Portable UPID must contain valid UTF-8.'
        } }));
        process.exitCode = 1;
        continue;
      }
      const parsed = parsePortableUpid(text);
      if (!parsed.ok) {
        console.log(JSON.stringify({ file: absolutePath, ...parsed }));
        process.exitCode = 1;
        continue;
      }
      const document = parsed.document;
      const execution = compileWireEdmExecutionPlan(document);
      const ok = !requireExecutable || execution.ok;
      console.log(JSON.stringify({
        file: absolutePath, ok, format: 'upid', schemaVersion: document.schemaVersion,
        structurallyValid: true,
        geometry: {
          units: 'millimeters', axes: 'xy', basis: document.geometryBasis,
          segments: document.segments.length, operations: document.plan.operations.length,
          kinds: [...new Set(document.segments.map((segment) => segment.kind))]
        },
        diagnostics: document.diagnostics,
        execution: execution.ok
          ? { ready: true, requirements: execution.plan.requirements, eventCount: execution.plan.events.length }
          : { ready: false, diagnostics: execution.diagnostics }
      }));
      if (!ok) process.exitCode = 1;
    } catch (error) {
      console.log(JSON.stringify({ file: absolutePath, ok: false, error: {
        code: 'PORTABLE_UPID_READ_FAILED',
        message: error instanceof Error ? error.message : String(error)
      } }));
      process.exitCode = 1;
    }
  }
}
