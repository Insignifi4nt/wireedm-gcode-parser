import { expect, test } from '@playwright/test';
import { readWorkbenchCacheFile } from './fixtures/workbench-cache';

test('opens a phone browser cache with the former external-program layout and keeps its edited program', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  const id = 'prisma1-2026-07-14';
  const timestamp = '2026-07-14T12:00:00.000Z';
  const oldProjectPath = `projects/${id}/project.json`;
  const activeFilePath = `editor/${id}.iso`;
  const originalProgram = '%\r\nG90\r\nG0 X0 Y0\r\nG1 X1 Y2\r\nM02\r\n';
  const editedProgram = 'G90\nG0 X0 Y0\nG1 X40 Y20\n';
  const originalProject = JSON.stringify({
    schemaVersion: 1, id, name: 'Prisma1', createdAt: timestamp, updatedAt: timestamp,
    source: { kind: 'external-gcode', files: [{ name: `${id}.iso`, path: `imports/${id}.iso`, kind: 'external-gcode', createdAt: timestamp }] },
    machine: { id: 'legacy-machine' }, editor: { activeFilePath, pinnedLineNumbers: [3] }
  });
  const originalManifest = JSON.stringify({
    schemaVersion: 1, name: 'Phone workbench', createdAt: timestamp, updatedAt: timestamp,
    templates: {}, output: {}, activeMachineProfileId: 'legacy-machine', machineProfiles: [],
    projects: [{ id, name: 'Prisma1', path: oldProjectPath, sourceKind: 'external-gcode', updatedAt: timestamp }]
  });
  await page.addInitScript(({ entries }) => {
    if (localStorage.getItem('wire-edm-workbench:file:workbench.json') === null) {
      for (const [path, contents] of entries) localStorage.setItem(`wire-edm-workbench:file:${path}`, contents);
      localStorage.setItem('wireedm.onboarding.dismissed', 'true');
    }
  }, { entries: [
    ['workbench.json', originalManifest], [oldProjectPath, originalProject],
    [`imports/${id}.iso`, originalProgram], [activeFilePath, editedProgram]
  ] });
  await page.goto('/');
  await expect(page.locator('[data-storage-status-label]')).toHaveText('Browser cache active');
  await expect(page.getByRole('button', { name: `Open project ${id} in editor` })).toBeVisible();
  await page.getByRole('button', { name: `Open project ${id} in editor` }).click();
  await expect(page.locator('path[data-preview-source="gcode"][data-type="cut"]').first()).toHaveAttribute('d', 'M 0 0 L 40 20');
  expect(await readWorkbenchCacheFile(page, activeFilePath)).toBe(editedProgram);
  expect(await readWorkbenchCacheFile(page, `imports/${id}.iso`)).toBe(originalProgram);
  expect(await readWorkbenchCacheFile(page, oldProjectPath)).toBe(originalProject);
  expect(await readWorkbenchCacheFile(page, `legacy/v1/projects/${id}.json`)).toBe(originalProject);
  expect(await readWorkbenchCacheFile(page, 'legacy/v1/workbench.json')).toBe(originalManifest);
  await page.reload();
  await expect(page.getByRole('button', { name: `Open project ${id} in editor` })).toBeVisible();
  await page.getByRole('button', { name: `Open project ${id} in editor` }).click();
  await expect(page.locator('path[data-preview-source="gcode"][data-type="cut"]').first()).toHaveAttribute('d', 'M 0 0 L 40 20');
});
