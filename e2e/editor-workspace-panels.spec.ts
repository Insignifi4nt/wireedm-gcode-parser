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
  await expect(page.locator('[data-app-shell]')).toHaveAttribute('data-sidebar-collapsed', 'true');
  await expect(page.locator('[data-editor-panel-dock-zone="right"]')).toHaveAttribute(
    'data-editor-panel-dock-zone-collapsed',
    'true'
  );
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

  await page.getByRole('button', { name: 'Expand workbench sidebar' }).click();
  await expect(page.locator('[data-app-shell]')).toHaveAttribute('data-sidebar-collapsed', 'false');
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
  await expect(topologyItem.locator('[data-editor-panel-menu-item-description]')).toContainText(
    'join map'
  );
  await expect(topologyItem.locator('[data-editor-panel-menu-item-status]')).toContainText('off');

  await topologyItem.click();
  await expect(page.locator('[data-editor-workspace-panel="endpoint-topology"]')).toBeVisible();
  await expect(page.locator('[data-upid-endpoint-topology-title]')).toContainText('Endpoint Join Map');
  await expect(page.locator('[data-upid-endpoint-topology-summary-label="open-ends"]')).toContainText(
    'Open chain clues'
  );
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
  await expect(contourRow).toHaveAttribute('data-upid-tree-row-kind', 'contour');
  await expect(contourRow).toHaveAttribute('data-upid-tree-row-level', '0');
  await expect(contourRow.locator('[data-upid-tree-kind-label]')).toContainText('Contour');
  await expect(contourRow.locator('[data-upid-tree-action-hint]')).toContainText('selects whole contour');
  await expect(contourRow.locator('[data-upid-contour-field="role"]')).toContainText('Role');
  await expect(contourRow.locator('[data-upid-contour-field="order"]')).toContainText('Cut order');
  await expect(contourRow.locator('[data-upid-contour-field="segments"]')).toContainText('Segments');

  await contourRow.click();
  const segmentRow = page.locator('[data-upid-segment-row]').first();
  await expect(segmentRow).toHaveAttribute('data-upid-tree-row-kind', 'segment');
  await expect(segmentRow).toHaveAttribute('data-upid-tree-row-level', '1');
  await expect(segmentRow.locator('[data-upid-tree-kind-label]')).toContainText('Segment');
  await expect(segmentRow.locator('[data-upid-tree-action-hint]')).toContainText('selects one segment');
  await expect(segmentRow.locator('[data-upid-segment-field="from"]')).toContainText('From');
  await expect(segmentRow.locator('[data-upid-segment-field="to"]')).toContainText('To');
  await expect(segmentRow.locator('[data-upid-segment-field="length"]')).toContainText('Length');
  const pointRow = page.locator('[data-upid-point-row]').first();
  await expect(pointRow).toHaveAttribute('data-upid-tree-row-kind', 'endpoint');
  await expect(pointRow).toHaveAttribute('data-upid-tree-row-level', '2');
  await expect(pointRow.locator('[data-upid-tree-kind-label]')).toContainText('Endpoint');
  await expect(pointRow.locator('[data-upid-tree-action-hint]')).toContainText('selects a start/end handle');
  await expect(pointRow.locator('[data-upid-point-field="role"]')).toContainText('Endpoint');
});

