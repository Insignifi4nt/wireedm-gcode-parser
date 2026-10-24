import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createUpidFromDxfEntities } from '../src/domain/upid/upidDocument';
import { prepareCadTools, rawCadToolCall } from './cad-tool-helpers';

test('attaches DXF beyond script limits and a multi-megabyte UPID through small token calls', async ({ page }) => {
  test.setTimeout(120_000);
  await prepareCadTools(page);
  let workflow = await rawCadToolCall(page, 'edm_workflow_context');
  expect(await rawCadToolCall(page, 'edm_request_import_file', { expectedVersion: workflow.data.version })).toMatchObject({ ok: true });
  await expect(page.getByRole('dialog', { name: 'Attach an agent import file', exact: true })).toBeVisible();
  const dxf = await readFile('tests/fixtures/machine-packages/robofil-100-v2/no-lead-rectangle.dxf', 'utf8');
  const padded = dxf.replace(/0\s+EOF\s*$/, `${'999\nlarge drawing annotation\n'.repeat(10_000)}0\nEOF\n`);
  expect(Buffer.byteLength(padded)).toBeGreaterThan(235_000);
  await page.getByLabel('Agent import file', { exact: true }).setInputFiles({ name: 'drawing.dxf', mimeType: 'application/dxf', buffer: Buffer.from(padded) });
  workflow = await rawCadToolCall(page, 'edm_workflow_context');
  const token = workflow.data.inputFile.fileToken;
  expect(await rawCadToolCall(page, 'edm_prepare_dxf', { expectedVersion: workflow.data.version, source: { fileToken: token } })).toMatchObject({ ok: true, data: { choices: expect.any(Array), preparationId: expect.any(String) } });
  expect((await rawCadToolCall(page, 'edm_list_projects')).data.total).toBe(0);
  expect(await rawCadToolCall(page, 'edm_request_import_file', { expectedVersion: workflow.data.version })).toMatchObject({ ok: true });
  const count = 4_363;
  const document = createUpidFromDxfEntities(Array.from({ length: count }, (_, index) => ({ type: 'line', layer: 'CUT',
    start: { x: 70 * Math.cos(index / count * 2 * Math.PI), y: 70 * Math.sin(index / count * 2 * Math.PI) },
    end: { x: 70 * Math.cos((index + 1) % count / count * 2 * Math.PI), y: 70 * Math.sin((index + 1) % count / count * 2 * Math.PI) } })));
  const portable = Buffer.from(JSON.stringify({ format: 'upid', schemaVersion: document.schemaVersion, document }, null, 2));
  expect(portable.length).toBeGreaterThan(6 * 1024 * 1024);
  await page.getByLabel('Agent import file', { exact: true }).setInputFiles({ name: 'large.upid.json', mimeType: 'application/json', buffer: portable });
  workflow = await rawCadToolCall(page, 'edm_workflow_context');
  expect(await rawCadToolCall(page, 'edm_import_upid', { expectedVersion: workflow.data.version, source: { fileToken: token } })).toMatchObject({ ok: false, error: { code: 'FILE_TOKEN_STALE' } });
  const input = { expectedVersion: workflow.data.version, source: { fileToken: workflow.data.inputFile.fileToken } };
  expect(JSON.stringify(input).length).toBeLessThan(200);
  expect(await rawCadToolCall(page, 'edm_import_upid', input)).toMatchObject({ ok: true, data: { imported: true } });
  await expect(page.locator('[data-editor-context="path-project"]')).toBeVisible();
  const context = await rawCadToolCall(page, 'edm_get_context');
  expect(await rawCadToolCall(page, 'edm_get_project', { target: { kind: 'current-draft', version: context.data.draft.version } })).toMatchObject({ ok: true, data: { counts: { segments: count } } });
  await page.reload();
  await expect(page.locator('[data-editor-context="path-project"]')).toBeVisible();
  expect((await rawCadToolCall(page, 'edm_workflow_context')).data.inputFile).toBeNull();
});
