import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CadDocument } from '@/domain/cad/cadDocument';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { CadFeatureTree } from './CadFeatureTree';
import { CadSketchCanvas } from './CadSketchCanvas';
import type { CadRenderedViewControls } from './cadViewportControls';

let root: Root, container: HTMLDivElement, controls: CadRenderedViewControls | null;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container); controls = null;
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const fixture = (): CadDocument => parseCadDocument({ ...createCadDocument('Fit'), features: [{ id: 'outline', name: 'S', kind: 'sketch', suppressed: false,
  plane: 'XY', offset: 0, profiles: [{ id: 'outside', name: 'Outside contour for complete mounting plate stock and final wire-cut boundary', construction: false,
    geometry: { kind: 'rectangle', x: 100000000, y: 100000000, width: 40, height: 20, cornerRadius: 0 } }] }] });
function state() { const value = controls?.getState(); if (!value || value.mode === 'solid') throw new Error('Sketch controls missing'); return value; }
function profileRow() { return container.querySelector('[data-cad-profile-id="outside"]'); }
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label);
  if (!button) throw new Error(`Missing ${label}`); await act(async () => button.click());
}
async function show(document: CadDocument, selectedId: string | null, editing = false) {
  const sketch = document.features[0]; if (sketch.kind !== 'sketch') throw new Error('Sketch fixture missing');
  // jsdom has no layout engine. The real tree's current DOM determines which
  // measured clear area is returned, in the same Canvas-before-Tree order as
  // CadWorkbench. No tree or canvas lifecycle is mocked.
  const getFitArea = () => ({ left: profileRow() ? 340 : 130, top: 0, width: profileRow() ? 660 : 870, height: 500 });
  await act(async () => root.render(<>
    {editing && <CadSketchCanvas sketch={sketch} parameters={document.parameters} tool="select" selectedProfileId={null}
      onSelectProfile={vi.fn()} onAddProfile={vi.fn()} onPendingChange={vi.fn()} onError={vi.fn()} cancelSignal={0} getFitArea={getFitArea}
      onControlsReady={value => { controls = value; }} />}
    <CadFeatureTree document={document} selectedId={selectedId} selectedProfileId={null} locked={false}
      onSelect={vi.fn()} onEditSketch={vi.fn()} onEditCurve={vi.fn()} onSelectProfile={vi.fn()} />
  </>));
}

it('fits first-entry geometry clear of the newly revealed long contour row in the same commit', async () => {
  const document = fixture(), original = JSON.stringify(document);
  await show(document, null); await click('Collapse Model'); await click('Collapse part Fit');
  expect(profileRow()).toBeNull();
  await show(document, 'outline', true);
  expect(profileRow()).not.toBeNull();
  const view = state(), scale = 500 / view.heightSpanMm;
  const left = 500 + (100000000 - view.centerMm[0]) * scale;
  const right = 500 + (100000040 - view.centerMm[0]) * scale;
  expect(left, 'The actual contour must clear the final 340px tree, not its preceding collapsed width').toBeGreaterThanOrEqual(340);
  expect(right).toBeLessThanOrEqual(1000);
  expect(JSON.stringify(document)).toBe(original);
});

it('keeps manual tree collapse and ordinary geometry edits from reframing the active Sketch', async () => {
  const document = fixture(); await show(document, 'outline', true); const before = state();
  await click('Collapse S'); expect(profileRow()).toBeNull(); expect(state()).toEqual(before);
  await show(document, 'outline', true); expect(profileRow()).toBeNull(); expect(state()).toEqual(before);
  const sketch = document.features[0]; if (sketch.kind !== 'sketch') throw new Error('Sketch missing');
  const profile = sketch.profiles[0]; if (profile.geometry.kind !== 'rectangle') throw new Error('Rectangle missing');
  const changed = parseCadDocument({ ...document, features: [{ ...sketch, profiles: [{ ...profile, geometry: { ...profile.geometry, width: 80 } }] }] });
  await show(changed, 'outline', true); expect(profileRow()).toBeNull(); expect(state()).toEqual(before);
  await click('Expand S'); expect(profileRow()).not.toBeNull(); expect(state()).toEqual(before);
  await show(changed, null, true); await click('Collapse S'); expect(profileRow()).toBeNull();
  await show(changed, 'outline', true); expect(profileRow()).not.toBeNull(); expect(state()).toEqual(before);
});
