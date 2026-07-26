import { expect, test } from '@playwright/test';

import { confirmPendingDxfImport } from './dxf-import';

async function openReadyWorkbench(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.locator('input[aria-label="DXF file"]')).toBeEnabled();
}

async function importPathProject(page: import('@playwright/test').Page) {
  await page.locator('input[aria-label="DXF file"]').setInputFiles({
    name: 'workspace-panels.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from(rectangleDxf())
  });
  await confirmPendingDxfImport(page);

  const closeOnboarding = page.getByRole('button', { name: 'Close onboarding' });
  if (await closeOnboarding.isVisible()) await closeOnboarding.click();
}

test('editor anchors a path project in the UPID rail and mounts only an active right workflow dock', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await openReadyWorkbench(page);
  await importPathProject(page);

  await expect(page.getByRole('tree', { name: 'UPID program sequence' })).toBeVisible();
  await expect(page.locator('[data-editor-empty-dock]')).toHaveCount(0);
  await expect(page.locator('[data-editor-panel-dock-zone="right"]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Entry / lead-in · None' }).click();
  await expect(page.locator('[data-editor-floating-panel="entry-exit"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dock Entry / Exit right' })).toBeEnabled();

  await page.getByRole('button', { name: 'Dock Entry / Exit right' }).click();
  await expect(page.locator('[data-editor-panel-dock-zone="right"]')).toBeVisible();
  await expect(page.locator('[data-editor-workspace-panel="entry-exit"]')).toHaveAttribute(
    'data-editor-workspace-panel-placement',
    'docked-right'
  );
  await expect(page.locator('[data-editor-main-grid]')).toHaveAttribute('data-has-active-right-dock', 'true');

  await page.getByRole('button', { name: 'Hide Entry / Exit' }).click();
  await expect(page.locator('[data-editor-panel-dock-zone="right"]')).toHaveCount(0);
  await expect(page.locator('[data-editor-main-grid]')).toHaveAttribute('data-has-active-right-dock', 'false');
});

function rectangleDxf() {
  return `0
SECTION
2
HEADER
0
ENDSEC
0
SECTION
2
ENTITIES
0
LWPOLYLINE
8
CUT
90
4
70
1
10
0
20
0
10
10
20
0
10
10
20
10
10
0
20
10
0
ENDSEC
0
EOF
`;
}
