import { expect, test } from '@playwright/test';

import { confirmPendingDxfImport } from './dxf-import';

async function openReadyWorkbench(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.locator('input[aria-label="DXF file"]')).toBeEnabled();
  await expect(page.locator('input[aria-label="Machine program file"]')).toBeEnabled();
}

test('machine program editor uses one header and an open resizable inspector', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openReadyWorkbench(page);
  await page.locator('input[aria-label="Machine program file"]').setInputFiles({
    name: 'layout-program.nc',
    mimeType: 'text/plain',
    buffer: Buffer.from('%\nG90\nG0 X0 Y0\nG1 X20 Y0\nG1 X20 Y10\nM02\n%')
  });
  await dismissOnboarding(page);

  const appHeader = page.locator('[data-app-header]');
  await expect(appHeader.getByRole('button', { name: /dashboard/i })).toBeVisible();
  await expect(appHeader).not.toContainText('Wire EDM Workbench');
  await expect(appHeader.getByRole('heading', { name: /layout-program/i })).toBeVisible();
  await expect(appHeader.getByRole('button', { name: /import program/i })).toBeVisible();
  await expect(appHeader.getByRole('button', { name: /open usage guide/i })).toBeVisible();
  await expect(page.locator('[data-editor-header-bar]')).toHaveCount(0);

  const previewHeader = page.locator('[data-editor-preview-header]');
  await expect(previewHeader).toContainText('Preview');
  await expect(previewHeader.getByRole('button', { name: /zoom preview out/i })).toBeVisible();
  await expect(previewHeader.getByRole('button', { name: /fit preview to screen/i })).toBeVisible();
  await expect(page.locator('[data-editor-preview-toolbar]')).toHaveCount(0);

  await expect(page.locator('[data-app-rail]')).toHaveCount(0);

  const rightRail = page.locator('[data-editor-inspector-rail]');
  await expect(rightRail).toBeVisible();
  await expect(page.getByRole('button', { name: 'Expand Inspector Rail' })).toHaveCount(0);
  const rightRailStart = await readWidth(rightRail);
  await drag(page.locator('[data-editor-inspector-resizer]'), 70, 0);
  await expect.poll(() => readWidth(rightRail)).toBeLessThan(rightRailStart - 35);

  await page.getByRole('button', { name: 'Collapse Inspector Rail' }).click();
  await expect(page.locator('[data-editor-inspector-collapsed]')).toBeVisible();
  await expect(rightRail).not.toBeVisible();
  await page.getByRole('button', { name: 'Expand Inspector Rail' }).click();
  await expect(rightRail).toBeVisible();

  await expect(page.locator('[data-editor-lines-panel]')).toHaveCSS('scrollbar-width', 'thin');
  await expect(page.locator('[data-app-header]')).toHaveCSS('height', '40px');
  await expect(page.locator('[data-editor-status-bar]')).toHaveCSS('height', '24px');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
});

test('machine program line commands stay fully visible at desktop and laptop widths', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openReadyWorkbench(page);
  await page.locator('input[aria-label="Machine program file"]').setInputFiles({
    name: 'visible-line-commands.nc',
    mimeType: 'text/plain',
    buffer: Buffer.from('%\nG90\nG0 X0 Y0\nG1 X20 Y0\nG1 X20 Y10\nM02\n%')
  });
  await dismissOnboarding(page);

  await expectLineCommandInsideToolbar(page, 1440);
  await page.setViewportSize({ width: 1024, height: 720 });
  await expectLineCommandInsideToolbar(page, 1024);
});

