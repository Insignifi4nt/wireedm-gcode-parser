import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(process.cwd());
const cliPath = path.join(projectRoot, 'scripts', 'machine-package.ts');
const tsxPath = path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

function runCli(...args: string[]) {
  try {
    execFileSync(process.execPath, [tsxPath, cliPath, ...args], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    throw new Error('Expected the machine-package CLI to fail.');
  } catch (error) {
    if (!(error instanceof Error) || !('status' in error)) throw error;
    const result = error as Error & { status?: number | null; stderr?: string };
    return {
      status: result.status,
      stderr: result.stderr ?? ''
    };
  }
}

function parseFailure(stderr: string) {
  expect(stderr).not.toMatch(/(?:Error:|at .*\.(?:ts|js|mjs):\d+)/);
  return JSON.parse(stderr) as {
    ok: boolean;
    code: string;
    message: string;
    details: unknown;
  };
}

describe('machine-package CLI error boundary', () => {
  it('returns structured JSON when a build source directory is missing', () => {
    const missingSource = path.join(projectRoot, 'does-not-exist-machine-package-source');
    const result = runCli('build', missingSource);
    const failure = parseFailure(result.stderr);

    expect(result.status).toBe(1);
    expect(failure).toMatchObject({
      ok: false,
      code: 'MACHINE_PACKAGE_CLI_IO_FAILED'
    });
    expect(failure.message).toMatch(/ENOENT|no such file/i);
    expect(failure.details).toBe(failure.message);
  });

  it('returns the size diagnostic when an existing package exceeds the archive limit', () => {
    const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'wire-edm-machine-package-cli-'));
    const oversizedPackage = path.join(temporaryDirectory, 'oversized.wireedm-package');
    try {
      writeFileSync(oversizedPackage, Buffer.alloc(32 * 1024 * 1024 + 1));
      expect(statSync(oversizedPackage).size).toBe(32 * 1024 * 1024 + 1);

      const result = runCli('validate', oversizedPackage);
      const failure = parseFailure(result.stderr);

      expect(result.status).toBe(1);
      expect(failure).toMatchObject({
        ok: false,
        code: 'MACHINE_PACKAGE_ARCHIVE_TOO_LARGE',
        message: expect.stringContaining('remaining maximum')
      });
      expect(failure.details).toBe(failure.message);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