test('editor contour tree exposes hierarchy rails and endpoint topology from the tree context', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 760 });
  await page.goto('/');

  await page
    .locator('input[aria-label="DXF file"]')
    .setInputFiles({
      name: 'contour-tree-topology-map.dxf',
      mimeType: 'application/dxf',
      buffer: Buffer.from(rectangleDxf())
    });

  await showPanels(page, ['contour-tree']);
  await expect(page.locator('[data-editor-workspace-panel="endpoint-topology"]')).toHaveCount(0);

  const treeMap = page.locator('[data-upid-contour-tree-map]');
  await expect(treeMap).toContainText('Contour');
  await expect(treeMap).toContainText('Segment');
  await expect(treeMap).toContainText('Endpoint');
  await expect(treeMap.locator('[data-upid-contour-tree-map-step="topology"]')).toContainText(
    'Endpoint Join Map'
  );

  await expect(page.locator('[data-upid-tree-depth-rail="contour"]').first()).toBeVisible();
  await expect(page.locator('[data-upid-tree-depth-rail="segment"]').first()).toBeVisible();
  await expect(page.locator('[data-upid-tree-depth-rail="endpoint"]').first()).toBeVisible();
  await expect(page.locator('[data-upid-tree-depth-label="contour"]').first()).toContainText('Contour');
  await expect(page.locator('[data-upid-tree-depth-label="segment"]').first()).toContainText('Segment');
  await expect(page.locator('[data-upid-tree-depth-label="endpoint"]').first()).toContainText('Endpoint');

  await page.getByRole('button', { name: 'Open Endpoint Join Map from Contour Tree' }).click();
  await expect(page.locator('[data-editor-workspace-panel="endpoint-topology"]')).toBeVisible();
  await expect(page.locator('[data-upid-endpoint-topology-title]')).toContainText('Endpoint Join Map');
});

test('editor contour tree rows cross-highlight and select canvas geometry', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 760 });
  await page.goto('/');

  await page
    .locator('input[aria-label="DXF file"]')
    .setInputFiles({
      name: 'contour-tree-cross-highlight.dxf',
      mimeType: 'application/dxf',
      buffer: Buffer.from(rectangleDxf())
    });

  await showPanels(page, ['contour-tree']);

  const contourRow = page.locator('[data-upid-contour-row]').first();
  const operationId = await contourRow.getAttribute('data-upid-operation-id');
  expect(operationId).toBeTruthy();

  await contourRow.hover();
  await expect(
    page.locator(`[data-preview-operation="${operationId}"][data-preview-hovered="true"]`)
  ).toHaveCount(4);

  await contourRow.click();
  await expect(contourRow).toHaveAttribute('data-upid-selected', 'true');
  await expect(
    page.locator(`[data-preview-operation="${operationId}"][data-preview-selected="true"]`)
  ).toHaveCount(4);

  const segmentRow = page.locator('[data-upid-segment-row]').first();
  const segmentId = await segmentRow.getAttribute('data-upid-segment-id');
  expect(segmentId).toBeTruthy();

  await segmentRow.hover();
  await expect(
    page.locator(
      `[data-preview-operation="${operationId}"][data-preview-segment="${segmentId}"][data-preview-hovered="true"]`
    )
  ).toHaveCount(1);

  await segmentRow.click();
  await expect(segmentRow).toHaveAttribute('data-upid-selected', 'true');
  await expect(
    page.locator(
      `[data-preview-operation="${operationId}"][data-preview-segment="${segmentId}"][data-preview-selected="true"]`
    )
  ).toHaveCount(1);

  const endpointRow = page.locator('[data-upid-point-row][data-upid-point-role="start"]').first();
  await endpointRow.hover();
  await expect(
    page.locator(
      `[data-preview-operation="${operationId}"][data-preview-segment="${segmentId}"][data-preview-point-role="start"][data-preview-hovered="true"]`
    )
  ).toHaveCount(1);

  await endpointRow.locator('button[aria-pressed]').click();
  await expect(endpointRow).toHaveAttribute('data-upid-selected', 'true');
  await expect(
    page.locator(
      `[data-preview-operation="${operationId}"][data-preview-segment="${segmentId}"][data-preview-point-role="start"][data-preview-selected="true"]`
    )
  ).toHaveCount(1);
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

test('editor opens common floating workspace panels in readable non-overlapping positions', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 760 });
  await page.goto('/');

  await page
    .locator('input[aria-label="DXF file"]')
    .setInputFiles({
      name: 'common-panel-placement.dxf',
      mimeType: 'application/dxf',
      buffer: Buffer.from(rectangleDxf())
    });

  await showPanels(page, ['path-transform', 'contour-tree', 'statistics']);

  const panelIds = ['path-transform', 'contour-tree', 'statistics'];
  const boxes = await readFloatingPanelBoxes(page, panelIds);

  for (const box of boxes) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(36);
    expect(box.x + box.width).toBeLessThanOrEqual(1400);
    expect(box.y + box.height).toBeLessThanOrEqual(760);
  }

  for (let index = 0; index < boxes.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < boxes.length; compareIndex += 1) {
      expect(panelsOverlap(boxes[index], boxes[compareIndex])).toBe(false);
    }
  }
});

