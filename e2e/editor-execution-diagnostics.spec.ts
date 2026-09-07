import { expect, test } from '@playwright/test';

import { confirmPendingDxfImport } from './dxf-import';

test('repairs an execution issue through its owning tool and updates readiness', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Go Build!', exact: true }).click();
  await page.getByLabel('DXF file').setInputFiles('examples/robofil-100-v2/no-lead-rectangle.dxf');
  await confirmPendingDxfImport(page);

  const issue = page.getByRole('treeitem').filter({ hasText: 'A reviewed initial wire position is required' }).last();
  await expect(page.locator('[data-editor-status-diagnostics]')).toHaveText('Diagnostics 1');
  await page.getByRole('button', { name: 'View menu', exact: true }).click();
  await page.locator('[data-editor-workflow-command="view.diagnostics"]').click();
  await expect(page.getByRole('region', { name: 'Execution issues' })).toContainText('A reviewed initial wire position is required');
  await page.getByRole('button', { name: 'Hide Path Diagnostics', exact: true }).click();

  await issue.dblclick();
  await page.getByLabel('Initial wire X', { exact: true }).fill('0');
  await page.getByLabel('Initial wire Y', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Review and set manual initial wire position', exact: true }).click();
  await page.getByRole('button', { name: 'Save Initial wire position workflow', exact: true }).click();
  await expect(page.locator('[data-editor-status-diagnostics]')).toHaveText('Diagnostics 0');
  const rows = page.locator('[data-tree-key="section:program"] > ul > li');
  await expect(rows.first()).toContainText('program-start');
  await expect(rows.last()).toContainText('program-end');
  await page.getByRole('button', { name: 'Save active document', exact: true }).click();
  await expect(page.locator('[data-editor-document-state]')).toHaveText('Saved');
});
