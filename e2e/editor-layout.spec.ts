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
  await expect(upidRail.getByRole('tree', { name: 'UPID program sequence' })).toBeVisible();
  await expect(page.locator('[data-editor-panel-dock-zone="left"]')).toHaveCount(0);
  await expect(page.locator('[data-editor-panel-dock-zone="right"]')).toHaveCount(0);
  await expect(appHeader.getByRole('button', { name: /import program/i })).toHaveCount(0);

  await openWorkflowCommand(page, 'View', 'view.contours');
  const contourTreeHelp = page.getByRole('button', { name: 'Contour Tree help' });
  await contourTreeHelp.hover();
  const contourTreeTooltip = page.locator('[data-upid-contour-tree-tooltip]');
  await expect(contourTreeTooltip).toBeVisible();
  const contourTreeBox = await page
    .locator('[data-editor-workspace-panel="contour-tree"]')
    .boundingBox();
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

test('compact path editor routes program-tree edits through mutually exclusive UPID and workflow drawers', async ({ page }) => {
  await page.setViewportSize({ width: 767, height: 800 });
  await openReadyWorkbench(page);
  await page.locator('input[aria-label="DXF file"]').setInputFiles({
    name: 'compact-drawer-layout.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from(rectangleDxf())
  });
  await confirmPendingDxfImport(page);
  await dismissOnboarding(page);

  const upidLauncher = page.getByRole('button', { name: 'Open UPID rail' });
  await expect(upidLauncher).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open active workflow' })).toHaveCount(0);
  await upidLauncher.click();

  const upidDrawer = page.getByRole('dialog', { name: 'UPID rail' });
  await expect(upidDrawer).toBeVisible();
  await upidDrawer.getByRole('button', { name: 'Entry / lead-in · None' }).click();

  const workflowDrawer = page.getByRole('dialog', { name: 'Entry / Exit' });
  await expect(upidDrawer).toHaveCount(0);
  await expect(workflowDrawer).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open active workflow' })).toBeVisible();

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

    const programTree = page.getByRole('tree', { name: 'UPID program sequence' });
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

async function dismissOnboarding(page: import('@playwright/test').Page) {
  const dialog = page.getByRole('dialog', { name: 'Thanks for trying Wire EDM Workbench' });
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
  const titles = ['Geometry', 'Machining', 'Construction', 'View', 'Machine', 'Export'];
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
