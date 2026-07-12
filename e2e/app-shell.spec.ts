import { expect, test } from '@playwright/test';

async function openReadyWorkbench(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.locator('input[aria-label="DXF file"]')).toBeEnabled();
  await expect(page.locator('input[aria-label="Machine program file"]')).toBeEnabled();
}

test('loads the workbench dashboard in a real browser', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openReadyWorkbench(page);

  await expect(page).toHaveTitle(/Wire EDM Workbench/);
  await expect(page.locator('[data-app-shell]')).toBeVisible();
  await expect(page.locator('[data-workbench-page]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Workbench' })).toBeVisible();
  await expect(page.locator('[data-project-library]')).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Import DXF as Path Project/i })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Open Machine Program/i })).toBeVisible();
  await expect(page.locator('[data-app-status-bar]')).toBeVisible();
  await expect(page.getByText('flange-slot')).toHaveCount(0);
  await expect(page.getByText('repair-job')).toHaveCount(0);
  await expect(page.getByText(/Latest DXF Import/i)).toHaveCount(0);

  await expect(page.locator('[data-app-header]')).toHaveCSS('height', '40px');
  await expect(page.locator('[data-app-status-bar]')).toHaveCSS('height', '24px');
  await expect(page.locator('body')).toHaveCSS('background-image', 'none');
  await expect(page.locator('[data-workbench-scroll-region]')).toHaveCSS(
    'scrollbar-width',
    'thin'
  );

  const workbenchFont = await page
    .getByRole('heading', { name: 'Workbench' })
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
