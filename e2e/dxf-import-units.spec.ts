import { expect, test, type Page } from '@playwright/test';

import { confirmPendingDxfImport } from './dxf-import';

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
  await expect(page.locator('[data-editor-status-units]')).toContainText('inches ×25.4');

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
  await expect(page.locator('[data-editor-status-units]')).toContainText('inches ×25.4');
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
