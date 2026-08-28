import { expect, type Page } from '@playwright/test';

export async function confirmPendingDxfImport(
  page: Page,
  expectedUnitCandidateId = 'millimeters'
) {
  const dialog = page.getByRole('dialog', { name: 'Review DXF import' });
  await expect(dialog).toBeVisible();
  const units = dialog.getByLabel('DXF units');
  await units.selectOption(expectedUnitCandidateId);
  await expect(units).toHaveValue(expectedUnitCandidateId);
  const importButton = dialog.getByRole('button', { name: 'Import and open' });
  await expect(importButton).toBeEnabled();
  await importButton.click();
  const onboarding = page.getByRole('dialog', { name: 'Thanks for trying Wire EDM Workbench' });
  if (await onboarding.isVisible()) await onboarding.getByRole('button', { name: 'Go Build!' }).click();
}
