import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { seedWorkbenchCacheFromFolder } from './fixtures/workbench-cache';

const workbenchFolder = findWorkbenchFolder();

test.skip(
  !workbenchFolder,
  'Set WIREDM_PLAYWRIGHT_WORKBENCH or keep USERPROFILE/Documents/WireEDM_WEB_FOLDER available.'
);

test('opens the latest seeded workbench project in the editor', async ({ page }) => {
  const seed = await seedWorkbenchCacheFromFolder(page, { folder: workbenchFolder ?? undefined });
  const activeFilePath = seed.projectDocument.editor?.activeFilePath;
  if (!activeFilePath) throw new Error('Seeded project has no active editor file.');

  await page.goto('/');
  const openProjectButton = page.getByRole('button', {
    name: `Open project ${seed.selectedProject.id} in editor`
  });
  await expect(openProjectButton).toBeVisible();
  await openProjectButton.click();

  await expect(page.getByRole('heading', { name: activeFilePath })).toBeVisible();
  await expect(page.getByText(/UPID Path Navigator/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /open upid export preview/i })).toBeVisible();
});

function findWorkbenchFolder() {
  const candidates = [
    process.env.WIREDM_PLAYWRIGHT_WORKBENCH,
    process.env.USERPROFILE
      ? path.join(process.env.USERPROFILE, 'Documents', 'WireEDM_WEB_FOLDER')
      : null
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) =>
    fs.existsSync(path.join(candidate, 'workbench.json'))
  ) ?? null;
}
