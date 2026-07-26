import { expect, type Page } from '@playwright/test';

export async function confirmPendingDxfImport(
  page: Page,
  expectedUnitCandidateId = 'millimeters'
) {
  const dialog = page.getByRole('dialog', { name: 'Review DXF import' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('DXF units')).toHaveValue(expectedUnitCandidateId);
  await dialog.getByRole('button', { name: 'Import and open' }).click();
  const onboarding = page.getByRole('dialog', { name: 'Thanks for trying Wire EDM Workbench' });
  if (await onboarding.isVisible()) await onboarding.getByRole('button', { name: 'Go Build!' }).click();
}
