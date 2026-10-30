import { expect, test } from '@playwright/test';
import { createUpidFromDxfEntities } from '../src/domain/upid/upidDocument';
import { prepareCadTools, rawCadToolCall } from './cad-tool-helpers';

test('uniform scale UI and public edits share bounds, undo and saved-reopen behavior', async ({ page }) => {
  await prepareCadTools(page);
  const doc = createUpidFromDxfEntities([{ type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 10 }]);
  const workflow = await rawCadToolCall(page, 'edm_workflow_context');
  expect(await rawCadToolCall(page, 'edm_import_upid', { expectedVersion: workflow.data.version,
    source: { fileName: 'scale.upid.json', text: JSON.stringify({ format: 'upid', schemaVersion: doc.schemaVersion, document: doc }) } })).toMatchObject({ ok: true });
  await expect(page.getByRole('button', { name: 'Geometry menu', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Geometry menu', exact: true }).click();
  await page.locator('[data-editor-workflow-command="geometry.transform"]').click();
  const scaling = page.getByRole('region', { name: 'Uniform document scaling' });
  await expect(scaling).toContainText('140.000 × 140.000 mm');
  await scaling.getByLabel('Scale amount').fill('120');
  await expect(scaling.getByRole('button', { name: 'Apply uniform scale' })).toBeEnabled();
  await scaling.getByRole('button', { name: 'Apply uniform scale' }).click();
  await page.locator('[data-editor-workflow-actions="geometry.transform"] button[aria-label^="Apply "]').click();
  let context = await rawCadToolCall(page, 'edm_get_context');
  let summary = await rawCadToolCall(page, 'edm_get_project', { target: { kind: 'current-draft', version: context.data.draft.version } });
  expect(summary.data.bounds).toEqual({ minX: -60, maxX: 60, minY: -60, maxY: 60 });
  expect(await rawCadToolCall(page, 'edm_draft_history', { draftVersion: context.data.draft.version, direction: 'undo' })).toMatchObject({ ok: true });
  context = await rawCadToolCall(page, 'edm_get_context');
  expect(await rawCadToolCall(page, 'edm_edit_project', { draftVersion: context.data.draft.version,
    edits: [{ kind: 'scale', origin: { x: 0, y: 0 }, scale: { kind: 'longest-side', lengthMm: 140 } }] })).toMatchObject({ ok: true });
  context = await rawCadToolCall(page, 'edm_get_context');
  expect(await rawCadToolCall(page, 'edm_save_project', { draftVersion: context.data.draft.version })).toMatchObject({ ok: true });
  await page.reload();
  // A reload starts the whole app again before the editor opens, which can pass the default wait on a busy two-core runner.
  await expect(page.getByRole('button', { name: 'Geometry menu', exact: true })).toBeVisible({ timeout: 20_000 });
  context = await rawCadToolCall(page, 'edm_get_context');
  summary = await rawCadToolCall(page, 'edm_get_project', { target: { kind: 'current-draft', version: context.data.draft.version } });
  expect(summary.data.bounds).toEqual({ minX: -70, maxX: 70, minY: -70, maxY: 70 });
});
