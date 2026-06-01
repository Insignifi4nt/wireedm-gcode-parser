import { expect, test } from '@playwright/test';

test('editor exposes functional groups as dockable and floating workspace panels', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');

  await page
    .locator('input[aria-label="DXF file"]')
    .setInputFiles({
      name: 'workspace-panels.dxf',
      mimeType: 'application/dxf',
      buffer: Buffer.from(rectangleDxf())
    });

  await expect(page.locator('[data-editor-workspace-panel="path-summary"]')).toBeVisible();
  await expect(page.locator('[data-editor-workspace-panel="path-actions"]')).toBeVisible();
  await expect(page.locator('[data-editor-workspace-panel="path-diagnostics"]')).toBeVisible();
  await expect(page.locator('[data-editor-workspace-panel="cut-sequence"]')).toBeVisible();
  await expect(page.locator('[data-editor-workspace-panel="contour-tree"]')).toBeVisible();
  await expect(page.locator('[data-editor-workspace-panel="position"]')).toBeVisible();
  await expect(page.locator('[data-editor-workspace-panel="statistics"]')).toBeVisible();
  await expect(page.locator('[data-editor-workspace-panel="machine"]')).toBeVisible();
  await expect(page.locator('[data-editor-workspace-panel="measurement"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Float UPID Path Navigator' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Float Inspector' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Float / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Dock / })).toHaveCount(0);

  await page.locator('[data-editor-panel-toolbar] summary').click();
  await expect(page.locator('[data-editor-panel-menu-group="path"]')).toBeVisible();
  await expect(page.locator('[data-editor-panel-menu-group="inspection"]')).toBeVisible();
  await expect(page.locator('[data-editor-panel-menu-group="machine"]')).toBeVisible();
  await expect(page.locator('[data-editor-panel-menu-group="measurement"]')).toBeVisible();
  await page.locator('[data-editor-panel-toolbar] summary').click();

  await expect(page.locator('[data-editor-workspace-panel="path-diagnostics"]')).toHaveAttribute(
    'data-editor-workspace-panel-placement',
    'floating'
  );
  await expect(page.locator('[data-editor-workspace-panel="measurement"]')).toHaveAttribute(
    'data-editor-workspace-panel-placement',
    'floating'
  );

  await dragHandleToDock(page, 'path-diagnostics', 'right');
  await expect(page.locator('[data-editor-workspace-panel="path-diagnostics"]')).toHaveAttribute(
    'data-editor-workspace-panel-placement',
    'docked-right'
  );
  await expect(page.locator('[data-editor-workspace-panel="path-diagnostics"]')).toHaveAttribute(
    'data-editor-workspace-panel-side',
    'right'
  );

  await dragHandleToDock(page, 'measurement', 'left');
  await expect(page.locator('[data-editor-workspace-panel="measurement"]')).toHaveAttribute(
    'data-editor-workspace-panel-placement',
    'docked-left'
  );
  await expect(page.locator('[data-editor-workspace-panel="measurement"]')).toHaveAttribute(
    'data-editor-workspace-panel-side',
    'left'
  );

  await page.locator('[data-editor-panel-toolbar] summary').click();
  await page.locator('[data-editor-panel-menu-item="path-diagnostics"]').click();
  await expect(page.locator('[data-editor-workspace-panel="path-diagnostics"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show Path Diagnostics' })).toBeVisible();
  await page.locator('[data-editor-panel-menu-item="path-diagnostics"]').click();
  await expect(page.locator('[data-editor-workspace-panel="path-diagnostics"]')).toHaveAttribute(
    'data-editor-workspace-panel-placement',
    'floating'
  );
});

async function dragHandleToDock(
  page: import('@playwright/test').Page,
  panelId: string,
  side: 'left' | 'right'
) {
  const handle = page.locator(`[data-editor-workspace-panel-handle="${panelId}"]`);
  const dock = page.locator(`[data-editor-panel-dock-zone="${side}"]`);
  const handleBox = await handle.boundingBox();
  const dockBox = await dock.boundingBox();

  expect(handleBox).not.toBeNull();
  expect(dockBox).not.toBeNull();
  if (!handleBox || !dockBox) return;

  await page.mouse.move(handleBox.x + Math.min(12, handleBox.width / 2), handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(dockBox.x + dockBox.width / 2, dockBox.y + Math.min(80, dockBox.height / 2), {
    steps: 8
  });
  await page.mouse.up();
}

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