for (const width of [767, 320]) {
  test(`raw machine program keeps two usable stacked panes at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openReadyWorkbench(page);
    await page.locator('input[aria-label="Machine program file"]').setInputFiles({
      name: `compact-machine-${width}.nc`,
      mimeType: 'text/plain',
      buffer: Buffer.from('%\nG90\nG0 X0 Y0\nG1 X20 Y0\nG1 X20 Y10\nM02\n%')
    });
    await dismissOnboarding(page);

    const mainGrid = page.locator('[data-editor-main-grid]');
    const canvas = page.locator('[data-editor-canvas-panel]');
    const inspector = page.locator('[data-editor-inspector-rail]');
    await expect(mainGrid).toBeVisible();
    await expect(canvas).toBeVisible();
    await expect(inspector).toBeVisible();

    await expect.poll(async () => {
      const [mainGridBox, canvasBox, inspectorBox] = await Promise.all([
        mainGrid.boundingBox(),
        canvas.boundingBox(),
        inspector.boundingBox()
      ]);
      if (!mainGridBox || !canvasBox || !inspectorBox) return false;
      const visibleInspectorHeight = Math.max(
        0,
        Math.min(inspectorBox.y + inspectorBox.height, mainGridBox.y + mainGridBox.height) -
          Math.max(inspectorBox.y, mainGridBox.y)
      );
      return (
        canvasBox.height >= 300 &&
        visibleInspectorHeight >= 280 &&
        inspectorBox.y >= canvasBox.y + canvasBox.height
      );
    }).toBe(true);

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width
    );
  });
}

test('path editor keeps the UPID rail and essential workflow controls at 1024', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openReadyWorkbench(page);
  await page.locator('input[aria-label="DXF file"]').setInputFiles({
    name: 'laptop-layout.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from(rectangleDxf())
  });
  await confirmPendingDxfImport(page);
  await dismissOnboarding(page);

  const appHeader = page.locator('[data-app-header]');
  const canvas = page.locator('[data-editor-canvas-panel]');
  const upidRail = page.getByRole('complementary', { name: 'UPID rail' });
  await expect(upidRail).toBeVisible();
  await expect(upidRail.getByRole('tree', { name: 'UPID execution plan' })).toBeVisible();
  await expect(page.locator('[data-editor-panel-dock-zone="left"]')).toHaveCount(0);
  await expect(page.locator('[data-editor-panel-dock-zone="right"]')).toHaveCount(0);
  await expect(appHeader.getByRole('button', { name: /import program/i })).toHaveCount(0);

  await upidRail.getByRole('tab', { name: 'Geometry lens' }).click();
  const contourTreeHelp = page.getByRole('button', { name: 'Contour Tree help' });
  await contourTreeHelp.hover();
  const contourTreeTooltip = page.locator('[data-upid-contour-tree-tooltip]');
  await expect(contourTreeTooltip).toBeVisible();
  const contourTreeBox = await page.locator('[data-upid-contour-tree]').boundingBox();
  const contourTreeTooltipBox = await contourTreeTooltip.boundingBox();
  expect(contourTreeBox).not.toBeNull();
  expect(contourTreeTooltipBox).not.toBeNull();
  expect(contourTreeTooltipBox!.x).toBeGreaterThanOrEqual(contourTreeBox!.x);
  expect(contourTreeTooltipBox!.x + contourTreeTooltipBox!.width).toBeLessThanOrEqual(
    contourTreeBox!.x + contourTreeBox!.width
  );

  await openWorkflowCommand(page, 'Machining', 'machining.sequence');
  const cutSequencePanel = page.locator('[data-editor-workspace-panel="cut-sequence"]');
  const cutSequenceList = cutSequencePanel.locator('[data-upid-cut-sequence-list]');
  await expect(cutSequencePanel).toBeVisible();
  await expect(cutSequenceList).toBeVisible();
  expect(
    await cutSequencePanel.evaluate((element) => getComputedStyle(element).overflowY)
  ).toBe('auto');
  expect(
    await cutSequenceList.evaluate((element) => getComputedStyle(element).overflowY)
  ).toBe('visible');

  await page.setViewportSize({ width: 1024, height: 720 });

  await expect(page.locator('[data-editor-context="path-project"]')).toBeVisible();
  await expect(canvas).toBeVisible();
  await expect(upidRail).toBeVisible();
  await expect(page.locator('[data-editor-status-bar]')).toBeVisible();
  await expect(appHeader.getByRole('button', { name: /import program/i })).toHaveCount(0);

  await expectWorkflowMenusInsideViewport(page, 1024);

  expect(await readWidth(canvas)).toBeGreaterThanOrEqual(400);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024);

  const headerBox = await appHeader.boundingBox();
  expect(headerBox).not.toBeNull();
  const essentialControls = [
    appHeader.getByRole('button', { name: /dashboard/i }),
    appHeader.getByRole('button', { name: /undo active document change/i }),
    appHeader.getByRole('button', { name: /redo active document change/i }),
    appHeader.getByRole('button', { name: /save active document/i }),
    appHeader.getByRole('button', { name: /open usage guide/i })
  ];
  for (const command of essentialControls) {
    await expect(command).toBeVisible();
    const commandBox = await command.boundingBox();
    expect(commandBox).not.toBeNull();
    expect(commandBox!.x).toBeGreaterThanOrEqual(headerBox!.x);
    expect(commandBox!.x + commandBox!.width).toBeLessThanOrEqual(
      headerBox!.x + headerBox!.width
    );
  }
});

test('path editor keeps an active right dock and its controls inside the workbench at 1024', async ({
  page
}) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await openReadyWorkbench(page);
  await page.locator('input[aria-label="DXF file"]').setInputFiles({
    name: 'active-right-dock-1024.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from(rectangleDxf())
  });
  await confirmPendingDxfImport(page);
  await dismissOnboarding(page);

  await openWorkflowCommand(page, 'Machining', 'machining.entry-exit');
  await page.getByRole('button', { name: 'Dock Entry / Exit right' }).click();

  const mainGrid = page.locator('[data-editor-main-grid]');
  const canvas = page.locator('[data-editor-canvas-panel]');
  const rightDock = page.locator('[data-editor-panel-dock-zone="right"]');
  const dockedPanel = rightDock.locator('[data-editor-workspace-panel="entry-exit"]');
  await expect(mainGrid).toHaveAttribute('data-has-active-right-dock', 'true');
  await expect(rightDock).toBeVisible();
  await expect(dockedPanel).toBeVisible();

  const [mainGridBox, canvasBox, rightDockBox] = await Promise.all([
    mainGrid.boundingBox(),
    canvas.boundingBox(),
    rightDock.boundingBox()
  ]);
  expect(mainGridBox).not.toBeNull();
  expect(canvasBox).not.toBeNull();
  expect(rightDockBox).not.toBeNull();
  expect(canvasBox!.width).toBeGreaterThanOrEqual(480);
  expect(rightDockBox!.width).toBeGreaterThanOrEqual(280);
  expect(rightDockBox!.x).toBeGreaterThanOrEqual(mainGridBox!.x);
  expect(rightDockBox!.x + rightDockBox!.width).toBeLessThanOrEqual(
    mainGridBox!.x + mainGridBox!.width
  );
  expect(rightDockBox!.x + rightDockBox!.width).toBeLessThanOrEqual(1024);

  const dockControls = [
    dockedPanel.getByRole('button', { name: 'Float Entry / Exit' }),
    dockedPanel.getByRole('button', { name: 'Hide Entry / Exit' }),
    dockedPanel.getByRole('button', { name: 'Cancel Entry / Exit workflow' }),
    dockedPanel.getByRole('button', { name: 'Save Entry / Exit workflow' })
  ];
  for (const control of dockControls) {
    await expect(control).toBeVisible();
    const controlBox = await control.boundingBox();
    expect(controlBox).not.toBeNull();
    expect(controlBox!.x).toBeGreaterThanOrEqual(rightDockBox!.x);
    expect(controlBox!.x + controlBox!.width).toBeLessThanOrEqual(
      rightDockBox!.x + rightDockBox!.width
    );
    expect(controlBox!.x + controlBox!.width).toBeLessThanOrEqual(1024);
  }

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024);
});

test('restored 360px rails keep the active right dock inside the workbench at 1200', async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openReadyWorkbench(page);
  await page.locator('input[aria-label="DXF file"]').setInputFiles({
    name: 'restored-rails-1200.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from(rectangleDxf())
  });
  await confirmPendingDxfImport(page);
  await dismissOnboarding(page);

  await openWorkflowCommand(page, 'Machining', 'machining.entry-exit');
  await page.getByRole('button', { name: 'Dock Entry / Exit right' }).click();
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem('wire-edm.editor-workspace-layout.v1');
    if (!raw) return null;
    return JSON.parse(raw).placements['entry-exit'];
  })).toBe('docked-right');
  await page.evaluate(() => {
    const key = 'wire-edm.editor-workspace-layout.v1';
    const layout = JSON.parse(localStorage.getItem(key) ?? '{}');
    layout.dockWidths = { left: 360, right: 360 };
    localStorage.setItem(key, JSON.stringify(layout));
  });

  await page.reload();
  await expect(page.locator('[data-project-row]')).toHaveCount(1);
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.locator('[data-project-row]')
    .getByRole('button', { name: /Open project .* in editor/ })
    .click();
  await openWorkflowCommand(page, 'Machining', 'machining.entry-exit');

  await expect.poll(() => readWidth(
    page.getByRole('complementary', { name: 'UPID rail', exact: true })
  )).toBeGreaterThanOrEqual(359);
  await expectActiveRightDockInsideWorkbench(page, 1200);

  await page.setViewportSize({ width: 1199, height: 800 });
  await expectActiveRightDockInsideWorkbench(page, 1199);

  await page.setViewportSize({ width: 1440, height: 900 });
  const restoredDockWidth = await expectActiveRightDockInsideWorkbench(page, 1440);
  expect(restoredDockWidth).toBeGreaterThanOrEqual(359);
  expect(restoredDockWidth).toBeLessThanOrEqual(361);
});

test('maximum right dock caps at 1200 and restores its width at 1440', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openReadyWorkbench(page);
  await page.locator('input[aria-label="DXF file"]').setInputFiles({
    name: 'maximum-right-dock-1200.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from(rectangleDxf())
  });
  await confirmPendingDxfImport(page);
  await dismissOnboarding(page);

  await openWorkflowCommand(page, 'Machining', 'machining.entry-exit');
  await page.getByRole('button', { name: 'Dock Entry / Exit right' }).click();
  await drag(page.locator('[data-editor-inspector-resizer]'), -200, 0);
  const expandedDock = page.locator('[data-editor-panel-dock-zone="right"]');
  await expect.poll(() => readWidth(expandedDock)).toBeGreaterThanOrEqual(559);

  await page.setViewportSize({ width: 1200, height: 800 });
  const constrainedDockWidth = await expectActiveRightDockInsideWorkbench(page, 1200);
  expect(constrainedDockWidth).toBeLessThan(560);

  await page.setViewportSize({ width: 1199, height: 800 });
  await expectActiveRightDockInsideWorkbench(page, 1199);

  await page.setViewportSize({ width: 1440, height: 900 });
  const restoredDockWidth = await expectActiveRightDockInsideWorkbench(page, 1440);
  expect(restoredDockWidth).toBeGreaterThanOrEqual(559);
  expect(restoredDockWidth).toBeLessThanOrEqual(561);
});

test('path editor materializes a right dock only for a docked active workflow', async ({ page }) => {
  await page.setViewportSize({ width: 1708, height: 874 });
  await openReadyWorkbench(page);
  await page.locator('input[aria-label="DXF file"]').setInputFiles({
    name: 'symmetric-docks.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from(rectangleDxf())
  });
  await confirmPendingDxfImport(page);
  await dismissOnboarding(page);

  await expect(page.locator('[data-editor-panel-dock-zone="right"]')).toHaveCount(0);
  await openWorkflowCommand(page, 'Machining', 'machining.entry-exit');
  await page.getByRole('button', { name: 'Dock Entry / Exit right' }).click();
  await expect(page.locator('[data-editor-panel-dock-zone="right"]')).toBeVisible();
  await page.getByRole('button', { name: 'Hide Entry / Exit' }).click();
  await expect(page.locator('[data-editor-panel-dock-zone="right"]')).toHaveCount(0);
});

test('path editor persists a collapsed UPID rail across reload and project reopen', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openReadyWorkbench(page);
  await page.locator('input[aria-label="DXF file"]').setInputFiles({
    name: 'persisted-collapsed-rail.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from(rectangleDxf())
  });
  await confirmPendingDxfImport(page);
  await dismissOnboarding(page);

  await page.getByRole('button', { name: 'Collapse UPID rail' }).click();
  await expect(page.getByRole('complementary', { name: 'Collapsed UPID rail' })).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem('wire-edm.editor-workspace-layout.v1');
    return raw ? JSON.parse(raw).upidRailCollapsed : null;
  })).toBe(true);

  await page.setViewportSize({ width: 800, height: 800 });
  await expect(page.getByRole('complementary', { name: 'Collapsed UPID rail' })).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem('wire-edm.editor-workspace-layout.v1');
    return raw ? JSON.parse(raw).upidRailCollapsed : null;
  })).toBe(true);

  await page.setViewportSize({ width: 1024, height: 800 });
  await expect(page.getByRole('complementary', { name: 'Collapsed UPID rail' })).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem('wire-edm.editor-workspace-layout.v1');
    return raw ? JSON.parse(raw).upidRailCollapsed : null;
  })).toBe(true);

  await page.reload();
  await expect(page.locator('[data-project-row]')).toHaveCount(1);
  await page.locator('[data-project-row]')
    .getByRole('button', { name: /Open project .* in editor/ })
    .click();

  await expect(page.getByRole('complementary', { name: 'Collapsed UPID rail' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'UPID rail', exact: true })).toHaveCount(0);
});

test('middle-width path editor defaults to a compact rail and floats remembered right workflows', async ({
  page
}) => {
  await page.setViewportSize({ width: 800, height: 800 });
  await openReadyWorkbench(page);
  await page.locator('input[aria-label="DXF file"]').setInputFiles({
    name: 'middle-width-layout.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from(rectangleDxf())
  });
  await confirmPendingDxfImport(page);
  await dismissOnboarding(page);

  await expect(page.getByRole('complementary', { name: 'Collapsed UPID rail' })).toBeVisible();
  await expect(page.locator('[data-app-workspace-grid]')).toHaveCSS(
    'grid-template-columns',
    '36px 764px'
  );
  const mainGrid = page.locator('[data-editor-main-grid]');
  const canvas = page.locator('[data-editor-canvas-panel]');
  await expect.poll(async () => {
    const [mainGridBox, canvasBox] = await Promise.all([
      mainGrid.boundingBox(),
      canvas.boundingBox()
    ]);
    if (!mainGridBox || !canvasBox) return false;
    return canvasBox.height >= mainGridBox.height - 20;
  }).toBe(true);
  await openCompactWorkflowCommand(page, 'Machining', 'machining.entry-exit');

  const floatingPanel = page.locator('[data-editor-floating-panel="entry-exit"]');
  await expect(floatingPanel).toBeVisible();
  await page.getByRole('button', { name: 'Dock Entry / Exit right' }).click();
  await expect(page.locator('[data-editor-panel-dock-zone="right"]')).toHaveCount(0);
  await expect(floatingPanel).toBeVisible();
  await expect(mainGrid).toHaveAttribute(
    'data-has-active-right-dock',
    'false'
  );
  const panelBox = await floatingPanel.boundingBox();
  expect(panelBox).not.toBeNull();
  expect(panelBox!.x).toBeGreaterThanOrEqual(0);
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(800);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(800);
});

test('middle-width UPID strip opens its full tree as a focus-safe overlay', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 800 });
  await openReadyWorkbench(page);
  await page.locator('input[aria-label="DXF file"]').setInputFiles({
    name: 'middle-width-upid-overlay.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from(rectangleDxf())
  });
  await confirmPendingDxfImport(page);
  await dismissOnboarding(page);

  const workspaceGrid = page.locator('[data-app-workspace-grid]');
  const expandUpidRail = page.getByRole('button', { name: 'Expand UPID rail' });
  await expect(page.getByRole('complementary', { name: 'Collapsed UPID rail' })).toBeVisible();
  await expect(workspaceGrid).toHaveCSS('grid-template-columns', '36px 764px');

  await expandUpidRail.click();
  const upidDrawer = page.getByRole('dialog', { name: 'UPID rail' });
  await expect(upidDrawer).toBeVisible();
  await expect(upidDrawer).toHaveAttribute('aria-modal', 'true');
  await expect(upidDrawer.getByRole('button', { name: 'Close UPID rail' })).toBeFocused();
  await expect(page.locator('[role="dialog"][aria-modal="true"]:visible')).toHaveCount(1);
  await expect(workspaceGrid).toHaveAttribute('inert', '');
  await expect(workspaceGrid).toHaveCSS('grid-template-columns', '36px 764px');
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem('wire-edm.editor-workspace-layout.v1');
    return raw ? JSON.parse(raw).upidRailCollapsed : null;
  })).toBe(false);

  await upidDrawer.getByRole('button', { name: 'Close UPID rail' }).click();
  await expect(upidDrawer).toHaveCount(0);
  await expect(expandUpidRail).toBeFocused();
  await expect(workspaceGrid).not.toHaveAttribute('inert', '');
  await expect(workspaceGrid).toHaveCSS('grid-template-columns', '36px 764px');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(800);
});

test('fresh middle session restores the expanded desktop rail without persisting its effective collapse', async ({
  page
}) => {
  await page.setViewportSize({ width: 800, height: 800 });
  await openReadyWorkbench(page);
  await page.locator('input[aria-label="DXF file"]').setInputFiles({
    name: 'fresh-middle-desktop-preference.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from(rectangleDxf())
  });
  await confirmPendingDxfImport(page);
  await dismissOnboarding(page);

  await expect(page.getByRole('complementary', { name: 'Collapsed UPID rail' })).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem('wire-edm.editor-workspace-layout.v1');
    return raw ? JSON.parse(raw).upidRailCollapsed : null;
  })).toBe(false);

  await page.setViewportSize({ width: 1024, height: 800 });
  await expect(page.getByRole('complementary', { name: 'UPID rail', exact: true })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Collapsed UPID rail' })).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem('wire-edm.editor-workspace-layout.v1');
    return raw ? JSON.parse(raw).upidRailCollapsed : null;
  })).toBe(false);
});

test('middle overlay Collapse closes the drawer and preserves the desktop rail preference', async ({
  page
}) => {
  await page.setViewportSize({ width: 800, height: 800 });
  await openReadyWorkbench(page);
  await page.locator('input[aria-label="DXF file"]').setInputFiles({
    name: 'middle-overlay-collapse.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from(rectangleDxf())
  });
  await confirmPendingDxfImport(page);
  await dismissOnboarding(page);

  const expandUpidRail = page.getByRole('button', { name: 'Expand UPID rail' });
  await expandUpidRail.click();
  const upidDrawer = page.getByRole('dialog', { name: 'UPID rail' });
  await expect(upidDrawer).toBeVisible();
  await upidDrawer.getByRole('button', { name: 'Collapse UPID rail' }).click();

  await expect(upidDrawer).toHaveCount(0);
  await expect(expandUpidRail).toBeFocused();
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem('wire-edm.editor-workspace-layout.v1');
    return raw ? JSON.parse(raw).upidRailCollapsed : null;
  })).toBe(false);
});

test('middle viewport temporarily collapses an expanded desktop UPID rail', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await openReadyWorkbench(page);
  await page.locator('input[aria-label="DXF file"]').setInputFiles({
    name: 'live-middle-effective-collapse.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from(rectangleDxf())
  });
  await confirmPendingDxfImport(page);
  await dismissOnboarding(page);

  const workspaceGrid = page.locator('[data-app-workspace-grid]');
  const expandedRail = page.getByRole('complementary', { name: 'UPID rail', exact: true });
  await expect(expandedRail).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem('wire-edm.editor-workspace-layout.v1');
    return raw ? JSON.parse(raw).upidRailCollapsed : null;
  })).toBe(false);

  await page.setViewportSize({ width: 800, height: 800 });
  const collapsedRail = page.getByRole('complementary', { name: 'Collapsed UPID rail' });
  const expandUpidRail = page.getByRole('button', { name: 'Expand UPID rail' });
  await expect(collapsedRail).toBeVisible();
  await expect(expandedRail).toHaveCount(0);
  await expect(workspaceGrid).toHaveCSS('grid-template-columns', '36px 764px');
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem('wire-edm.editor-workspace-layout.v1');
    return raw ? JSON.parse(raw).upidRailCollapsed : null;
  })).toBe(false);

  await expandUpidRail.click();
  const upidDrawer = page.getByRole('dialog', { name: 'UPID rail' });
  await expect(upidDrawer).toBeVisible();
  await expect(workspaceGrid).toHaveCSS('grid-template-columns', '36px 764px');
  await upidDrawer.getByRole('button', { name: 'Close UPID rail' }).click();
  await expect(expandUpidRail).toBeFocused();

  await page.setViewportSize({ width: 1024, height: 800 });
  await expect(upidDrawer).toHaveCount(0);
  await expect(expandedRail).toBeVisible();
  await expect(collapsedRail).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem('wire-edm.editor-workspace-layout.v1');
    return raw ? JSON.parse(raw).upidRailCollapsed : null;
  })).toBe(false);
});

test('persisted expanded rail uses the middle overlay and restores focus on desktop resize', async ({
  page
}) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await openReadyWorkbench(page);
  await page.locator('input[aria-label="DXF file"]').setInputFiles({
    name: 'persisted-middle-effective-collapse.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from(rectangleDxf())
  });
  await confirmPendingDxfImport(page);
  await dismissOnboarding(page);
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem('wire-edm.editor-workspace-layout.v1');
    return raw ? JSON.parse(raw).upidRailCollapsed : null;
  })).toBe(false);

  await page.reload();
  await expect(page.locator('[data-project-row]')).toHaveCount(1);
  await page.setViewportSize({ width: 800, height: 800 });
  await page.locator('[data-project-row]')
    .getByRole('button', { name: /Open project .* in editor/ })
    .click();

  const workspaceGrid = page.locator('[data-app-workspace-grid]');
  const expandUpidRail = page.getByRole('button', { name: 'Expand UPID rail' });
  await expect(page.getByRole('complementary', { name: 'Collapsed UPID rail' })).toBeVisible();
  await expect(workspaceGrid).toHaveCSS('grid-template-columns', '36px 764px');
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem('wire-edm.editor-workspace-layout.v1');
    return raw ? JSON.parse(raw).upidRailCollapsed : null;
  })).toBe(false);

  await expandUpidRail.click();
  const upidDrawer = page.getByRole('dialog', { name: 'UPID rail' });
  await expect(upidDrawer).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 800 });

  await expect(upidDrawer).toHaveCount(0);
  const expandedRail = page.getByRole('complementary', { name: 'UPID rail', exact: true });
  const programLens = expandedRail.getByRole('tab', { name: 'Program lens' });
  await expect(expandedRail).toBeVisible();
  await expect(programLens).toBeFocused();
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem('wire-edm.editor-workspace-layout.v1');
    return raw ? JSON.parse(raw).upidRailCollapsed : null;
  })).toBe(false);
});

test('compact path editor keeps an active workflow reachable after closing its drawer', async ({ page }) => {
  await page.setViewportSize({ width: 767, height: 800 });
  await openReadyWorkbench(page);
  await page.locator('input[aria-label="DXF file"]').setInputFiles({
    name: 'compact-drawer-layout.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from(rectangleDxf())
  });
  await confirmPendingDxfImport(page);
  await dismissOnboarding(page);

  await expect(page.getByRole('button', { name: 'Open active workflow' })).toHaveCount(0);
  await openCompactWorkflowCommand(page, 'Machining', 'machining.entry-exit');

  const workflowDrawer = page.getByRole('dialog', { name: 'Entry / Exit' });
  await expect(workflowDrawer).toBeVisible();

  const entryX = workflowDrawer.getByRole('textbox', { name: 'Entry X' });
  await entryX.fill('5');
  await workflowDrawer.getByRole('button', { name: 'Close Entry / Exit drawer' }).click();
  await expect(workflowDrawer).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open active workflow' })).toBeFocused();

  await page.getByRole('button', { name: 'Open active workflow' }).click();
  await expect(workflowDrawer.getByRole('textbox', { name: 'Entry X' })).toHaveValue('5');
  await page.keyboard.press('Escape');
  await expect(workflowDrawer).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open active workflow' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(767);
});

for (const width of [767, 320]) {
  test(`compact Workflows launcher exposes all categories at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openReadyWorkbench(page);
    await page.locator('input[aria-label="DXF file"]').setInputFiles({
      name: `compact-workflows-${width}.dxf`,
      mimeType: 'application/dxf',
      buffer: Buffer.from(rectangleDxf())
    });
    await confirmPendingDxfImport(page);
    await dismissOnboarding(page);

    const launcher = page.getByRole('button', { name: 'Open Workflows' });
    await expect(launcher).toBeVisible();
    await expect(page.locator('[data-editor-workflow-direct]')).not.toBeVisible();
    await launcher.click();

    const titles = ['Geometry', 'Machining', 'Construction', 'View', 'Export'];
    for (const title of titles) {
      const category = page.getByRole('menuitem', { name: `Open ${title} workflows` });
      await expect(category).toBeVisible();
      await category.click();
      const commandMenu = page.locator(`[data-editor-workflow-menu="${title}"]`);
      await expect(commandMenu).toBeVisible();
      const box = await commandMenu.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await commandMenu.getByRole('menuitem', { name: 'Back to workflow categories' }).click();
    }

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width
    );
  });
}

