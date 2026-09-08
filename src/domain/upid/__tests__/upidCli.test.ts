// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { createUpidFromDxfEntities } from '../upidDocument';

const directory = mkdtempSync(path.join(tmpdir(), 'wireedm-upid-cli-'));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [
    '--import', 'tsx', 'scripts/upid.ts', ...args
  ], { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, TSX_TSCONFIG_PATH: 'tsconfig.app.json' } });
  if (result.error) throw result.error;
  return { status: result.status, reports: result.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) };
}

describe('portable UPID command-line validation', () => {
  it('distinguishes a portable draft from executable intent, without changing the file', () => {
    const document = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
    ]);
    const file = path.join(directory, 'draft.upid.json');
    writeFileSync(file, JSON.stringify({ format: 'upid', schemaVersion: 1, document }));
    const originalText = readFileSync(file, 'utf8');
    expect(run(file)).toMatchObject({ status: 0, reports: [{ ok: true, structurallyValid: true,
      geometry: { segments: 1, units: 'millimeters' }, execution: { ready: false } }] });
    expect(run(file, '--require-executable')).toMatchObject({ status: 1, reports: [{ ok: false,
      execution: { ready: false, diagnostics: [{ code: 'EXECUTION_PLAN_INITIAL_WIRE_REQUIRED' }] } }] });
    expect(readFileSync(file, 'utf8')).toBe(originalText);
    document.setup = { initialWirePosition: { kind: 'manual', point: { x: 0, y: 0 }, review: 'reviewed' } };
    writeFileSync(file, JSON.stringify({ format: 'upid', schemaVersion: 1, document }));
    expect(run(file, '--require-executable')).toMatchObject({ status: 0, reports: [{ ok: true, execution: { ready: true } }] });
  });

  it('reports malformed JSON, invalid UTF-8, and missing paths with a failing exit status', () => {
    const malformed = path.join(directory, 'bad.upid.json');
    const encoding = path.join(directory, 'encoding.upid.json');
    writeFileSync(malformed, '{');
    writeFileSync(encoding, Buffer.from([0xff, 0xfe]));
    const result = run(malformed, encoding, path.join(directory, 'missing.upid.json'));
    expect(result.status).toBe(1);
    expect(result.reports.map((report) => report.error.code)).toEqual([
      'PORTABLE_UPID_JSON_INVALID', 'PORTABLE_UPID_ENCODING_INVALID', 'PORTABLE_UPID_READ_FAILED'
    ]);
  });
});
