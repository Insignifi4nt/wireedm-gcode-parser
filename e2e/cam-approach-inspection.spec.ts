import { expect, test } from '@playwright/test';
import { createUpidFromDxfEntities } from '../src/domain/upid/upidDocument';
import { prepareCadTools, rawCadToolCall } from './cad-tool-helpers';

test('queries nearest clear attachment and blocked lead through versioned public tools without editing', async ({ page }) => {
  await prepareCadTools(page);
  const document = createUpidFromDxfEntities([
    { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 70 },
    { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 20 }
  ]);
  const workflow = await rawCadToolCall(page, 'edm_workflow_context');
  expect(await rawCadToolCall(page, 'edm_import_upid', { expectedVersion: workflow.data.version,
    source: { fileName: 'approach.upid.json', text: JSON.stringify({ format: 'upid', schemaVersion: document.schemaVersion, document }) } })).toMatchObject({ ok: true });
  await expect(page.locator('[data-editor-context="path-project"]')).toBeVisible();
  const before = await rawCadToolCall(page, 'edm_get_context');
  const target = { kind: 'current-draft', version: before.data.draft.version };
  const operations = await rawCadToolCall(page, 'edm_query_geometry', { target, kind: 'operations' });
  const outer = operations.data.items.find((operation: { classification: string }) => operation.classification === 'exterior');
  const hole = operations.data.items.find((operation: { classification: string }) => operation.classification === 'hole');
  expect(await rawCadToolCall(page, 'edm_inspect_approach', { target, operationId: outer.id, from: { x: 75, y: 0 } }))
    .toMatchObject({ ok: true, data: { status: 'clear', nearestReachablePoint: { x: 70, y: 0 }, lengthMm: 5, intersections: { total: 0 } } });
  expect(await rawCadToolCall(page, 'edm_inspect_approach', { target, operationId: hole.id, from: { x: 75, y: 0 } }))
    .toMatchObject({ ok: true, data: { status: 'blocked', nearestReachablePoint: null, intersections: { total: 1 }, searchedAlternatives: false } });
  expect((await rawCadToolCall(page, 'edm_get_context')).data.draft).toEqual(before.data.draft);
});