test('compact Workflows launcher owns keyboard focus and popup state at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await openReadyWorkbench(page);
  await page.locator('input[aria-label="DXF file"]').setInputFiles({
    name: 'compact-workflows-keyboard.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from(rectangleDxf())
  });
  await confirmPendingDxfImport(page);
  await dismissOnboarding(page);

  await expect(page.getByRole('status', { name: 'Browser cache active' })).toBeVisible();
  const launcher = page.getByRole('button', { name: 'Open Workflows' });
  await launcher.focus();
  await page.keyboard.press('Enter');
  const geometry = page.getByRole('menuitem', { name: 'Open Geometry workflows' });
  const machining = page.getByRole('menuitem', { name: 'Open Machining workflows' });
  await expect(geometry).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect(machining).toBeFocused();
  await page.keyboard.press('Enter');
  const machiningMenu = page.locator('[data-editor-workflow-compact-menu]');
  await expect(machiningMenu.locator('[data-editor-workflow-command]:focus')).toHaveCount(1);
  await expect(launcher).toHaveAttribute('aria-controls', await machiningMenu.getAttribute('id') ?? '');

  const back = machiningMenu.getByRole('menuitem', { name: 'Back to workflow categories' });
  await back.focus();
  await page.keyboard.press('Enter');
  await expect(machining).toBeFocused();
  await expect(launcher).toHaveAttribute('aria-controls', 'editor-workflow-compact-popover');

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-editor-workflow-category-menu]')).toHaveCount(0);
  await expect(launcher).toBeFocused();
  await expect(launcher).toHaveAttribute('aria-expanded', 'false');
  await expect(launcher).not.toHaveAttribute('aria-controls');
});

