import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadBuildResult, CadCurveFeature, CadDocument } from '@/domain/cad/cadDocument';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { resolveCadCurve } from '@/domain/cad/cadCurve';
import { measureCadCurve } from '@/domain/cad/cadCurveMeasurements';
import { exportCadCurveDxf, importCadDxfCurve } from '@/domain/cad/cadCurveDxf';
import { CadSession } from './cadSession';
import { CadWorkbench } from './CadWorkbench';
import type { CadCurveViewportReference } from './cadCurveRendering';
import type { CadWorkbenchViewportControls } from './cadViewportControls';

vi.mock('./CadViewport', () => ({ CadViewport: ({ hidden, references, meshes, onSelect }: { hidden?: boolean; references: readonly CadCurveViewportReference[]; meshes: readonly { featureId: string }[]; onSelect(id: string): void }) =>
  hidden ? <div className="cad-viewport" hidden /> : <div aria-label="3D model viewport" data-solid-count={meshes.length}>{references.flatMap(reference => reference.featureId === null ? [] : [<button key={reference.referenceId} onClick={() => { if (reference.featureId !== null) onSelect(reference.featureId); }}>Select world {reference.name}</button>])}</div> }));
let root: Root; let container: HTMLDivElement; let session: CadSession; let controls: CadWorkbenchViewportControls | null;
beforeEach(() => {
  controls = null; vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800); vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const curve = (source?: CadCurveFeature['source']): CadCurveFeature => ({ id: 'rail', name: 'Rail', kind: 'curve', plane: 'XZ', offset: 4, suppressed: false,
  segments: [{ kind: 'line', start: [0, 0], end: [20, 0] }, { kind: 'arc', center: [20, 10], radius: 10, startAngle: -90, sweep: 180 }], ...(source ? { source } : {}) });
async function mount(document: CadDocument = createCadDocument(), staleBuild: CadBuildResult | null = null) {
  session = new CadSession(document);
  function Harness() {
    const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
    return <CadWorkbench document={state.document} documentVersion={state.version} buildVersion={staleBuild ? 'previous-document' : null} build={staleBuild} buildState={staleBuild ? 'ready' : 'idle'} dirty={state.dirty} canUndo={state.canUndo} canRedo={state.canRedo}
      onEditMany={edits => { session.edit(edits); }} onEdit={edit => { session.edit([edit]); }} onUndo={() => session.undo()} onRedo={() => session.redo()} onWorkflowChange={session.setWorkflowOpen}
      onSave={async () => undefined} onBack={vi.fn()} onNewDocument={vi.fn()} onOpenDocument={vi.fn()} onImportDocument={async () => undefined}
      onExportDocument={vi.fn()} onExportSolid={async () => undefined} onOpenDxfExport={async () => undefined} onSendToCam={async () => undefined}
      onViewportControlsReady={value => { controls = value; }} />;
  }
  await act(async () => root.render(<Harness />));
}
function button(label: string) {
  const result = [...container.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label || button.textContent?.trim() === label);
  if (!result) throw new Error(`Missing ${label}`); return result;
}
async function click(label: string) { await act(async () => button(label).click()); }
function field(label: string) {
  const result = [...container.querySelectorAll('label')].find(entry => entry.querySelector('span')?.childNodes[0]?.textContent === label)?.querySelector('input');
  if (!result) throw new Error(`Missing ${label}`); return result;
}
async function input(label: string, value: string) {
  const element = field(label); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function key(key: string, init: KeyboardEventInit = {}) {
  const svg = container.querySelector<SVGSVGElement>('[aria-label="Curve drawing canvas"]'); if (!svg) throw new Error('Curve canvas unavailable');
  await act(async () => { svg.focus(); svg.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })); });
}
async function steps(keyName: string, count: number) { for (let index = 0; index < count; index++) await key(keyName); }
function currentCurve() { const feature = session.getSnapshot().document.features.find(feature => feature.kind === 'curve'); if (feature?.kind !== 'curve') throw new Error('Curve missing'); return feature; }

