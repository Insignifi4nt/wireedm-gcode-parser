import { expect, test } from '@playwright/test';

import { confirmPendingDxfImport } from './dxf-import';

test('keyboard activation of controller diagnostics opens and focuses parse issues', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Go Build!', exact: true }).click();
  await page.getByLabel('Machine program file', { exact: true }).setInputFiles({
    name: 'invalid-radius.nc',
    mimeType: 'text/plain',
    buffer: Buffer.from('G0 X0 Y0\nG2 X10 Y0 R4')
  });
  await page.getByRole('button', { name: 'Collapse Inspector Rail', exact: true }).click();
  const diagnostics = page.locator('[data-editor-status-diagnostics]');
  await expect(diagnostics).toHaveText('Diagnostics 1');
  await diagnostics.focus();
  await page.keyboard.press('Enter');

  const issues = page.getByRole('region', { name: 'Parse issues', exact: true });
  await expect(issues).toBeVisible();
  await expect(issues).toBeFocused();
  await expect(issues.locator('[data-editor-parse-issue]')).toContainText('Line 2');
});

test('repairs an execution issue through its owning tool and updates readiness', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Go Build!', exact: true }).click();
  await page.getByLabel('DXF file').setInputFiles('examples/robofil-100-v2/no-lead-rectangle.dxf');
  await confirmPendingDxfImport(page);

  const issue = page.getByRole('treeitem').filter({ hasText: 'A reviewed initial wire position is required' }).last();
  await expect(page.locator('[data-editor-status-diagnostics]')).toHaveText('Diagnostics 1');
  await page.getByRole('button', { name: 'Diagnostics 1', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Execution issues' })).toContainText('A reviewed initial wire position is required');
  await page.getByRole('button', { name: 'Hide Path Diagnostics', exact: true }).click();

  await issue.dblclick();
  await page.getByLabel('Initial wire X', { exact: true }).fill('0');
  await page.getByLabel('Initial wire Y', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Review and set manual initial wire position', exact: true }).click();
  await page.getByRole('button', { name: 'Save Initial wire position workflow', exact: true }).click();
  const rows = page.locator('[data-tree-key="section:program"] > ul > li');
  await expect(rows.first()).toContainText('Program start');
  await expect(rows.last()).toContainText('Program end');
  await page.getByRole('button', { name: 'Save active document', exact: true }).click();
  await expect(page.locator('[data-editor-document-state]')).toHaveText('Saved');
});