test('compact modal host contains shell chrome and clears its owner when the editor unmounts', async ({ page }) => {
  await page.setViewportSize({ width: 767, height: 800 });
  await openReadyWorkbench(page);
  await page.locator('input[aria-label="DXF file"]').setInputFiles({
    name: 'compact-modal-unmount.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from(rectangleDxf())
  });
  await confirmPendingDxfImport(page);
  await dismissOnboarding(page);

  await page.getByRole('button', { name: 'Open UPID rail' }).click();
  const upidDrawer = page.getByRole('dialog', { name: 'UPID rail' });
  await expect(upidDrawer).toBeVisible();
  for (const selector of ['[data-app-header]', '[data-app-workspace-grid]', '[data-app-status-bar]']) {
    await expect(page.locator(selector)).toHaveAttribute('inert', '');
  }
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => {
    const header = document.querySelector('[data-app-header]');
    return !header?.contains(document.activeElement);
  })).toBe(true);
  await upidDrawer.getByRole('button', { name: 'Close UPID rail' }).click();
  await expect(page.getByRole('button', { name: 'Open UPID rail' })).toBeFocused();
  await page.getByRole('button', { name: 'Open UPID rail' }).click();

  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('[data-app-header] button[aria-label="Back to Dashboard"]')?.click();
  });
  await expect(page.locator('input[aria-label="DXF file"]')).toBeEnabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-app-header]')).not.toHaveAttribute('inert', '');
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 720 }
]) {
  test(`path editor preserves its UPID Program rail after repeated collapse at ${viewport.width}px`, async ({
    page
  }) => {
    await page.setViewportSize(viewport);
    await openReadyWorkbench(page);
    await page.locator('input[aria-label="DXF file"]').setInputFiles({
      name: `stable-contour-tree-${viewport.width}.dxf`,
      mimeType: 'application/dxf',
      buffer: Buffer.from(rectangleDxf())
    });
    await confirmPendingDxfImport(page);
    await dismissOnboarding(page);

    const programTree = page.getByRole('tree', { name: 'UPID execution plan' });
    for (let cycle = 0; cycle < 2; cycle += 1) {
      await expect(programTree).toBeVisible();

      await page.getByRole('button', { name: 'Collapse UPID rail' }).click();
      await expect(page.getByRole('complementary', { name: 'Collapsed UPID rail' })).toBeVisible();
      await expect(programTree).not.toBeVisible();

      await page.getByRole('button', { name: 'Expand UPID rail' }).click();
    }

    await expect(programTree).toBeVisible();
  });
}

