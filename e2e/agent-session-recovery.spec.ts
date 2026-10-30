import { expect, test } from '@playwright/test';
import { createUpidFromDxfEntities } from '../src/domain/upid/upidDocument';
import { prepareCadTools, rawCadToolCall } from './cad-tool-helpers';

test('recovers registrations across navigation and page resume without discarding dirty CAM work', async ({ page }) => {
  await prepareCadTools(page);
  const document = createUpidFromDxfEntities([{ type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 10 }]);
  const workflow = await rawCadToolCall(page, 'edm_workflow_context');
  expect(await rawCadToolCall(page, 'edm_import_upid', { expectedVersion: workflow.data.version,
    source: { fileName: 'resume.upid.json', text: JSON.stringify({ format: 'upid', schemaVersion: document.schemaVersion, document }) } })).toMatchObject({ ok: true });
  await expect(page.locator('[data-editor-context="path-project"]')).toBeVisible();
  const before = await rawCadToolCall(page, 'edm_get_context');
  expect(await rawCadToolCall(page, 'edm_edit_project', { draftVersion: before.data.draft.version, edits: [{ kind: 'translate', delta: { x: 5, y: 2 } }] })).toMatchObject({ ok: true });
  const dirty = await rawCadToolCall(page, 'edm_get_context');
  expect(dirty.data.draft.dirty).toBe(true);
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  const old = await page.evaluate(async () => {
    const tools = Reflect.get(document, '__cadTestTools');
    const previous = tools.get('edm_get_context');
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    return previous.execute({});
  });
  expect(old).toMatchObject({ ok: false, error: { code: 'TOOL_REGISTRATION_STALE' } });
  expect((await rawCadToolCall(page, 'edm_get_context')).data.draft).toEqual(dirty.data.draft);
  expect(await rawCadToolCall(page, 'edm_save_project', { draftVersion: before.data.draft.version })).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
  expect(await rawCadToolCall(page, 'edm_save_project', { draftVersion: dirty.data.draft.version })).toMatchObject({ ok: true });
  await page.reload();
  // A reload starts the whole app again before the editor opens, which can pass the default wait on a busy two-core runner.
  await expect(page.locator('[data-editor-context="path-project"]')).toBeVisible({ timeout: 20_000 });
  const reopened = await rawCadToolCall(page, 'edm_get_context');
  expect(reopened.data.draft.dirty).toBe(false);
  expect(await rawCadToolCall(page, 'edm_query_geometry', { target: { kind: 'current-draft', version: reopened.data.draft.version }, kind: 'segments' }))
    .toMatchObject({ ok: true, data: { items: [{ center: { x: 5, y: 2 }, radius: 10 }] } });
});