test('editor diagnostics explain what to inspect for an open chain', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 760 });
  await page.goto('/');

  await page
    .locator('input[aria-label="DXF file"]')
    .setInputFiles({
      name: 'open-chain-guidance.dxf',
      mimeType: 'application/dxf',
      buffer: Buffer.from(simpleLineDxf())
    });

  await showPanels(page, ['path-diagnostics']);

  const diagnosticRow = page.locator('[data-upid-diagnostic-row]').first();
  await expect(diagnosticRow).toHaveAttribute('data-upid-diagnostic-code', 'open-chain');
  await expect(diagnosticRow.locator('[data-upid-diagnostic-guidance]')).toContainText(
    'Open Endpoint Topology'
  );
  await expect(diagnosticRow.locator('[data-upid-diagnostic-guidance]')).toContainText(
    'affected start/end'
  );

  await expect(page.locator('[data-editor-workspace-panel="endpoint-topology"]')).toHaveCount(0);
  await diagnosticRow.getByRole('button', { name: 'Open Endpoint Topology' }).click();
  await expect(page.locator('[data-editor-workspace-panel="endpoint-topology"]')).toBeVisible();

  await expect(page.locator('[data-editor-workspace-panel="contour-tree"]')).toHaveCount(0);
  await diagnosticRow.getByRole('button', { name: 'Open Contour Tree' }).click();
  await expect(page.locator('[data-editor-workspace-panel="contour-tree"]')).toBeVisible();

  const boxes = await readFloatingPanelBoxes(page, [
    'path-diagnostics',
    'endpoint-topology',
    'contour-tree'
  ]);
  for (let index = 0; index < boxes.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < boxes.length; compareIndex += 1) {
      expect(panelsOverlap(boxes[index], boxes[compareIndex])).toBe(false);
    }
  }
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
  await expect(page.locator('[data-upid-transform-document-center]')).toHaveText('5.000, 5.000');
  await expect(page.locator('[data-upid-transform-origin-offset]')).toHaveText('-5.000, -5.000');
  await expect(page.locator('[data-upid-transform-document-placement-help]')).toContainText(
    'center to X0 Y0'
  );
  const transformBox = await page.locator('[data-editor-workspace-panel="path-transform"]').boundingBox();
  expect(transformBox?.height).toBeGreaterThanOrEqual(400);
  await page.locator('[data-upid-contour-row]').first().click();
  await hidePanels(page, ['contour-tree']);

  await expect(page.locator('[data-upid-transform-selection-center-current]')).toHaveText('5.000, 5.000');
  await expect(page.locator('[data-editor-command-hint]')).toContainText('Move Center to Origin');

  await page.locator('[data-upid-transform-selection-center-use-origin]').click();
  await expect(page.locator('[data-upid-transform-selection-center-x]')).toHaveValue('0.000');
  await expect(page.locator('[data-upid-transform-selection-center-y]')).toHaveValue('0.000');
  await page.locator('[data-upid-transform-selection-center-apply]').click();

  await expect(page.locator('[data-upid-selected="start"]')).toHaveText('-5.000, -5.000');
  await expect(page.locator('[data-upid-transform-selection-center-current]')).toHaveText('0.000, 0.000');
  await expect(page.locator('[data-upid-transform-document-center]')).toHaveText('0.000, 0.000');
});