async function openWorkflowCommand(
  page: import('@playwright/test').Page,
  menuTitle: string,
  commandId: string
) {
  await page.getByRole('button', { name: `${menuTitle} menu` }).click();
  await page.locator(`[data-editor-workflow-command="${commandId}"]`).click();
}

async function openCompactWorkflowCommand(
  page: import('@playwright/test').Page,
  menuTitle: string,
  commandId: string
) {
  await page.getByRole('button', { name: 'Open Workflows' }).click();
  await page.getByRole('menuitem', { name: `Open ${menuTitle} workflows` }).click();
  await page.locator(
    `[data-editor-workflow-compact] [data-editor-workflow-command="${commandId}"]`
  ).click();
}

async function dismissOnboarding(page: import('@playwright/test').Page) {
  const dialog = page.getByRole('dialog', { name: 'Thanks for trying Wire EDM Workbench' });
  await dialog.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => undefined);
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Go Build!' }).click();
}

async function drag(locator: import('@playwright/test').Locator, deltaX: number, deltaY: number) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Drag target is not visible.');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await locator.dispatchEvent('pointerdown', { button: 0, clientX: x, clientY: y, pointerType: 'mouse' });
  await locator.page().evaluate(({ clientX, clientY, deltaX: moveX, deltaY: moveY }) => {
    window.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      clientX: clientX + moveX,
      clientY: clientY + moveY,
      pointerType: 'mouse'
    }));
    window.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      clientX: clientX + moveX,
      clientY: clientY + moveY,
      pointerType: 'mouse'
    }));
  }, { clientX: x, clientY: y, deltaX, deltaY });
}

