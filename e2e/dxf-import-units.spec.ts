import { expect, test, type Page } from '@playwright/test';

import { confirmPendingDxfImport } from './dxf-import';

test('reviews skipped layout geometry and warnings before storing only the model-space path', async ({ page }) => {
  await openReadyWorkbench(page);
  const text = [
    '0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LINE', '8', 'Matriță 日本', '10', '0', '20', '0', '11', '10', '21', '5',
    '0', 'LINE', '67', '1', '8', 'BORDER', '10', '0', '20', '0', '11', '500', '21', '500',
    '0', 'TEXT', '8', 'NOTES', '1', 'Drawing note', '0', 'ENDSEC', '0', 'EOF'
  ].join('\r\n');
  await page.getByLabel('DXF file', { exact: true }).setInputFiles({ name: 'layout-review.dxf', mimeType: 'application/dxf', buffer: Buffer.from(text) });
  const dialog = page.getByRole('dialog', { name: 'Review DXF import' });
  await expect(dialog.getByLabel('DXF source review')).toContainText('Matriță 日本 · 1 source entity');
  await expect(dialog.getByLabel('DXF source review')).toContainText('Skipped paper-space DXF LINE');
  await expect(dialog.getByLabel('DXF source review')).toContainText('Unsupported DXF entity: TEXT');
  await expect(dialog.getByTestId('dxf-import-size')).toHaveText('10.000 × 5.000 mm');
  await page.screenshot({ path: 'tmp/cam-audit/14-dxf-source-review.png', fullPage: true });
  await confirmPendingDxfImport(page, 'millimeters');
  const stored = await page.evaluate(() => {
    const manifest = JSON.parse(localStorage.getItem('wire-edm-workbench:file:workbench.json') ?? '{}');
    const project = JSON.parse(localStorage.getItem(`wire-edm-workbench:file:${manifest.projects[0].path}`) ?? '{}');
    return {
      raw: localStorage.getItem(`wire-edm-workbench:file:${project.source.files[0].path}`),
      segments: project.content.document.segments
    };
  });
  expect(stored.raw).toBe(text);
  expect(stored.segments).toHaveLength(1);
  expect(stored.segments[0]).toMatchObject({ layer: 'Matriță 日本', end: { x: 10, y: 5 } });
});

test('persists declared DXF units and reopens the neutral UPID project', async ({ page }) => {
  await openReadyWorkbench(page);

  await page.locator('input[aria-label="DXF file"]').setInputFiles({
    name: 'declared-inch.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from(lineDxf(1))
  });

  const dialog = page.getByRole('dialog', { name: 'Review DXF import' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-editor-context="path-project"]')).toHaveCount(0);
  await expect(dialog.getByText('Declared by DXF')).toBeVisible();
  await expect(dialog.getByLabel('DXF units')).toHaveValue('inches');
  await expect(dialog.getByTestId('dxf-import-size')).toContainText('25.400 × 0.000 mm');

  await confirmPendingDxfImport(page, 'inches');
  await expect(page.locator('[data-editor-context="path-project"]')).toBeVisible();
  await expect(page.locator('[data-editor-status-cursor]')).toContainText('mm');

  const projectId = await page.evaluate(() => {
    const manifest = JSON.parse(
      localStorage.getItem('wire-edm-workbench:file:workbench.json') ?? '{}'
    );
    const entry = manifest.projects[0];
    const project = JSON.parse(
      localStorage.getItem(`wire-edm-workbench:file:${entry.path}`) ?? '{}'
    );
    const source = project.content?.document?.source;
    if (source?.unitDeclaration?.status !== 'recognized') {
      throw new Error('Declared unit provenance was not persisted.');
    }
    if (source?.appliedUnits?.basis !== 'dxf-declared') {
      throw new Error('Applied declared-unit provenance was not persisted.');
    }
    if ('machine' in project || 'post' in project) {
      throw new Error('Neutral UPID project persisted controller-specific state.');
    }
    return entry.id as string;
  });

  await page.getByRole('button', { name: 'Back to Dashboard' }).click();
  await page.getByRole('button', { name: `Open project ${projectId} in editor` }).click();
  await expect(page.locator('[data-editor-status-cursor]')).toContainText('mm');
});

test('cancels DXF review without writes or editor navigation', async ({ page }) => {
  await openReadyWorkbench(page);
  const before = await workbenchStorageSnapshot(page);

  await page.locator('input[aria-label="DXF file"]').setInputFiles({
    name: 'cancel-unit-review.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from(lineDxf())
  });
  const dialog = page.getByRole('dialog', { name: 'Review DXF import' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-editor-context="path-project"]')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-editor-context="path-project"]')).toHaveCount(0);
  expect(await workbenchStorageSnapshot(page)).toEqual(before);
});

async function openReadyWorkbench(page: Page) {
  await page.goto('/');
  const onboarding = page.getByRole('dialog', { name: 'Thanks for trying Wire EDM Workbench' });
  await onboarding.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => undefined);
  if (await onboarding.isVisible()) {
    await onboarding.getByRole('button', { name: 'Go Build!' }).click();
    await expect(onboarding).toHaveCount(0);
  }
  await expect(page.locator('input[aria-label="DXF file"]')).toBeEnabled();
}

async function workbenchStorageSnapshot(page: Page) {
  return page.evaluate(() => {
    const entries: Array<[string, string | null]> = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith('wire-edm-workbench:')) entries.push([key, localStorage.getItem(key)]);
    }
    return entries.sort(([left], [right]) => left.localeCompare(right));
  });
}

function lineDxf(unitsCode?: number) {
  return [
    '0', 'SECTION', '2', 'HEADER',
    ...(unitsCode == null ? [] : ['9', '$INSUNITS', '70', String(unitsCode)]),
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LINE', '10', '0', '20', '0', '11', '1', '21', '0',
    '0', 'ENDSEC', '0', 'EOF'
  ].join('\n');
}