test('editor transform panel shows DXF source placement metadata', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 760 });
  await page.goto('/');

  await page
    .locator('input[aria-label="DXF file"]')
    .setInputFiles({
      name: 'source-placement.dxf',
      mimeType: 'application/dxf',
      buffer: Buffer.from(placedRectangleDxf())
    });

  await showPanels(page, ['path-transform']);

  await expect(page.locator('[data-upid-transform-document-bounds]')).toHaveText(
    'X 3.000..13.000 Y 4.000..14.000'
  );
  await expect(page.locator('[data-upid-transform-source-extents]')).toHaveText(
    'X -5.000..15.000 Y -6.000..16.000'
  );
  await expect(page.locator('[data-upid-transform-source-base]')).toHaveText('1.000, 2.000');
  await expect(page.locator('[data-upid-transform-document-placement-help]')).toContainText(
    'source extents come from DXF header metadata'
  );
});

test('editor moves a selected arc center to a chosen measurement point', async ({ page }) => {
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
  await page.getByLabel('Measurement point X').fill('-4');
  await page.getByLabel('Measurement point Y').fill('6');
  await page.getByRole('button', { name: 'Add Point' }).click();

  await page.locator('[data-upid-segment-row]').first().click();
  await expect(page.locator('[data-upid-transform-center-current]')).toHaveText('0.000, 0.000');

  await hidePanels(page, ['contour-tree']);
  await expect(page.locator('[data-upid-transform-center-use-point="1"]')).toContainText('P1');
  await expect(page.locator('[data-upid-transform-center-use-point="2"]')).toContainText('P2');
  await page.locator('[data-upid-transform-center-use-point="1"]').click();
  await expect(page.locator('[data-upid-transform-center-x]')).toHaveValue('12.000');
  await expect(page.locator('[data-upid-transform-center-y]')).toHaveValue('-8.000');

  await page.locator('[data-upid-transform-center-apply]').click();

  await expect(page.locator('[data-upid-transform-center-current]')).toHaveText('12.000, -8.000');
});

test('editor drags a selected arc center directly on the canvas', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 760 });
  await page.goto('/');

  await page
    .locator('input[aria-label="DXF file"]')
    .setInputFiles({
      name: 'arc-center-canvas-drag.dxf',
      mimeType: 'application/dxf',
      buffer: Buffer.from(arcDxf())
    });

  await showPanels(page, ['contour-tree']);
  await page.locator('[data-upid-segment-row]').first().click();
  await hidePanels(page, ['contour-tree']);

  const centerHandle = page.locator('[data-preview-arc-center-handle]').first();
  await expect(centerHandle).toBeVisible();
  await expect(centerHandle).toHaveAttribute('data-preview-selected', 'true');
  await expect(centerHandle).toHaveAttribute('data-preview-arc-center', '0.000,0.000');

  const handleBox = await centerHandle.boundingBox();
  expect(handleBox).not.toBeNull();
  if (!handleBox) return;

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 120, handleBox.y + handleBox.height / 2, {
    steps: 8
  });
  await page.mouse.up();

  await showPanels(page, ['path-transform']);
  await expect(page.locator('[data-upid-transform-center-current]')).not.toHaveText('0.000, 0.000');
  await expect(page.locator('[data-preview-arc-center-handle]').first()).not.toHaveAttribute(
    'data-preview-arc-center',
    '0.000,0.000'
  );
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

test('editor command hint guides CAD construction modes step by step', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 760 });
  await page.goto('/');

  await page
    .locator('input[aria-label="DXF file"]')
    .setInputFiles({
      name: 'command-hints.dxf',
      mimeType: 'application/dxf',
      buffer: Buffer.from(rectangleDxf())
    });

  await showPanels(page, ['path-actions', 'measurement', 'contour-tree']);

  const hint = page.locator('[data-editor-command-hint]');
  await expect(hint).toContainText('Select mode');
  await expect(hint).toContainText('Point mode');

  await page.getByRole('button', { name: 'Magnetize latest point perpendicular' }).click();
  await expect(hint).toContainText('Perpendicular mode');
  await expect(hint).toContainText('Step 1');
  await expect(hint).toContainText('add a measurement point');

  await page.getByLabel('Measurement point X').fill('5');
  await page.getByLabel('Measurement point Y').fill('5');
  await page.getByRole('button', { name: 'Add Point' }).click();
  await expect(hint).toContainText('Step 2');
  await expect(hint).toContainText('select the target contour or segment');

  await page.getByRole('button', { name: 'Magnetize latest point perpendicular' }).click();
  await page.locator('[data-upid-contour-row]').first().click();
  await page.getByRole('button', { name: 'Set path start from canvas' }).click();
  await expect(hint).toContainText('Start mode');
  await expect(hint).toContainText('Step 2');
  await expect(hint).toContainText('click an existing endpoint');
});