async function readWidth(locator: import('@playwright/test').Locator) {
  return await locator.evaluate((element) => element.getBoundingClientRect().width);
}

async function expectActiveRightDockInsideWorkbench(
  page: import('@playwright/test').Page,
  viewportWidth: number
) {
  await expect.poll(() => page.locator('[data-app-workspace-grid]').evaluate((element) =>
    element.getAnimations().filter((animation) => animation.playState === 'running').length
  )).toBe(0);

  const mainGrid = page.locator('[data-editor-main-grid]');
  const canvas = page.locator('[data-editor-canvas-panel]');
  const rightDock = page.locator('[data-editor-panel-dock-zone="right"]');
  const dockedPanel = rightDock.locator('[data-editor-workspace-panel="entry-exit"]');
  await expect(mainGrid).toHaveAttribute('data-has-active-right-dock', 'true');
  await expect(rightDock).toBeVisible();
  await expect(dockedPanel).toBeVisible();

  await expect.poll(async () => {
    const [mainGridBox, canvasBox, rightDockBox] = await Promise.all([
      mainGrid.boundingBox(),
      canvas.boundingBox(),
      rightDock.boundingBox()
    ]);
    if (!mainGridBox || !canvasBox || !rightDockBox) return false;
    return (
      canvasBox.width >= 480 &&
      rightDockBox.width >= 280 &&
      rightDockBox.x >= mainGridBox.x &&
      rightDockBox.x + rightDockBox.width <= mainGridBox.x + mainGridBox.width &&
      rightDockBox.x + rightDockBox.width <= viewportWidth
    );
  }).toBe(true);

  const rightDockBox = await rightDock.boundingBox();
  expect(rightDockBox).not.toBeNull();
  const dockControls = [
    dockedPanel.getByRole('button', { name: 'Float Entry / Exit' }),
    dockedPanel.getByRole('button', { name: 'Hide Entry / Exit' }),
    dockedPanel.getByRole('button', { name: 'Cancel Entry / Exit workflow' }),
    dockedPanel.getByRole('button', { name: 'Save Entry / Exit workflow' })
  ];
  for (const control of dockControls) {
    await expect(control).toBeVisible();
    const controlBox = await control.boundingBox();
    expect(controlBox).not.toBeNull();
    expect(controlBox!.x).toBeGreaterThanOrEqual(rightDockBox!.x);
    expect(controlBox!.x + controlBox!.width).toBeLessThanOrEqual(
      rightDockBox!.x + rightDockBox!.width
    );
    expect(controlBox!.x + controlBox!.width).toBeLessThanOrEqual(viewportWidth);
  }

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    viewportWidth
  );
  return rightDockBox!.width;
}