describe('Curve foundation workbench', () => {
  it('hides a previous solid build immediately when the current document only contains curves', async () => {
    await mount({ ...createCadDocument(), features: [curve()] }, { buildId: 'old-build', durationMs: 0, diagnostics: [], meshes: [{ featureId: 'rail', name: 'Old solid', positions: [], normals: [], indices: [], edges: [], faceGroups: [], edgeGroups: [], volume: 99, bounds: { min: [0, 0, 0], max: [10, 10, 10] } }] });
    expect(container.querySelector('[aria-label="3D model viewport"]')?.getAttribute('data-solid-count')).toBe('0');
    await click('Select world Rail'); expect(container.querySelector('.cad-solid-info')).toBeNull();
    await click('File'); expect(button('Export STEP').disabled).toBe(true); expect(button('Export STL').disabled).toBe(true);
    expect(button('Export DXF').disabled).toBe(false); expect(button('Send sketch to CAM').disabled).toBe(true);
  });
  it('creates one complete open line/arc feature without an empty save or hidden closing edge', async () => {
    await mount({ ...createCadDocument(), parameters: { lift: 8 } }); const before = session.getSnapshot(); await click('Curve');
    expect(session.getSnapshot()).toMatchObject({ document: before.document, version: before.version, canUndo: false, workflowOpen: true }); expect(button('Save').disabled).toBe(true);
    await input('Name', 'Guide'); await input('Plane offset', 'lift / 2');
    const plane = [...container.querySelectorAll('select')].find(select => select.closest('label')?.textContent?.startsWith('Reference plane'))!;
    await act(async () => { plane.value = 'XZ'; plane.dispatchEvent(new Event('change', { bubbles: true })); });
    await key(' '); await steps('ArrowRight', 4); await key(' '); await click('3-point Arc'); await steps('ArrowUp', 4); await key(' ');
    expect(button('Finish curve').disabled).toBe(true); await steps('ArrowRight', 2); await steps('ArrowDown', 2); await key('Enter'); await click('Finish curve');
    const accepted = currentCurve(); expect(accepted).toMatchObject({ name: 'Guide', plane: 'XZ', offset: 'lift / 2' }); expect(accepted.segments).toHaveLength(2);
    expect(resolveCadCurve(accepted, session.getSnapshot().document.parameters).endWorld).toEqual([20, -4, 20]);
    expect(session.getSnapshot().workflowOpen).toBe(false); expect(controls?.getState()).toMatchObject({ curveId: accepted.id, sketchId: null, view: { mode: 'curve', available: true } });
    expect(measureCadCurve(session.getSnapshot().document, accepted.id).lengthMm).toBeCloseTo(51.4159, 4);
    await click('Finish curve editing'); expect(button('Select world Guide')).toBeDefined();
    await click('Undo'); expect(session.getSnapshot().document).toEqual(before.document); expect(session.getSnapshot().canUndo).toBe(false);
  });

  it('retains a closed/invalid drawing and permits metadata repair before the same atomic finish', async () => {
    await mount(); const before = session.getSnapshot(); await click('Curve'); await input('Name', '');
    await key(' '); await steps('ArrowRight', 4); await key(' '); await click('Finish curve');
    expect(session.getSnapshot()).toMatchObject({ document: before.document, version: before.version, canUndo: false, workflowOpen: true });
    expect(field('Name').disabled).toBe(false); await input('Name', 'Fixed'); await click('Finish curve'); expect(currentCurve().segments).toHaveLength(1);
    await click('Finish curve editing'); await click('Curve'); await key(' '); await steps('ArrowRight', 4); await key(' '); await steps('ArrowLeft', 4); await key(' '); await click('Finish curve');
    expect(session.getSnapshot().document.features).toHaveLength(1); expect(session.getSnapshot().workflowOpen).toBe(true);
    await click('Undo last'); await click('Finish curve'); expect(session.getSnapshot().document.features).toHaveLength(2);
  });

  it('cancels metadata and a pending arc together without touching document/version/history', async () => {
    await mount(); const before = session.getSnapshot(); await click('Curve'); await input('Name', 'Discard'); await input('Plane offset', '9');
    await click('3-point Arc'); await key(' '); await steps('ArrowRight', 4); await key(' '); await key('Escape');
    expect(session.getSnapshot()).toEqual(before); expect(button('Curve').disabled).toBe(false); expect(container.querySelector('[aria-label="3D model viewport"]')).not.toBeNull();
  });

  it('edits exact segment expressions atomically, keeps invalid joins pending and leaves native text undo alone', async () => {
    const originalText = exportCadCurveDxf(curve(), {});
    const imported = importCadDxfCurve({ fileName: 'rail.dxf', text: originalText, units: 'mm', curveId: 'rail', name: 'Rail' }).curve;
    await mount({ ...createCadDocument(), parameters: { length: 20 }, features: [imported] });
    await act(async () => button('Select Rail in history').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))); const before = session.getSnapshot();
    await input('End X', 'length + 5'); await click('Apply'); expect(session.getSnapshot().document).toBe(before.document); expect(session.getSnapshot().version).toBe(before.version);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('connect');
    await click('Next curve segment'); await input('Center X', 'length + 5');
    const nativeUndo = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, cancelable: true, bubbles: true }); await act(async () => field('Center X').dispatchEvent(nativeUndo)); expect(nativeUndo.defaultPrevented).toBe(false);
    await click('Apply'); expect(currentCurve().segments).toMatchObject([{ end: ['length + 5', 0] }, { center: ['length + 5', 10] }]); expect(session.getSnapshot().workflowOpen).toBe(false);
    expect(currentCurve().source).toEqual(imported.source); expect(currentCurve().source?.text).toBe(originalText);
    await input('Radius', 'missing'); await click('Cancel'); await click('Next curve segment'); expect(field('Radius').value).toBe('10');
  });
});
