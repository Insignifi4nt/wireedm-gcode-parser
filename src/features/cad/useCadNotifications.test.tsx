import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkbenchAppController } from '@/app/useWorkbenchAppController';
import { StatusNotificationMenu, StatusToastList } from '@/components/StatusToasts';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { useCadNotifications, type CadNotificationState } from './useCadNotifications';

let root: Root;
let container: HTMLDivElement;
const report = vi.fn();
const document = { ...createCadDocument('Gear part'), features: [{ id: 'pad', kind: 'extrude', name: 'Gear thickness', suppressed: false,
  sketchId: 'sketch', distance: 10, symmetric: true, operation: 'new', targetId: null }] } satisfies CadNotificationState['document'];
const failureBuild = { buildId: 'build1', meshes: [], durationMs: 1, diagnostics: [
    { code: 'topology-limit', featureId: 'pad', message: 'Each body may contain at most 10000 distinct faces and edges.' },
    { code: 'rebuild-stopped', featureId: 'pad', message: 'Rebuild stopped here. The preview shows the preceding valid features.' }
  ] } satisfies NonNullable<CadNotificationState['build']>;
const failed: CadNotificationState = { document, documentVersion: 'v1', buildVersion: 'v1', buildState: 'error', errorMessage: null,
  onStatusMessage: report, build: failureBuild };

beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); report.mockClear(); container = window.document.createElement('div'); window.document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
function Harness({ state }: { state: CadNotificationState }) { useCadNotifications(state); return null; }
async function render(state: CadNotificationState) { await act(async () => root.render(<Harness state={state} />)); }

describe('CAD failure notifications', () => {
  it('reports the cause and stopped-preview context together, once across renders and identical retries', async () => {
    await render(failed);
    expect(report).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('Gear part · Gear thickness: Each body'), 'error');
    expect(report.mock.calls[0][0]).toContain('preceding valid features');
    await render({ ...failed, onStatusMessage: (message, type) => report(message, type) });
    await render({ ...failed, documentVersion: 'v2', buildState: 'building' });
    await render({ ...failed, documentVersion: 'v2', buildVersion: 'v2', build: { ...failureBuild, buildId: 'retry' } });
    expect(report).toHaveBeenCalledTimes(1);
  });
  it('ignores stale results and reports a recurring failure after a successful rebuild', async () => {
    await render({ ...failed, buildVersion: 'old' }); expect(report).not.toHaveBeenCalled();
    await render(failed);
    await render({ ...failed, buildState: 'ready', build: { buildId: 'good', meshes: [], diagnostics: [], durationMs: 1 } });
    await render(failed); expect(report).toHaveBeenCalledTimes(2);
    await render({ ...failed, document: { ...document, id: 'another-part' } }); expect(report).toHaveBeenCalledTimes(3);
  });
  it('reports operation failures as episodes and preserves standalone rebuild diagnostics', async () => {
    const empty = { ...failed, build: null, buildState: 'idle' } satisfies CadNotificationState;
    await render({ ...empty, errorMessage: 'Cannot save' });
    await render({ ...empty, errorMessage: 'Cannot save' }); expect(report).toHaveBeenCalledTimes(1);
    await render(empty); await render({ ...empty, errorMessage: 'Cannot save' }); expect(report).toHaveBeenCalledTimes(2);
    await render({ ...failed, build: { buildId: 'stopped', meshes: [], durationMs: 1, diagnostics: [{ code: 'rebuild-stopped', message: 'Stopped' }] } });
    expect(report).toHaveBeenLastCalledWith('Gear part: Stopped', 'error');
  });
  it('keeps the real app notification after dismissing its toast', async () => {
    function Integrated() {
      const app = useWorkbenchAppController({ connectRememberedWorkbenchDirectory: async () => ({ status: 'missing' }) });
      useCadNotifications({ ...failed, onStatusMessage: app.showStatusToast });
      return <><StatusToastList toasts={app.statusToasts} onDismiss={app.dismissStatusToast} /><StatusNotificationMenu notifications={app.statusNotifications} /></>;
    }
    await act(async () => root.render(<Integrated />));
    const toast = container.querySelector<HTMLButtonElement>('[data-status-toast="error"]');
    expect(toast?.textContent).toContain('Gear thickness');
    await act(async () => toast?.click()); expect(container.querySelector('[data-status-toast]')).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Open notifications"]')?.click());
    expect(window.document.querySelector('[data-status-notification-menu]')?.textContent).toContain('10000 distinct faces and edges');
    expect(container.querySelector('[data-status-notification-count]')?.textContent).toBe('1');
  });
});
