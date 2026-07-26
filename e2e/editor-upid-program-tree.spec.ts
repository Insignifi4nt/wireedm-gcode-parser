import { expect, test, type Page } from '@playwright/test';

import { clearWorkbenchCache } from './fixtures/workbench-cache';
import { confirmPendingDxfImport } from './dxf-import';

test('persists a second-operation tree entry edit through save, reload, and reopen', async ({ page }) => {
  await importTwoContourDxf(page, 'tree-entry-persistence.dxf');

  const secondOperation = await expandOperation(page, 1);
  await secondOperation.getByRole('button', { name: 'Edit Entry / lead-in' }).click();
  const entryPanel = page.locator('[data-editor-workspace-panel="entry-exit"]');
  await expect(entryPanel).toBeVisible();
  await expect(entryPanel.getByLabel('Entry and exit operation')).toHaveValue(
    await secondOperation.getAttribute('data-tree-key').then((key) => key?.slice('operation:'.length) ?? '')
  );

  await entryPanel.getByLabel('Entry X').fill('42.5');
  await entryPanel.getByLabel('Entry Y').fill('19.25');
  await entryPanel.getByRole('button', { name: 'Set straight entry' }).click();
  await entryPanel.getByRole('button', { name: 'Save Entry / Exit workflow' }).click();
  await expect(entryPanel).toHaveCount(0);
  await page.getByRole('button', { name: 'Save active document' }).click();
  await expect(page.getByRole('button', { name: 'Save active document' })).toBeDisabled();

  await page.reload();
  await openOnlyProject(page);
  const reloadedSecondOperation = await expandOperation(page, 1);
  const entryNode = reloadedSecondOperation.locator('li[data-tree-key$=":entry"]');
  await expect(entryNode.locator(':scope > [data-editor-program-tree-row]'))
    .toContainText('Entry / lead-in · manual-straight');
  await expect(entryNode.locator('span[aria-label="Ready"]')).toBeVisible();

  await entryNode.getByRole('button', { name: 'Edit Entry / lead-in' }).click();
  const reloadedEntryPanel = page.locator('[data-editor-workspace-panel="entry-exit"]');
  await expect(reloadedEntryPanel.getByLabel('Entry X')).toHaveValue('42.5');
  await expect(reloadedEntryPanel.getByLabel('Entry Y')).toHaveValue('19.25');
});

test('deep-links an existing stop and keeps cancel, discard, and save tree transitions correct', async ({ page }) => {
  await importTwoContourDxf(page, 'tree-stop-transitions.dxf');
  const secondOperation = await expandOperation(page, 1);
  await secondOperation.locator(':scope > [data-editor-program-tree-row]').click();
  await openWorkflowCommand(page, 'Machining', 'machining.program-stops');
  const stopsPanel = page.locator('[data-editor-workspace-panel="program-stops"]');
  await stopsPanel.getByRole('button', { name: 'Add M00 stop' }).click();
  await stopsPanel.getByRole('button', { name: 'Save Program Stops workflow' }).click();
  await page.getByRole('button', { name: 'Save active document' }).click();
  await page.reload();
  await openOnlyProject(page);

  const persistedSecondOperation = await expandOperation(page, 1);
  await expandCutPath(persistedSecondOperation);
  const stopNode = persistedSecondOperation.locator('li[data-tree-key$=":stop:stop-1"]');
  await expect(stopNode).toBeVisible();
  await stopNode.getByRole('button', { name: /^Edit M00/ }).click();
  const persistedStopsPanel = page.locator('[data-editor-workspace-panel="program-stops"]');
  await expect(persistedStopsPanel).toBeVisible();
  await expect(persistedStopsPanel.locator('[data-program-stop="stop-1"]')).toHaveAttribute(
    'data-selected',
    'true'
  );

  await persistedStopsPanel.getByLabel('Selected stop note').fill('cancelled update');
  await persistedStopsPanel.getByRole('button', { name: 'Apply stop-1' }).click();
  await openEntryFromOperation(persistedSecondOperation);
  const transition = page.getByRole('dialog', { name: 'Unsaved workflow changes' });
  await expect(transition).toBeVisible();
  await transition.getByRole('button', { name: 'Dismiss workflow transition' }).click();
  await expect(persistedStopsPanel).toBeVisible();
  await expect(persistedStopsPanel.getByLabel('Selected stop note')).toHaveValue('cancelled update');

  await openEntryFromOperation(persistedSecondOperation);
  await transition.getByRole('button', { name: 'Discard' }).click();
  const entryPanel = page.locator('[data-editor-workspace-panel="entry-exit"]');
  await expect(entryPanel).toBeVisible();
  await entryPanel.getByRole('button', { name: 'Cancel Entry / Exit workflow' }).click();

  await stopNode.getByRole('button', { name: /^Edit M00/ }).click();
  const reselectedStopsPanel = page.locator('[data-editor-workspace-panel="program-stops"]');
  await expect(reselectedStopsPanel.getByLabel('Selected stop note')).toHaveValue('');
  await reselectedStopsPanel.getByLabel('Selected stop note').fill('saved once');
  await reselectedStopsPanel.getByRole('button', { name: 'Apply stop-1' }).click();
  await openEntryFromOperation(persistedSecondOperation);
  await transition.getByRole('button', { name: 'Save' }).click();
  await expect(entryPanel).toBeVisible();
  await entryPanel.getByRole('button', { name: 'Cancel Entry / Exit workflow' }).click();

  const undo = page.getByRole('button', { name: 'Undo active document change' });
  await expect(undo).toBeEnabled();
  await undo.click();
  await stopNode.getByRole('button', { name: /^Edit M00/ }).click();
  await expect(page.locator('[data-editor-workspace-panel="program-stops"]')
    .getByLabel('Selected stop note')).toHaveValue('');
  await page.getByRole('button', { name: 'Cancel Program Stops workflow' }).click();
  await page.getByRole('button', { name: 'Redo active document change' }).click();
  await stopNode.getByRole('button', { name: /^Edit M00/ }).click();
  await expect(page.locator('[data-editor-workspace-panel="program-stops"]')
    .getByLabel('Selected stop note')).toHaveValue('saved once');
});

