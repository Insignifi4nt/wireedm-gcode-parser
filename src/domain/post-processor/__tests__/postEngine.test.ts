import { describe, expect, it } from 'vitest';

import { compileWireEdmExecutionPlan } from '@/domain/execution-plan/executionPlan';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';

import { minimalPostPackage } from './postPackageFixture';
import { runPost } from '../postEngine';
import { createEmptyPostLibrary, installPostPackage } from '../postLibrary';

describe('post engine package execution seam', () => {
  it('executes an installed package only through its authored source', async () => {
    const packageValue = minimalPostPackage();
    packageValue.dialect.commands['distance.absolute'].template = 'PACKAGE-OWNS-SETUP';
    packageValue.fixtures.forEach((fixture) => {
      fixture.expectedProgram = fixture.expectedProgram.replace('G90', 'PACKAGE-OWNS-SETUP');
    });
    const installed = await installPostPackage(createEmptyPostLibrary(), packageValue);
    if (!installed.ok) throw new Error(installed.error.message);

    const result = await runPost(compilePlan(), {
      installation: installed.installation,
      properties: { coordinatePrecision: 3 }
    });

    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.program.lines[0]).toBe('PACKAGE-OWNS-SETUP');
    expect(result.program.lines.at(-1)).toBe('M02');
  });

  it('returns package runtime diagnostics without selecting another implementation', async () => {
    const packageValue = minimalPostPackage();
    packageValue.source.code = `
      export function createPost() {
        return { onEvent() { throw new Error('authored failure'); } };
      }
    `;
    const installation = {
      ref: {
        packageId: packageValue.manifest.id,
        version: packageValue.manifest.version,
        contentHash: '0'.repeat(64)
      },
      package: packageValue
    };

    await expect(runPost(compilePlan(), {
      installation,
      properties: { coordinatePrecision: 3 }
    })).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: 'POST_CUSTOM_RUNTIME_FAILED' }]
    });
  });
});

function compilePlan() {
  const document = createUpidFromDxfEntities([
    { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    { type: 'line', layer: 'CUT', start: { x: 10, y: 0 }, end: { x: 10, y: 10 } },
    { type: 'line', layer: 'CUT', start: { x: 10, y: 10 }, end: { x: 0, y: 10 } },
    { type: 'line', layer: 'CUT', start: { x: 0, y: 10 }, end: { x: 0, y: 0 } }
  ]);
  document.setup = {
    initialWirePosition: { kind: 'manual', point: { x: 0, y: 0 }, review: 'reviewed' }
  };
  const compiled = compileWireEdmExecutionPlan(document);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  return compiled.plan;
}
