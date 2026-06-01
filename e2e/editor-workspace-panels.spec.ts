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

  await expect(page.locator('[data-editor-workspace-panel]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Float UPID Path Navigator' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Float Inspector' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Float / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Dock / })).toHaveCount(0);

  await page.locator('[data-editor-panel-toolbar] summary').click();
  await expect(page.locator('[data-editor-panel-menu-group="path"]')).toBeVisible();
  await expect(page.locator('[data-editor-panel-menu-item="path-transform"]')).toBeVisible();
  await expect(page.locator('[data-editor-panel-menu-group="inspection"]')).toBeVisible();
  await expect(page.locator('[data-editor-panel-menu-group="machine"]')).toBeVisible();
  await expect(page.locator('[data-editor-panel-menu-group="measurement"]')).toBeVisible();
  await page.locator('[data-editor-panel-toolbar] summary').click();

  await showPanels(page, ['path-summary', 'path-actions', 'path-transform', 'path-diagnostics', 'measurement']);
  await expect(page.locator('[data-editor-workspace-panel="path-summary"]')).toBeVisible();
  await expect(page.locator('[data-editor-workspace-panel="path-actions"]')).toBeVisible();
  await expect(page.locator('[data-editor-workspace-panel="path-transform"]')).toBeVisible();
  await expect(page.locator('[data-editor-workspace-panel="path-diagnostics"]')).toBeVisible();
  await expect(page.locator('[data-editor-workspace-panel="measurement"]')).toBeVisible();

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

test('editor panel menu explains endpoint topology before opening it', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 760 });
  await page.goto('/');

  await page
    .locator('input[aria-label="DXF file"]')
    .setInputFiles({
      name: 'endpoint-topology-discovery.dxf',
      mimeType: 'application/dxf',
      buffer: Buffer.from(rectangleDxf())
    });

  await page.locator('[data-editor-panel-toolbar] summary').click();
  const topologyItem = page.locator('[data-editor-panel-menu-item="endpoint-topology"]');
  await expect(topologyItem).toBeVisible();
  await expect(topologyItem.locator('[data-editor-panel-menu-item-description]')).toContainText(
    'endpoint joins'
  );
  await expect(topologyItem.locator('[data-editor-panel-menu-item-status]')).toContainText('off');

  await topologyItem.click();
  await expect(page.locator('[data-editor-workspace-panel="endpoint-topology"]')).toBeVisible();
  await expect(page.locator('[data-upid-endpoint-topology-help]')).toContainText(
    'pairs segment starts and ends'
  );
});

test('editor contour tree labels contours, segments, and endpoint handles clearly', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 760 });
  await page.goto('/');

  await page
    .locator('input[aria-label="DXF file"]')
    .setInputFiles({
      name: 'contour-tree-clarity.dxf',
      mimeType: 'application/dxf',
      buffer: Buffer.from(rectangleDxf())
    });

  await showPanels(page, ['contour-tree']);

  await expect(page.locator('[data-upid-contour-tree-help]')).toContainText(
    'Hover or select any row to cross-highlight the canvas'
  );
  await expect(page.locator('[data-upid-contour-tree-legend="contour"]')).toContainText('whole cut loop');
  await expect(page.locator('[data-upid-contour-tree-legend="segment"]')).toContainText('line or arc');
  await expect(page.locator('[data-upid-contour-tree-legend="endpoint"]')).toContainText('start/end handle');

  const contourRow = page.locator('[data-upid-contour-row]').first();
  await expect(contourRow.locator('[data-upid-contour-field="role"]')).toContainText('Role');
  await expect(contourRow.locator('[data-upid-contour-field="order"]')).toContainText('Cut order');
  await expect(contourRow.locator('[data-upid-contour-field="segments"]')).toContainText('Segments');

  await contourRow.click();
  const segmentRow = page.locator('[data-upid-segment-row]').first();
  await expect(segmentRow.locator('[data-upid-segment-field="from"]')).toContainText('From');
  await expect(segmentRow.locator('[data-upid-segment-field="to"]')).toContainText('To');
  await expect(segmentRow.locator('[data-upid-segment-field="length"]')).toContainText('Length');
  await expect(page.locator('[data-upid-point-row]').first().locator('[data-upid-point-field="role"]')).toContainText(
    'Endpoint'
  );
});