test('round-trips an exported UPID through a clean browser cache with execution order and provenance', async ({ page }, testInfo) => {
  await importTwoContourDxf(page, 'tree-portable-round-trip.dxf');
  const beforeOrder = await programOperationLabels(page);
  await page.getByRole('button', { name: 'Back to Dashboard' }).click();

  const exportButton = page.locator('[data-project-row][data-project-source="dxf"]')
    .getByRole('button', { name: /Export UPID project/ });
  const downloadPromise = page.waitForEvent('download');
  await exportButton.click();
  const download = await downloadPromise;
  const portableProjectPath = testInfo.outputPath('tree-portable-round-trip.upid.json');
  await download.saveAs(portableProjectPath);
  expect(download.suggestedFilename()).toMatch(/\.upid\.json$/);

  await clearWorkbenchCache(page);
  await expect(page.locator('[data-project-row]')).toHaveCount(0);
  await page.getByRole('button', { name: 'More path project import options' }).click();
  await page.locator('input[aria-label="UPID path project file"]').setInputFiles(portableProjectPath);
  await expect(page.locator('[data-editor-context="path-project"]')).toBeVisible();
  await expect(page.locator('[data-editor-status-units]')).toContainText('millimeters');
  await expect(programOperationLabels(page)).resolves.toEqual(beforeOrder);
  await page.getByRole('button', { name: 'Back to Dashboard' }).click();
  await expect(page.locator('[data-project-row][data-project-source="upid"]')).toHaveCount(1);
});

