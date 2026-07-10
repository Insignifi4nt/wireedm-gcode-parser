import { expect, test } from '@playwright/test';

const PATH_SHORTCUT_IDS = [
  'contour-tree',
  'path-actions',
  'cut-sequence',
  'path-transform',
  'path-diagnostics',
  'statistics',
  'measurement',
  'machine'
];

test('machine program editor uses one header and an open resizable inspector', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('input[aria-label="Machine program file"]').setInputFiles({
    name: 'layout-program.nc',
    mimeType: 'text/plain',
    buffer: Buffer.from('%\nG90\nG0 X0 Y0\nG1 X20 Y0\nG1 X20 Y10\nM02\n%')
  });

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
  await page.goto('/');
  await page.locator('input[aria-label="Machine program file"]').setInputFiles({
    name: 'visible-line-commands.nc',
    mimeType: 'text/plain',
    buffer: Buffer.from('%\nG90\nG0 X0 Y0\nG1 X20 Y0\nG1 X20 Y10\nM02\n%')
  });

  await expectLineCommandInsideToolbar(page, 1440);
  await page.setViewportSize({ width: 1024, height: 720 });
  await expectLineCommandInsideToolbar(page, 1024);
});

test('path editor keeps direct shortcuts at 1440 and essential controls at 1024', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('input[aria-label="DXF file"]').setInputFiles({
    name: 'laptop-layout.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from(rectangleDxf())
  });

  const appHeader = page.locator('[data-app-header]');
  const canvas = page.locator('[data-editor-canvas-panel]');
  const leftDock = page.locator('[data-editor-panel-dock-zone="left"]');
  const rightDock = page.locator('[data-editor-panel-dock-zone="right"]');
  const workspaceToolbar = appHeader.locator('[data-editor-panel-toolbar]');
  const workspaceTrigger = workspaceToolbar.locator('summary[aria-label="Panels"]');

  for (const panelId of PATH_SHORTCUT_IDS) {
    const shortcut = page.locator(`[data-editor-panel-shortcut="${panelId}"]`);
    await expect(shortcut).toBeVisible();
    await expect(shortcut).toHaveAttribute('title', /^(Show|Hide) /);
    const shortcutBox = await shortcut.boundingBox();
    expect(shortcutBox).not.toBeNull();
    expect(shortcutBox!.width).toBeLessThanOrEqual(30);
  }
  await expect(appHeader.getByRole('button', { name: /import program/i })).toHaveCount(0);

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

  await page.locator('[data-editor-panel-shortcut="cut-sequence"]').click();
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
  await page.locator('[data-editor-panel-shortcut="cut-sequence"]').click();

  const workspaceBox = await workspaceToolbar.boundingBox();
  const undoBox = await appHeader
    .getByRole('button', { name: /undo active document change/i })
    .boundingBox();
  expect(workspaceBox).not.toBeNull();
  expect(undoBox).not.toBeNull();
  expect(workspaceBox!.x + workspaceBox!.width).toBeLessThanOrEqual(undoBox!.x - 4);

  const controlsBox = await appHeader
    .getByRole('button', { name: /open usage guide/i })
    .boundingBox();
  const notificationsBox = await page.locator('[data-status-notification-root]').boundingBox();
  expect(controlsBox).not.toBeNull();
  expect(notificationsBox).not.toBeNull();
  expect(controlsBox!.x + controlsBox!.width).toBeLessThanOrEqual(notificationsBox!.x - 4);

  await page.setViewportSize({ width: 1024, height: 720 });

  await expect(page.locator('[data-editor-context="path-project"]')).toBeVisible();
  await expect(canvas).toBeVisible();
  await expect(leftDock).toBeVisible();
  await expect(rightDock).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collapse Panel Dock' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collapse Inspector Dock' })).toBeVisible();
  await expect(page.locator('[data-editor-status-bar]')).toBeVisible();
  await expect(workspaceTrigger).toBeVisible();
  await expect(page.locator('[data-editor-panel-shortcuts]')).not.toBeVisible();
  await expect(appHeader.getByRole('button', { name: /import program/i })).toHaveCount(0);
  await expect(page.locator('[data-editor-dock-panel-stack="left"]')).toHaveCSS(
    'scrollbar-width',
    'thin'
  );
  await expect(page.locator('[data-editor-dock-panel-stack="right"]')).toHaveCSS(
    'scrollbar-width',
    'thin'
  );

  expect(await readWidth(canvas)).toBeGreaterThanOrEqual(400);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024);

  const headerBox = await appHeader.boundingBox();
  expect(headerBox).not.toBeNull();
  const essentialControls = [
    appHeader.getByRole('button', { name: /dashboard/i }),
    workspaceTrigger,
    appHeader.getByRole('button', { name: /undo active document change/i }),
    appHeader.getByRole('button', { name: /redo active document change/i }),
    appHeader.getByRole('button', { name: /save active document/i }),
    appHeader.getByRole('button', { name: /export preview/i }),
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

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 720 }
]) {
  test(`path editor restores its docked Contour Tree after repeated rail collapse at ${viewport.width}px`, async ({
    page
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.locator('input[aria-label="DXF file"]').setInputFiles({
      name: `stable-contour-tree-${viewport.width}.dxf`,
      mimeType: 'application/dxf',
      buffer: Buffer.from(rectangleDxf())
    });

    const contourTree = page.locator(
      '[data-app-rail-expanded-content] [data-editor-workspace-panel="contour-tree"]'
    );
    for (let cycle = 0; cycle < 2; cycle += 1) {
      await expect(contourTree).toBeVisible();
      await expect(contourTree).toHaveAttribute(
        'data-editor-workspace-panel-placement',
        'docked-left'
      );
      await expect(contourTree).toContainText('Contour Tree');

      await page.getByRole('button', { name: 'Collapse Panel Dock' }).click();
      await expect(page.locator('[data-app-rail-expanded-content]')).toHaveAttribute(
        'aria-hidden',
        'true'
      );
      await expect(contourTree).not.toBeVisible();

      await page.getByRole('button', { name: 'Expand workbench sidebar' }).click();
      await expect(page.locator('[data-app-rail-expanded-content]')).not.toHaveAttribute(
        'aria-hidden',
        'true'
      );
    }

    await expect(contourTree).toBeVisible();
    await expect(contourTree).toContainText('Contour Tree');
  });
}

async function drag(locator: import('@playwright/test').Locator, deltaX: number, deltaY: number) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Drag target is not visible.');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await locator.page().mouse.move(x, y);
  await locator.page().mouse.down();
  await locator.page().mouse.move(x + deltaX, y + deltaY, { steps: 8 });
  await locator.page().mouse.up();
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