test('editor opens contour tree and endpoint topology without covering each other', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 760 });
  await page.goto('/');

  await page
    .locator('input[aria-label="DXF file"]')
    .setInputFiles({
      name: 'tree-topology-placement.dxf',
      mimeType: 'application/dxf',
      buffer: Buffer.from(rectangleDxf())
    });

  await showPanels(page, ['contour-tree', 'endpoint-topology']);

  const treeBox = await page.locator('[data-editor-floating-panel="contour-tree"]').boundingBox();
  const topologyBox = await page.locator('[data-editor-floating-panel="endpoint-topology"]').boundingBox();
  expect(treeBox).not.toBeNull();
  expect(topologyBox).not.toBeNull();
  if (!treeBox || !topologyBox) return;

  const overlaps =
    treeBox.x < topologyBox.x + topologyBox.width &&
    treeBox.x + treeBox.width > topologyBox.x &&
    treeBox.y < topologyBox.y + topologyBox.height &&
    treeBox.y + treeBox.height > topologyBox.y;

  expect(overlaps).toBe(false);
});

test('editor translates selected path geometry through the Transform panel', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 760 });
  await page.goto('/');

  await page
    .locator('input[aria-label="DXF file"]')
    .setInputFiles({
      name: 'transform-panel.dxf',
      mimeType: 'application/dxf',
      buffer: Buffer.from(rectangleDxf())
    });

  await showPanels(page, ['path-transform', 'contour-tree', 'statistics']);
  await page.locator('[data-upid-contour-row]').first().click();
  await expect(page.locator('[data-upid-transform-target]')).toContainText('Exterior');
  await hidePanels(page, ['contour-tree']);

  await page.locator('[data-upid-transform-delta-x]').fill('3');
  await page.locator('[data-upid-transform-delta-y]').fill('-4');
  await page.locator('[data-upid-transform-apply]').click();

  await expect(page.locator('[data-upid-selected="start"]')).toHaveText('3.000, -4.000');
  await expect(page.locator('[data-upid-selected="end"]')).toHaveText('3.000, -4.000');

  await showPanels(page, ['contour-tree']);
  await page.locator('[data-upid-segment-row]').first().click();
  await hidePanels(page, ['contour-tree']);
  await page.locator('[data-upid-transform-delta-x]').fill('2');
  await page.locator('[data-upid-transform-delta-y]').fill('1');
  await page.locator('[data-upid-transform-apply]').click();

  await expect(page.locator('[data-upid-selected-segment="true"]')).toContainText('5.000, -3.000');
  await expect(page.locator('[data-upid-selected-segment="true"]')).toContainText('15.000, -3.000');
});

test('editor moves a selected contour center to a precise coordinate', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 760 });
  await page.goto('/');

  await page
    .locator('input[aria-label="DXF file"]')
    .setInputFiles({
      name: 'contour-center-transform.dxf',
      mimeType: 'application/dxf',
      buffer: Buffer.from(rectangleDxf())
    });

  await showPanels(page, ['path-transform', 'contour-tree', 'statistics']);
  await page.locator('[data-upid-contour-row]').first().click();
  await hidePanels(page, ['contour-tree']);

  await expect(page.locator('[data-upid-transform-selection-center-current]')).toHaveText('5.000, 5.000');

  await page.locator('[data-upid-transform-selection-center-x]').fill('0');
  await page.locator('[data-upid-transform-selection-center-y]').fill('0');
  await page.locator('[data-upid-transform-selection-center-apply]').click();

  await expect(page.locator('[data-upid-selected="start"]')).toHaveText('-5.000, -5.000');
  await expect(page.locator('[data-upid-transform-selection-center-current]')).toHaveText('0.000, 0.000');
});

