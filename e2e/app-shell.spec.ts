import { expect, test } from '@playwright/test';

import { confirmPendingDxfImport } from './dxf-import';

async function openReadyWorkbench(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.locator('input[aria-label="DXF file"]')).toBeEnabled();
  await expect(page.locator('input[aria-label="Machine program file"]')).toBeEnabled();
  await dismissOnboarding(page);
}

test('loads the workbench dashboard in a real browser', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openReadyWorkbench(page);

  await expect(page).toHaveTitle(/Wire EDM Workbench/);
  await expect(page.locator('[data-app-shell]')).toBeVisible();
  await expect(page.locator('[data-workbench-page]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Project Library', exact: true })).toBeVisible();
  await expect(page.locator('[data-project-library]')).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Import DXF as Path Project/i })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Open Machine Program/i })).toBeVisible();
  await expect(page.locator('[data-storage-status]')).toHaveText('Browser cache active');
  await expect(page.getByText('flange-slot')).toHaveCount(0);
  await expect(page.getByText('repair-job')).toHaveCount(0);
  await expect(page.getByText(/Latest DXF Import/i)).toHaveCount(0);

  await expect(page.locator('[data-app-header]')).toHaveCSS('height', '40px');
  const workspaceBox = await page.locator('[data-app-workspace-grid]').boundingBox();
  expect(workspaceBox).not.toBeNull();
  expect(workspaceBox!.y + workspaceBox!.height).toBe(900);
  await expect(page.locator('body')).toHaveCSS('background-image', 'none');
  await expect(page.locator('[data-workbench-scroll-region]')).toHaveCSS(
    'scrollbar-width',
    'thin'
  );

  const workbenchFont = await page
    .getByRole('heading', { name: 'Project Library', exact: true })
    .evaluate((element) => getComputedStyle(element).fontFamily.toLowerCase());
  expect(workbenchFont).not.toContain('mono');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
});

test('keeps the 1024px workbench in one readable column without clipping', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await openReadyWorkbench(page);

  await page.locator('input[aria-label="DXF file"]').setInputFiles({
    name: 'workbench-library.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from(rectangleDxf())
  });
  await confirmPendingDxfImport(page);
  await dismissOnboarding(page);
  await page.getByRole('button', { name: /dashboard/i }).click();
  const machineProgramInput = page.locator('input[aria-label="Machine program file"]');
  await expect(machineProgramInput).toBeEnabled();
  await machineProgramInput.setInputFiles({
    name: 'workbench-library.nc',
    mimeType: 'text/plain',
    buffer: Buffer.from('G90\nG0 X0 Y0\nG1 X10 Y10')
  });
  await page.getByRole('button', { name: /dashboard/i }).click();

  const library = page.locator('[data-project-library]');
  const start = page.getByRole('region', { name: 'Start work' });
  await expect(page.locator('[data-workbench-page]')).toBeVisible();
  await expect(library).toBeVisible();
  await expect(start).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Import DXF as Path Project/i })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Open Machine Program/i })).toBeVisible();

  const [libraryBox, startBox] = await Promise.all([library.boundingBox(), start.boundingBox()]);
  expect(libraryBox).not.toBeNull();
  expect(startBox).not.toBeNull();
  expect(startBox!.y).toBeGreaterThanOrEqual(libraryBox!.y + libraryBox!.height);
  expect(
    await library.evaluate((element) => element.scrollHeight <= element.clientHeight)
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024);
  await expect(page.locator('[data-workbench-scroll-region]')).toHaveCSS(
    'scrollbar-width',
    'thin'
  );
});

test('keeps a populated compact library above its import controls', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 800 });
  await openReadyWorkbench(page);
  for (let index = 1; index <= 12; index++) {
    await page.getByLabel('Machine program file', { exact: true }).setInputFiles({
      name: `compact-library-${index}.nc`,
      mimeType: 'text/plain',
      buffer: Buffer.from('G90\nG0 X0 Y0\nG1 X10 Y10')
    });
    await page.getByRole('button', { name: 'Back to Dashboard', exact: true }).click();
  }

  const library = page.locator('[data-project-library]');
  const rows = page.getByRole('list', { name: 'Project list', exact: true }).getByRole('listitem');
  await expect(rows).toHaveCount(12);
  const lastRow = await rows.last().boundingBox();
  const libraryBox = await library.boundingBox();
  const startBox = await page.getByRole('region', { name: 'Start work', exact: true }).boundingBox();
  expect(lastRow).not.toBeNull();
  expect(libraryBox).not.toBeNull();
  expect(startBox).not.toBeNull();
  expect(lastRow!.y + lastRow!.height).toBeLessThanOrEqual(libraryBox!.y + libraryBox!.height);
  expect(startBox!.y).toBeGreaterThanOrEqual(libraryBox!.y + libraryBox!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(640);
  await page.getByRole('button', { name: 'Open Machine Program', exact: true }).click();
});

function rectangleDxf() {
  return `0
SECTION
2
ENTITIES
0
LINE
10
0
20
0
11
10
21
0
0
ENDSEC
0
EOF
`;
}

async function dismissOnboarding(page: import('@playwright/test').Page) {
  const dialog = page.getByRole('dialog', { name: 'Thanks for trying Wire EDM Workbench' });
  await dialog.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => undefined);
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Go Build!' }).click();
}
