import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { seedWorkbenchCacheFromFolder } from './fixtures/workbench-cache';

const workbenchFolder = findWorkbenchFolder();

test.skip(
  !workbenchFolder,
  'Set WIREDM_PLAYWRIGHT_WORKBENCH or keep USERPROFILE/Documents/WireEDM_WEB_FOLDER available.'
);

test('editor uses one header and resizable collapsible side rails', async ({ page }) => {
  const projectId = findEditorProjectId(workbenchFolder);
  test.skip(!projectId, 'Seeded workbench has no project with an active editor file.');

  const seed = await seedWorkbenchCacheFromFolder(page, {
    folder: workbenchFolder ?? undefined,
    project: projectId
  });
  const activeFilePath = seed.projectDocument.editor?.activeFilePath;
  if (!activeFilePath) throw new Error('Seeded project has no active editor file.');

  await page.setViewportSize({ width: 1584, height: 1158 });
  await page.goto('/');
  await page.getByRole('button', { name: `Open project ${seed.selectedProject.id} in editor` }).click();

  const appHeader = page.locator('[data-app-header]');
  await expect(appHeader.getByRole('button', { name: /dashboard/i })).toBeVisible();
  await expect(appHeader).not.toContainText('Wire EDM Workbench');
  await expect(appHeader.getByText(activeFilePath)).toBeVisible();
  await expect(appHeader.getByRole('button', { name: /import program/i })).toBeVisible();
  await expect(appHeader.getByRole('button', { name: /open usage guide/i })).toBeVisible();
  await expect(page.locator('[data-editor-header-bar]')).toHaveCount(0);

  const previewHeader = page.locator('[data-editor-preview-header]');
  await expect(previewHeader).toContainText('Preview');
  await expect(previewHeader.getByRole('button', { name: /zoom preview out/i })).toBeVisible();
  await expect(previewHeader.getByRole('button', { name: /fit preview to screen/i })).toBeVisible();
  await expect(page.locator('[data-editor-preview-toolbar]')).toHaveCount(0);

  const appRail = page.locator('[data-app-rail]');
  const appRailStart = await readWidth(appRail);
  await drag(page.locator('[data-app-rail-resizer]'), 60, 0);
  await expect.poll(() => readWidth(appRail)).toBeGreaterThan(appRailStart + 30);

  const rightRail = page.locator('[data-editor-inspector-rail]');
  const rightRailStart = await readWidth(rightRail);
  await drag(page.locator('[data-editor-inspector-resizer]'), 70, 0);
  await expect.poll(() => readWidth(rightRail)).toBeLessThan(rightRailStart - 35);

  await page.getByRole('button', { name: /collapse right bar/i }).click();
  await expect(page.locator('[data-editor-inspector-collapsed]')).toBeVisible();
  await expect(rightRail).not.toBeVisible();
  await page.getByRole('button', { name: /expand right bar/i }).click();
  await expect(rightRail).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll('*')]
          .filter((element) => element.scrollHeight > element.clientHeight)
          .every((element) => getComputedStyle(element).scrollbarWidth === 'none')
      )
    )
    .toBe(true);
});

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

function findWorkbenchFolder() {
  const candidates = [
    process.env.WIREDM_PLAYWRIGHT_WORKBENCH,
    process.env.USERPROFILE
      ? path.join(process.env.USERPROFILE, 'Documents', 'WireEDM_WEB_FOLDER')
      : null,
    process.env.HOME
      ? path.join(process.env.HOME, 'Documents', 'WireEDM_WEB_FOLDER')
      : null
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) =>
    fs.existsSync(path.join(candidate, 'workbench.json'))
  ) ?? null;
}

function findEditorProjectId(folder: string | undefined | null) {
  if (!folder) return null;
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'workbench.json'), 'utf8'));
  const projects = [...(manifest.projects ?? [])].sort((left, right) => {
    const rightTime = Date.parse(right.updatedAt ?? '') || 0;
    const leftTime = Date.parse(left.updatedAt ?? '') || 0;
    return rightTime - leftTime;
  });

  for (const project of projects) {
    const projectDocument = JSON.parse(fs.readFileSync(path.join(folder, project.path), 'utf8'));
    if (projectDocument.editor?.activeFilePath) return project.id;
  }
  return null;
}
