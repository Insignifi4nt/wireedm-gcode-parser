import { expect, test, type Page } from '@playwright/test';
import { readWorkbenchCacheFile } from './fixtures/workbench-cache';

function lines(count: number) {
  return '0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n' +
    Array.from({ length: count }, (_, index) => `0\nLINE\n8\nCUT 日本\n10\n${index * 2}\n20\n0\n11\n${index * 2 + 1}\n21\n0\n`).join('') + '0\nENDSEC\n0\nEOF\n';
}

async function instrumentWorkers(page: Page) {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const logs: { kind: string; event: string }[] = [];
    Object.assign(window, { dxfWorkerLog: logs });
    window.Worker = class extends NativeWorker {
      private kind = '';
      postMessage(message: unknown, transfer?: Transferable[]) {
        const request = message as { kind?: string };
        this.kind = request.kind ?? '';
        if (this.kind === 'prepare' || this.kind === 'plan') logs.push({ kind: this.kind, event: 'start' });
        super.postMessage(message, transfer ?? []);
      }
      terminate() {
        if (this.kind === 'prepare' || this.kind === 'plan') logs.push({ kind: this.kind, event: 'terminate' });
        super.terminate();
      }
    };
  });
}

test('real DXF workers preserve reviewed units, source bytes and saved geometry', async ({ page }) => {
  await instrumentWorkers(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Go Build!', exact: true }).click();
  const text = lines(3).replaceAll('\n', '\r\n');
  await page.getByLabel('DXF file', { exact: true }).setInputFiles({ name: 'worker-original.dxf', mimeType: 'application/dxf', buffer: Buffer.from(text) });
  const review = page.getByRole('dialog', { name: 'Review DXF import', exact: true });
  await expect(review).toBeVisible();
  await expect(review.getByTestId('dxf-import-size')).toHaveText('5.000 × 0.000 mm');
  await review.getByRole('button', { name: 'Import and open', exact: true }).click();
  await expect(page.locator('[data-editor-document-state]')).toHaveText('Saved');
  const manifest = JSON.parse(await readWorkbenchCacheFile(page, 'workbench.json'));
  expect(manifest.projects).toHaveLength(1);
  const project = JSON.parse(await readWorkbenchCacheFile(page, manifest.projects[0].path));
  expect(project.content.document.segments).toHaveLength(3);
  expect(project.content.document.source.appliedUnits.scaleToMillimeters).toBe(1);
  expect(await readWorkbenchCacheFile(page, project.source.files[0].path)).toBe(text);
  expect(await page.evaluate(() => (window as unknown as { dxfWorkerLog: unknown[] }).dxfWorkerLog)).toEqual([
    { kind: 'prepare', event: 'start' }, { kind: 'prepare', event: 'terminate' },
    { kind: 'plan', event: 'start' }, { kind: 'plan', event: 'terminate' }
  ]);
});

test('cancel remains responsive during real large DXF planning and writes no project', async ({ page }) => {
  await instrumentWorkers(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Go Build!', exact: true }).click();
  await page.getByLabel('DXF file', { exact: true }).setInputFiles({ name: 'bounded-large.dxf', mimeType: 'application/dxf', buffer: Buffer.from(lines(5000)) });
  const review = page.getByRole('dialog', { name: 'Review DXF import', exact: true });
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: 'Import and open', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { dxfWorkerLog: { kind: string; event: string }[] }).dxfWorkerLog.some(entry => entry.kind === 'plan' && entry.event === 'start'))).toBe(true);
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(review).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Import DXF as Path Project', exact: true })).toBeEnabled();
  const manifest = JSON.parse(await readWorkbenchCacheFile(page, 'workbench.json'));
  expect(manifest.projects).toHaveLength(0);
  expect(await page.evaluate(() => (window as unknown as { dxfWorkerLog: { kind: string; event: string }[] }).dxfWorkerLog.filter(entry => entry.kind === 'plan'))).toEqual([
    { kind: 'plan', event: 'start' }, { kind: 'plan', event: 'terminate' }
  ]);
  await page.getByLabel('DXF file', { exact: true }).setInputFiles({ name: 'retry.dxf', mimeType: 'application/dxf', buffer: Buffer.from(lines(1)) });
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: 'Import and open', exact: true }).click();
  await expect(page.locator('[data-editor-document-state]')).toHaveText('Saved');
});