async function expectLineCommandInsideToolbar(
  page: import('@playwright/test').Page,
  viewportWidth: number
) {
  const toolbar = page.locator('[data-editor-line-toolbar]');
  const deleteSelected = toolbar.getByRole('button', { name: 'Delete Selected' });
  await expect(toolbar).toBeVisible();
  await expect(deleteSelected).toBeVisible();
  await expect
    .poll(async () => {
      const [toolbarBox, commandBox] = await Promise.all([
        toolbar.boundingBox(),
        deleteSelected.boundingBox()
      ]);
      if (!toolbarBox || !commandBox) return false;
      return (
        commandBox.x >= toolbarBox.x &&
        commandBox.x + commandBox.width <= toolbarBox.x + toolbarBox.width &&
        commandBox.y >= toolbarBox.y &&
        commandBox.y + commandBox.height <= toolbarBox.y + toolbarBox.height
      );
    })
    .toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    viewportWidth
  );
}

async function expectWorkflowMenusInsideViewport(
  page: import('@playwright/test').Page,
  viewportWidth: number
) {
  const titles = ['Geometry', 'Machining', 'Construction', 'View', 'Export'];
  for (const title of titles) {
    const trigger = page.getByRole('button', { name: `${title} menu` });
    await expect(trigger).toBeVisible();
    await trigger.click();

    const menu = page.locator(`[data-editor-workflow-menu="${title}"]`);
    await expect(menu).toBeVisible();
    const menuBox = await menu.boundingBox();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.x).toBeGreaterThanOrEqual(0);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewportWidth);

    const rows = menu.locator('[data-editor-workflow-command]');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);
    for (let index = 0; index < rowCount; index += 1) {
      const row = rows.nth(index);
      await expect(row).toBeVisible();
      const rowBox = await row.boundingBox();
      expect(rowBox).not.toBeNull();
      expect(rowBox!.height).toBeGreaterThanOrEqual(30);
      expect(rowBox!.height).toBeLessThanOrEqual(34);
    }

    await trigger.click();
    await expect(menu).toHaveCount(0);
  }
}

function rectangleDxf() {
  return `0
SECTION
2
ENTITIES
0
LINE
8
CUT
10
0
20
0
11
20
21
0
0
LINE
8
CUT
10
20
20
0
11
20
21
10
0
LINE
8
CUT
10
20
20
10
11
0
21
10
0
LINE
8
CUT
10
0
20
10
11
0
21
0
0
ENDSEC
0
EOF
`;
}
