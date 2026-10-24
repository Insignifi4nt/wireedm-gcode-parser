import { expect, test } from '@playwright/test';

import { confirmPendingDxfImport } from './dxf-import';

test('keyboard activation of controller diagnostics opens and focuses parse issues', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('DXF file', { exact: true })).toBeEnabled();
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
  await expect(page.getByLabel('DXF file', { exact: true })).toBeEnabled();
  await page.getByLabel('DXF file').setInputFiles('tests/fixtures/machine-packages/robofil-100-v2/no-lead-rectangle.dxf');
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
  await page.getByRole('button', { name: 'Apply Initial wire position workflow', exact: true }).click();
  await expect(issue).toHaveCount(0);
  // Resolving the first blocker must reveal, not bypass, the next intent decision.
  await page.getByRole('button', { name: 'Expand Exterior 1', exact: true }).click();
  await page.getByRole('treeitem').filter({ hasText: 'needs an explicit controller compensation or wire-center choice' }).last().dblclick();
  await page.getByLabel('Compensation kept material').selectOption('outside');
  await page.getByRole('button', { name: 'Apply Contour Setup workflow', exact: true }).click();
  const rows = page.locator('[data-tree-key="section:program"] > ul > li');
  await expect(rows.first()).toContainText('Program start');
  await expect(rows.last()).toContainText('Program end');
  await page.getByRole('button', { name: 'Save active document', exact: true }).click();
  await expect(page.locator('[data-editor-document-state]')).toHaveText('Saved');
});

test('repairs partial compensation through its diagnostic while preserving pending-form cancellation and Undo', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('DXF file', { exact: true })).toBeEnabled();
  await page.getByLabel('DXF file').setInputFiles({ name: 'partial-compensation-circle.dxf', mimeType: 'application/dxf',
    buffer: Buffer.from('0\nSECTION\n2\nENTITIES\n0\nCIRCLE\n8\nCUT\n10\n0\n20\n0\n40\n10\n0\nENDSEC\n0\nEOF\n') });
  await confirmPendingDxfImport(page);
  await page.locator('[data-editor-status-diagnostics]').click();
  await page.getByRole('button', { name: 'Review initial wire position for Program setup', exact: true }).click();
  await page.getByLabel('Initial wire X', { exact: true }).fill('10');
  await page.getByLabel('Initial wire Y', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Review and set manual initial wire position', exact: true }).click();
  await page.getByRole('button', { name: 'Apply Initial wire position workflow', exact: true }).click();

  await page.getByRole('button', { name: 'Machining menu', exact: true }).click();
  await page.locator('[data-editor-workflow-command="machining.participation"]').click();
  await page.getByLabel('Machining span start', { exact: true }).fill('25');
  await page.getByLabel('Machining span end', { exact: true }).fill('75');
  await page.getByRole('button', { name: 'Mark inactive reference', exact: true }).click();
  await page.getByRole('button', { name: 'Apply Machining Participation workflow', exact: true }).click();

  await page.locator('[data-editor-status-diagnostics]').click();
  const issue = page.locator('[data-editor-execution-diagnostic="EXECUTION_PLAN_COMPENSATION_UNRESOLVED"]');
  await expect(issue.locator('[data-editor-execution-diagnostic-context]')).toHaveText('Contour 01 · Exterior 1');
  await issue.getByRole('button', { name: 'Review partial-path compensation for Contour 01 · Exterior 1', exact: true }).click();
  await expect(page.getByLabel('Partial contour wire side', { exact: true })).toBeVisible();
  await expect(page.locator('[data-editor-status-selection]')).toHaveText('Selection Exterior 1');

  await page.getByLabel('Machining span start', { exact: true }).fill('20');
  await page.locator('[data-tree-key="diagnostic:EXECUTION_PLAN_COMPENSATION_UNRESOLVED:0"] > div').dblclick();
  const pending = page.getByRole('dialog', { name: 'Pending workflow changes', exact: true });
  await expect(pending).toBeVisible();
  await expect(pending.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(pending).toHaveCount(0);
  await expect(page.getByLabel('Machining span start', { exact: true })).toHaveValue('20');
  await page.getByRole('button', { name: 'Cancel Machining Participation workflow', exact: true }).click();
  await pending.getByRole('button', { name: 'Discard', exact: true }).click();

  await page.locator('[data-editor-status-diagnostics]').click();
  await issue.getByRole('button', { name: 'Review partial-path compensation for Contour 01 · Exterior 1', exact: true }).click();
  await page.getByLabel('Partial contour wire side', { exact: true }).selectOption('right');
  await page.getByRole('button', { name: 'Apply Machining Participation workflow', exact: true }).click();
  await expect(page.locator('[data-tree-key="section:program"] > ul > li').first()).toContainText('Program start');
  await expect(page.locator('[data-tree-key="section:program"] > ul > li').last()).toContainText('Program end');

  await page.getByRole('button', { name: 'Undo active document change', exact: true }).click();
  await page.locator('[data-editor-status-diagnostics]').click();
  await expect(issue.getByRole('button')).toHaveText('Review partial-path compensation');
  await page.getByRole('button', { name: 'Redo active document change', exact: true }).click();
  await expect(issue).toHaveCount(0);
});