test('editor moves a selected arc center to the latest measurement point', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 760 });
  await page.goto('/');

  await page
    .locator('input[aria-label="DXF file"]')
    .setInputFiles({
      name: 'arc-center-transform.dxf',
      mimeType: 'application/dxf',
      buffer: Buffer.from(arcDxf())
    });

  await showPanels(page, ['path-transform', 'contour-tree', 'measurement']);
  await page.getByLabel('Measurement point X').fill('12');
  await page.getByLabel('Measurement point Y').fill('-8');
  await page.getByRole('button', { name: 'Add Point' }).click();

  await page.locator('[data-upid-segment-row]').first().click();
  await expect(page.locator('[data-upid-transform-center-current]')).toHaveText('0.000, 0.000');

  await hidePanels(page, ['contour-tree']);
  await page.locator('[data-upid-transform-center-use-latest]').click();
  await expect(page.locator('[data-upid-transform-center-x]')).toHaveValue('12.000');
  await expect(page.locator('[data-upid-transform-center-y]')).toHaveValue('-8.000');

  await page.locator('[data-upid-transform-center-apply]').click();

  await expect(page.locator('[data-upid-transform-center-current]')).toHaveText('12.000, -8.000');
});

test('editor drags selected contour geometry directly on the canvas', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 760 });
  await page.goto('/');

  await page
    .locator('input[aria-label="DXF file"]')
    .setInputFiles({
      name: 'canvas-drag-transform.dxf',
      mimeType: 'application/dxf',
      buffer: Buffer.from(rectangleDxf())
    });

  await showPanels(page, ['contour-tree', 'statistics']);
  await page.locator('[data-upid-contour-row]').first().click();
  await hidePanels(page, ['contour-tree']);

  await expect(page.locator('[data-upid-selected="start"]')).toHaveText('0.000, 0.000');

  const selectedPath = page
    .locator('[data-preview-selected="true"][data-preview-source="path-document"][data-type="cut"]')
    .first();
  const box = await selectedPath.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect(page.locator('[data-upid-selected="start"]')).not.toHaveText('0.000, 0.000');
});

test('editor defaults canvas clicks to select mode before explicit point placement', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 760 });
  await page.goto('/');

  await page
    .locator('input[aria-label="DXF file"]')
    .setInputFiles({
      name: 'canvas-select-mode.dxf',
      mimeType: 'application/dxf',
      buffer: Buffer.from(rectangleDxf())
    });

  await showPanels(page, ['measurement']);

  const preview = page.locator('svg[aria-label="UPID path preview"]');
  const previewBox = await preview.boundingBox();
  expect(previewBox).not.toBeNull();
  if (!previewBox) return;

  await page.mouse.click(previewBox.x + previewBox.width / 2, previewBox.y + previewBox.height / 2);
  await expect(page.locator('[data-measurement-point-row="1"]')).toHaveCount(0);
  await expect(page.locator('[data-editor-preview-mouse-mode-select]')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('[data-editor-preview-mouse-mode-point]').click();
  await expect(page.locator('[data-editor-preview-mouse-mode-point]')).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(previewBox.x + previewBox.width / 2, previewBox.y + previewBox.height / 2);

  await expect(page.locator('[data-measurement-point-row="1"]')).toBeVisible();
});

async function hidePanels(page: import('@playwright/test').Page, panelIds: string[]) {
  await setPanelVisibility(page, panelIds, false);
}

async function showPanels(page: import('@playwright/test').Page, panelIds: string[]) {
  await setPanelVisibility(page, panelIds, true);
}

async function setPanelVisibility(
  page: import('@playwright/test').Page,
  panelIds: string[],
  visible: boolean
) {
  await page.locator('[data-editor-panel-toolbar] summary').click();
  for (const panelId of panelIds) {
    const item = page.locator(`[data-editor-panel-menu-item="${panelId}"]`);
    const label = await item.getAttribute('aria-label');
    if (label?.startsWith(visible ? 'Show' : 'Hide')) {
      await item.click();
    }
  }
  await page.locator('[data-editor-panel-toolbar] summary').click();
}

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

function arcDxf() {
  return `0
SECTION
2
ENTITIES
0
ARC
8
CUT
10
0
20
0
40
5
50
0
51
90
0
ENDSEC
0
EOF
`;
}
