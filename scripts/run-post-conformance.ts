import { readFile } from 'node:fs/promises';
import process from 'node:process';

import { parseWireEdmPostPackage } from '../src/domain/post-processor/postPackage.ts';
import { runCustomPostConformance } from '../src/domain/post-processor/custom-runtime/customPostConformance.ts';
import { CANONICAL_POST_PLAN_FIXTURES } from '../src/domain/post-processor/custom-runtime/canonicalPostConformanceFixtures.ts';

const packagePaths = process.argv.slice(2);
if (packagePaths.length !== 1) {
  writeFailure('invocation', 'POST_CONFORMANCE_ARGUMENT_INVALID', 'Pass exactly one .wireedm-post.json path.');
} else if (!packagePaths[0].endsWith('.wireedm-post.json')) {
  writeFailure(
    'invocation',
    'POST_CONFORMANCE_ARGUMENT_INVALID',
    'The package path must end in .wireedm-post.json.'
  );
} else {
  await run(packagePaths[0]);
}

async function run(filePath: string) {
  let rawPackage: string;
  try {
    rawPackage = await readFile(filePath, 'utf8');
  } catch (error) {
    writeFailure(
      'input',
      'POST_CONFORMANCE_INPUT_UNREADABLE',
      error instanceof Error ? error.message : String(error)
    );
    return;
  }

  const parsed = parseWireEdmPostPackage(rawPackage);
  if (!parsed.ok) {
    writeReport({
      ok: false,
      stage: 'package-validation',
      diagnostics: parsed.diagnostics
    });
    return;
  }

  const result = await runCustomPostConformance({
    packageValue: parsed.package,
    planFixtures: CANONICAL_POST_PLAN_FIXTURES
  });
  writeReport({
    ...result,
    stage: 'conformance',
    package: {
      id: parsed.package.manifest.id,
      version: parsed.package.manifest.version
    }
  });
}

function writeFailure(stage: 'invocation' | 'input', code: string, message: string) {
  writeReport({
    ok: false,
    stage,
    diagnostics: [{ code, message }]
  });
}

function writeReport(report: Readonly<Record<string, unknown>> & { readonly ok: boolean }) {
  process.stdout.write(`${JSON.stringify({
    conformanceRunnerVersion: '1',
    ...report
  }, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}