test('keeps imported NC programs in the machine-program editor through edit, save, reload, and export', async ({ page }) => {
  await openReadyWorkbench(page);
  await page.locator('input[aria-label="Machine program file"]').setInputFiles({
    name: 'tree-machine-program.nc',
    mimeType: 'text/plain',
    buffer: Buffer.from('%\nG90\nG0 X0 Y0\nG1 X12 Y0\nM02\n%')
  });
  await dismissOnboarding(page);
  await expect(page.locator('[data-editor-context="machine-program"]')).toBeVisible();
  await expect(page.getByRole('complementary', { name: /UPID rail/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Machining menu' })).toHaveCount(0);

  await expect(page.locator('details[data-editor-code-section="text"] summary')).toBeVisible();
  expect(await page.evaluate(() => {
    const summary = document.querySelector<HTMLElement>('details[data-editor-code-section="text"] summary');
    const inspector = document.querySelector<HTMLElement>('[data-editor-inspector-summary]');
    if (!summary || !inspector) return false;
    const summaryBox = summary.getBoundingClientRect();
    const inspectorBox = inspector.getBoundingClientRect();
    return summaryBox.bottom <= inspectorBox.top || inspectorBox.bottom <= summaryBox.top;
  })).toBe(true);

  await page.locator('details[data-editor-code-section="text"] summary').click();
  const programEditor = page.getByLabel('Program editor');
  await programEditor.fill('%\nG90\nG0 X0 Y0\nG1 X24 Y0\nM02\n%');
  await page.getByRole('button', { name: 'Save active document' }).click();
  await page.reload();
  await openOnlyProject(page);
  await expect(page.locator('[data-editor-context="machine-program"]')).toBeVisible();
  await expect(page.getByRole('complementary', { name: /UPID rail/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Machining menu' })).toHaveCount(0);
  await page.locator('details[data-editor-code-section="text"] summary').click();
  await expect(page.getByLabel('Program editor')).toContainText('G1 X24 Y0');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export normalized ISO' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^normalized-\d{4}-\d{2}-\d{2}\.iso$/);
});

async function openReadyWorkbench(page: Page) {
  await page.goto('/');
  await expect(page.locator('input[aria-label="DXF file"]')).toBeEnabled();
  await expect(page.locator('input[aria-label="Machine program file"]')).toBeEnabled();
}

async function importTwoContourDxf(page: Page, name: string) {
  await openReadyWorkbench(page);
  await page.locator('input[aria-label="DXF file"]').setInputFiles({
    name,
    mimeType: 'application/dxf',
    buffer: Buffer.from(twoContourDxf())
  });
  await confirmPendingDxfImport(page);
  const onboarding = page.getByRole('dialog', { name: 'Thanks for trying Wire EDM Workbench' });
  if (await onboarding.isVisible()) await onboarding.getByRole('button', { name: 'Go Build!' }).click();
  await expect(page.getByRole('tree', { name: 'UPID program sequence' })).toBeVisible();
}

async function expandOperation(page: Page, index: number) {
  const operation = page.locator(
    'li[data-tree-key="section:program"] > ul > li[role="treeitem"][data-tree-key^="operation:"]'
  ).nth(index);
  await expect(operation).toBeVisible();
  const expansion = operation.locator(':scope > div > button').first();
  if (await expansion.getAttribute('aria-label').then((label) => label?.startsWith('Expand'))) {
    await expansion.click();
  }
  await expect(operation.locator('li[data-tree-key$=":entry"]')).toBeVisible();
  return operation;
}

async function openEntryFromOperation(operation: import('@playwright/test').Locator) {
  await operation.locator('li[data-tree-key$=":entry"]')
    .getByRole('button', { name: 'Edit Entry / lead-in' })
    .click();
}

async function expandCutPath(operation: import('@playwright/test').Locator) {
  const cutPath = operation.locator('li[data-tree-key$=":cut-path"]');
  const expansion = cutPath.locator(':scope > div > button').first();
  if (await expansion.getAttribute('aria-label').then((label) => label?.startsWith('Expand'))) {
    await expansion.click();
  }
  await expect(cutPath).toHaveAttribute('aria-expanded', 'true');
}

async function openWorkflowCommand(page: Page, menu: string, commandId: string) {
  await page.getByRole('button', { name: `${menu} menu` }).click();
  await page.locator(`[data-editor-workflow-command="${commandId}"]`).click();
}

async function openOnlyProject(page: Page) {
  await expect(page.locator('[data-project-row]')).toHaveCount(1);
  await page.locator('[data-project-row]').getByRole('button', { name: /Open project .* in editor/ }).click();
}

async function programOperationLabels(page: Page) {
  return await page.locator(
    'li[data-tree-key="section:program"] > ul > li[role="treeitem"][data-tree-key^="operation:"]'
  ).evaluateAll((operations) =>
    operations.map((operation) => operation.getAttribute('aria-label'))
  );
}

async function dismissOnboarding(page: Page) {
  const onboarding = page.getByRole('dialog', { name: 'Thanks for trying Wire EDM Workbench' });
  if (await onboarding.isVisible()) await onboarding.getByRole('button', { name: 'Go Build!' }).click();
}

function twoContourDxf() {
  return `0
SECTION
2
ENTITIES
${rectangleEntities(0, 0, 20, 10)}
${rectangleEntities(40, 10, 18, 12)}
0
ENDSEC
0
EOF
`;
}

function rectangleEntities(x: number, y: number, width: number, height: number) {
  const points = [[x, y], [x + width, y], [x + width, y + height], [x, y + height], [x, y]];
  return points.slice(0, -1).map((point, index) => {
    const next = points[index + 1];
    return `0
LINE
8
CUT
10
${point[0]}
20
${point[1]}
11
${next[0]}
21
${next[1]}`;
  }).join('\n');
}