test('editor rectangle-selects path geometry from a blank canvas drag in select mode', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 760 });
  await page.goto('/');

  await page
    .locator('input[aria-label="DXF file"]')
    .setInputFiles({
      name: 'canvas-rectangle-select.dxf',
      mimeType: 'application/dxf',
      buffer: Buffer.from(rectangleDxf())
    });

  await expect(page.locator('[data-editor-preview-mouse-mode-select]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-preview-selected="true"][data-preview-source="path-document"]')).toHaveCount(0);

  const preview = page.locator('svg[aria-label="UPID path preview"]');
  const previewBox = await preview.boundingBox();
  const cutBoxes = await page
    .locator('[data-preview-source="path-document"][data-type="cut"]')
    .evaluateAll((paths) =>
      paths.map((path) => {
        const box = path.getBoundingClientRect();
        return {
          height: box.height,
          width: box.width,
          x: box.x,
          y: box.y
        };
      })
    );

  expect(previewBox).not.toBeNull();
  expect(cutBoxes.length).toBeGreaterThan(0);
  if (!previewBox || cutBoxes.length === 0) return;

  const geometryBox = cutBoxes.reduce(
    (box, current) => ({
      maxX: Math.max(box.maxX, current.x + current.width),
      maxY: Math.max(box.maxY, current.y + current.height),
      minX: Math.min(box.minX, current.x),
      minY: Math.min(box.minY, current.y)
    }),
    {
      maxX: -Infinity,
      maxY: -Infinity,
      minX: Infinity,
      minY: Infinity
    }
  );
  const start = {
    x: Math.max(previewBox.x + 8, geometryBox.minX - 42),
    y: Math.max(previewBox.y + 8, geometryBox.minY - 42)
  };
  const end = {
    x: Math.min(previewBox.x + previewBox.width - 8, geometryBox.maxX + 42),
    y: Math.min(previewBox.y + previewBox.height - 8, geometryBox.maxY + 42)
  };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await expect(page.locator('[data-preview-selection-marquee]')).toBeVisible();
  await page.mouse.up();

  await expect(page.locator('[data-preview-selection-marquee]')).toHaveCount(0);
  await expect(page.locator('[data-preview-selected="true"][data-preview-source="path-document"][data-type="cut"]')).toHaveCount(4);
  await expect(page.locator('[data-measurement-point-row="1"]')).toHaveCount(0);
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

async function readFloatingPanelBoxes(page: import('@playwright/test').Page, panelIds: string[]) {
  const boxes = [];
  for (const panelId of panelIds) {
    const box = await page.locator(`[data-editor-floating-panel="${panelId}"]`).boundingBox();
    expect(box).not.toBeNull();
    if (box) boxes.push(box);
  }
  return boxes;
}

function panelsOverlap(
  first: { x: number; y: number; width: number; height: number },
  second: { x: number; y: number; width: number; height: number }
) {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
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

function placedRectangleDxf() {
  return `0
SECTION
2
HEADER
9
$INSBASE
10
1
20
2
30
0
9
$EXTMIN
10
-5
20
-6
30
0
9
$EXTMAX
10
15
20
16
30
0
0
ENDSEC
0
SECTION
2
ENTITIES
0
LINE
8
CUT
10
3
20
4
11
13
21
4
0
LINE
8
CUT
10
13
20
4
11
13
21
14
0
LINE
8
CUT
10
13
20
14
11
3
21
14
0
LINE
8
CUT
10
3
20
14
11
3
21
4
0
ENDSEC
0
EOF
`;
}

function simpleLineDxf() {
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
