import { expect, test, type Page } from '@playwright/test';

import { clearWorkbenchCache } from './fixtures/workbench-cache';
import { confirmPendingDxfImport } from './dxf-import';

test('round-trips an exported UPID through a clean browser cache with execution order and provenance', async ({ page }) => {
  await importTwoContourDxf(page, 'tree-portable-round-trip.dxf');
  const beforeOrder = await programOperationLabels(page);
  await page.getByRole('button', { name: 'Back to Dashboard' }).click();
  await captureNextTextDownload(page);

  const exportButton = page.locator('[data-project-row][data-project-source="dxf"]')
    .getByRole('button', { name: /Export UPID project/ });
  await exportButton.click();
  await page.getByRole('menuitem', { name: 'Export', exact: true }).click();
  await page.waitForFunction(() => (
    typeof (window as Window & { __capturedTextDownload?: { text?: string } }).__capturedTextDownload?.text === 'string'
  ));
  const captured = await page.evaluate(() => (
    (window as Window & { __capturedTextDownload: { name: string; text: string } }).__capturedTextDownload
  ));
  const portableProject = Buffer.from(captured.text);
  expect(captured.name).toMatch(/\.upid\.json$/);
  expect(portableProject.toString('utf8').trimStart()).toMatch(/^\{/);

  await clearWorkbenchCache(page);
  await expect(page.locator('[data-project-row]')).toHaveCount(0);
  await page.getByRole('button', { name: 'More path project import options' }).click();
  await page.locator('input[aria-label="UPID path project file"]').setInputFiles({
    name: 'tree-portable-round-trip.upid.json',
    mimeType: 'application/json',
    buffer: portableProject
  });
  await expect(page.locator('[data-editor-context="path-project"]')).toBeVisible();
  await expect(page.locator('[data-editor-status-cursor]')).toContainText('mm');
  await expect(programOperationLabels(page)).resolves.toEqual(beforeOrder);
  await page.getByRole('button', { name: 'Back to Dashboard' }).click();
  await expect(page.locator('[data-project-row][data-project-source="upid"]')).toHaveCount(1);
});

async function captureNextTextDownload(page: Page) {
  await page.evaluate(() => {
    const capture: { name: string; text?: string } = { name: '' };
    (window as Window & { __capturedTextDownload?: typeof capture }).__capturedTextDownload = capture;
    const createObjectUrl = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (object: Blob | MediaSource) => {
      if (object instanceof Blob) void object.text().then((text) => { capture.text = text; });
      return createObjectUrl(object);
    };
    HTMLAnchorElement.prototype.click = function captureDownloadClick() {
      capture.name = this.download;
    };
  });
}

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
  await expect(page.locator('[data-editor-document-state]')).toHaveText('Saved');
  await page.reload();
  await openOnlyProject(page);
  await expect(page.locator('[data-editor-context="machine-program"]')).toBeVisible();
  await expect(page.getByRole('complementary', { name: /UPID rail/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Machining menu' })).toHaveCount(0);
  await page.locator('details[data-editor-code-section="text"] summary').click();
  await expect(page.getByLabel('Program editor')).toHaveValue(/G1 X24 Y0/);

  await captureNextTextDownload(page);
  await page.getByRole('button', { name: 'Export normalized ISO' }).click();
  await page.waitForFunction(() => (
    typeof (window as Window & { __capturedTextDownload?: { text?: string } }).__capturedTextDownload?.text === 'string'
  ));
  const captured = await page.evaluate(() => (
    (window as Window & { __capturedTextDownload: { name: string; text: string } }).__capturedTextDownload
  ));
  expect(captured.name).toMatch(/^normalized-\d{4}-\d{2}-\d{2}\.iso$/);
  expect(captured.text).toMatch(/X24(?:\.0+)?(?:\s|$)/);
});

async function openReadyWorkbench(page: Page) {
  await page.goto('/');
  await expect(page.locator('input[aria-label="DXF file"]')).toBeEnabled();
  await expect(page.locator('input[aria-label="Machine program file"]')).toBeEnabled();
  await dismissOnboarding(page);
}

async function importTwoContourDxf(page: Page, name: string) {
  await openReadyWorkbench(page);
  await page.locator('input[aria-label="DXF file"]').setInputFiles({
    name,
    mimeType: 'application/dxf',
    buffer: Buffer.from(twoContourDxf())
  });
  await confirmPendingDxfImport(page);
  await dismissOnboarding(page);
  await expect(page.getByRole('tree', { name: 'UPID execution plan' })).toBeVisible();
}

async function openOnlyProject(page: Page) {
  await expect(page.locator('[data-project-row]')).toHaveCount(1);
  await page.locator('[data-project-row]').getByRole('button', { name: /Open project .* in editor/ }).click();
}

async function programOperationLabels(page: Page) {
  return await page.locator(
    'li[data-tree-key="section:program"] > ul > li[role="treeitem"][data-tree-key^="operation:"]'
  ).evaluateAll((operations) =>
    operations.map((operation) => operation.querySelector<HTMLElement>(':scope > div span[title]')?.innerText)
  );
}

async function dismissOnboarding(page: Page) {
  const onboarding = page.getByRole('dialog', { name: 'Thanks for trying Wire EDM Workbench' });
  await onboarding.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => undefined);
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
