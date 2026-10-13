import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadDocument } from '@/domain/cad/cadDocument';
import { applyCadEdits } from '@/domain/cad/cadOperations';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { CadWorkbench, type CadWorkbenchProps } from './CadWorkbench';
import { closeSketchPolygon, snapSketchPoint, twoPointSketchProfile } from './cadSketchInteraction';
import { CadSession } from './cadSession';
import type { CadRenderedViewControls, CadWorkbenchViewportControls } from './cadViewportControls';

// jsdom cannot create a WebGL context. These tests exercise the real UI and domain edits.
vi.mock('./CadViewport', async () => {
  const { useEffect } = await import('react');
  return { CadViewport: ({ onControlsReady }: { onControlsReady?(controls: CadRenderedViewControls | null, released?: CadRenderedViewControls): void }) => {
    // Match WebGL's passive publication/disposal lifetime, while the real SVG
    // publishes in layout effects. Their order matters when changing modes.
    useEffect(() => {
      const controls: CadRenderedViewControls = { getState: () => ({ mode: 'solid', available: true, view: 'Isometric', gridVisible: true, zoom: 1, revision: 0 }),
        fit: vi.fn(), setGrid: vi.fn(), setView: vi.fn(), capture: async () => { throw new Error('WebGL rasterization is unavailable in jsdom.'); } };
      onControlsReady?.(controls);
      return () => onControlsReady?.(null, controls);
    }, [onControlsReady]);
    return <div aria-label="3D model viewport" />;
  } };
});

let container: HTMLDivElement;
let root: Root;
let currentDocument: CadDocument;
let currentSession: CadSession;
let currentViewport: CadWorkbenchViewportControls | null;
let replaceDocument: (document: CadDocument) => void;
const undo = vi.fn();
const save = vi.fn(async () => undefined);
const sendToCam = vi.fn(async (_sketchId: string) => undefined);
const workflow = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  currentViewport = null;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function mount(initial: CadDocument = createCadDocument(), buildProps: Pick<CadWorkbenchProps, 'build' | 'buildState' | 'onSectionForCam'> = { build: null, buildState: 'idle' }) {
  const session = new CadSession(initial);
  currentSession = session;
  function Harness() {
    const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
    const { document } = snapshot;
    currentDocument = document;
    replaceDocument = (replacement) => session.replace(replacement);
    const props: CadWorkbenchProps = {
      document, documentVersion: snapshot.version, buildVersion: buildProps.buildState === 'ready' ? snapshot.version : null, ...buildProps, dirty: true, canUndo: true, canRedo: true,
      onEdit(edit) { session.edit([edit]); },
      onUndo: undo, onRedo: vi.fn(), onSave: save, onBack: vi.fn(), onWorkflowChange: (open) => { workflow(open); session.setWorkflowOpen(open); },
      onSendToCam: sendToCam, onOpenDocument: vi.fn(), onNewDocument: vi.fn(),
      onImportDocument: async () => undefined, onExportDocument: vi.fn(), onExportSolid: async () => undefined, onExportDxf: async () => undefined,
      onViewportControlsReady: (controls) => { currentViewport = controls; },
    };
    return <CadWorkbench {...props} />;
  }
  await act(async () => root.render(<Harness />));
}

function button(label: string) {
  const found = [...container.querySelectorAll('button')].find((entry) => entry.getAttribute('aria-label') === label || entry.textContent?.trim() === label);
  if (!found) throw new Error(`Button "${label}" missing.`);
  return found;
}
async function click(label: string) { await act(async () => button(label).click()); }
function field(label: string) {
  const input = [...container.querySelectorAll('label')].find((entry) => entry.querySelector('span')?.childNodes[0]?.textContent === label)?.querySelector('input');
  if (!input) throw new Error(`Field "${label}" missing.`);
  return input;
}
async function input(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('Native input setter unavailable.');
  await act(async () => { setter.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function canvasClick(x: number, y: number) {
  const canvas = container.querySelector<SVGSVGElement>('[aria-label="Sketch drawing canvas"]');
  if (!canvas) throw new Error('Sketch canvas missing.');
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) });
  await act(async () => canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y })));
}
async function canvasKey(key: string, shiftKey = false) {
  const canvas = container.querySelector<SVGSVGElement>('[aria-label="Sketch drawing canvas"]');
  if (!canvas) throw new Error('Sketch canvas missing.');
  await act(async () => { canvas.focus(); canvas.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })); });
}
function viewport() {
  if (!currentViewport) throw new Error('Viewport controls unavailable.');
  return currentViewport;
}

describe('CAD sketch interaction', () => {
  it('normalizes reverse rectangle drawing and refuses degenerate geometry', () => {
    expect(twoPointSketchProfile('rectangle', [40, 30], [0, -10])).toEqual({ kind: 'rectangle', x: 0, y: -10, width: 40, height: 40, cornerRadius: 0 });
    expect(() => twoPointSketchProfile('rectangle', [0, 0], [0, 30])).toThrow('nonzero');
    expect(twoPointSketchProfile('circle', [5, 5], [8, 9])).toEqual({ kind: 'circle', x: 5, y: 5, radius: 5 });
    expect(twoPointSketchProfile('slot', [0, 0], [0, 20])).toEqual({ kind: 'slot', x: 0, y: 0, length: 40, width: 10, angle: 90 });
    expect(() => closeSketchPolygon([[0, 0], [20, 0]])).toThrow('three');
  });

  it('snaps both signs and preserves precision when snapping is disabled', () => {
    expect(snapSketchPoint([-12, 18], 5, true)).toEqual([-10, 20]);
    expect(snapSketchPoint([1.125, -2.375], 5, false)).toEqual([1.125, -2.375]);
    expect(() => snapSketchPoint([1, 1], 0, true)).toThrow('positive');
  });

  it('creates a real sketch, commits a drawn rectangle and sends that exact sketch to CAM', async () => {
    await mount();
    await click('Sketch');
    expect(workflow).toHaveBeenLastCalledWith(true);
    expect(button('Save').disabled).toBe(true);
    await click('Apply');
    expect(currentDocument.features[0]?.kind).toBe('sketch');
    await canvasClick(300, 200);
    expect(workflow).toHaveBeenLastCalledWith(true);
    expect(() => currentSession.assertWorkflowClosed()).toThrow('Finish or cancel');
    await canvasClick(450, 100);
    const sketch = currentDocument.features[0];
    if (sketch.kind !== 'sketch') throw new Error('Expected sketch.');
    expect(sketch.profiles[0].geometry).toEqual({ kind: 'rectangle', x: 0, y: 0, width: 50, height: 40, cornerRadius: 0 });
    expect(workflow).toHaveBeenLastCalledWith(false);
    expect(container.querySelector('[aria-label="Sketch measurements"]')?.textContent).toContain('2,000 mm²');
    expect(container.querySelector('[aria-label="Sketch measurements"]')?.textContent).toContain('180 mm');
    await click('Send sketch to CAM');
    expect(sendToCam).toHaveBeenCalledWith(sketch.id);
  });

  it('keeps a multi-click polygon provisional and Escape cancels it without changing saved geometry', async () => {
    await mount(); await click('Sketch'); await click('Apply'); await click('Polyline');
    await canvasClick(300, 200); await canvasClick(450, 200);
    expect(button('Finish sketch').disabled).toBe(true);
    expect(button('Undo').disabled).toBe(true);
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    const sketch = currentDocument.features[0];
    expect(sketch.kind === 'sketch' && sketch.profiles).toEqual([]);
    expect(button('Finish sketch').disabled).toBe(false);
    expect(workflow).toHaveBeenLastCalledWith(false);
  });

  it('edits a profile with a named expression and leaves Ctrl+Z to focused inputs', async () => {
    await mount({ ...createCadDocument(), parameters: { plateWidth: 80 } });
    await click('Sketch'); await click('Apply'); await canvasClick(300, 200); await canvasClick(450, 100);
    await input(field('Width'), 'plateWidth / 2');
    expect(button('Save').disabled).toBe(true);
    expect(workflow).toHaveBeenLastCalledWith(true);
    await act(async () => field('Width').dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })));
    expect(undo).not.toHaveBeenCalled();
    await click('Apply');
    const sketch = currentDocument.features[0];
    if (sketch.kind !== 'sketch') throw new Error('Expected sketch.');
    const geometry = sketch.profiles[0].geometry;
    expect(geometry.kind === 'rectangle' && geometry.width).toBe('plateWidth / 2');
    expect(container.querySelector('.cad-field-hint')?.textContent).toContain('mm');
    expect(workflow).toHaveBeenLastCalledWith(false);
  });

  it('refreshes selected profile fields when an imported document preserves feature and profile IDs', async () => {
    await mount(); await click('Sketch'); await click('Apply'); await canvasClick(300, 200); await canvasClick(450, 100);
    const sketch = currentDocument.features[0];
    if (sketch.kind !== 'sketch') throw new Error('Expected sketch.');
    const profile = sketch.profiles[0];
    if (profile.geometry.kind !== 'rectangle') throw new Error('Expected rectangle.');
    const updated = applyCadEdits(currentDocument, [{ kind: 'update-feature', feature: { ...sketch, profiles: [{ ...profile, geometry: { ...profile.geometry, width: 75 } }] } }]);
    await act(async () => replaceDocument(updated));
    expect(field('Width').value).toBe('75');
    expect(workflow).toHaveBeenLastCalledWith(false);
    const cleared = applyCadEdits(updated, [{ kind: 'update-feature', feature: { ...sketch, profiles: [] } }]);
    await act(async () => replaceDocument(cleared));
    expect(viewport().getState().selectedProfileId).toBeNull();
  });

  it('preserves the document when an expression is invalid and Cancel restores the field', async () => {
    await mount(); await click('Sketch'); await click('Apply'); await canvasClick(300, 200); await canvasClick(450, 100);
    await input(field('Width'), 'missingParameter * 2'); await click('Apply');
    expect(container.querySelector('.cad-property-form [role="alert"]')?.textContent).toContain('Unknown parameter');
    const sketch = currentDocument.features[0];
    expect(sketch.kind === 'sketch' && sketch.profiles[0].geometry.kind === 'rectangle' && sketch.profiles[0].geometry.width).toBe(50);
    expect(button('Save').disabled).toBe(true);
    await click('Cancel');
    expect(field('Width').value).toBe('50');
    expect(workflow).toHaveBeenLastCalledWith(false);
  });

  it('uses the current body when starting a modification from a consumed historical feature', async () => {
    const initial = applyCadEdits(createCadDocument(), [
      { kind: 'add-feature', feature: { id: 'sketch', name: 'Outline', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false, profiles: [{ id: 'rectangle', name: 'Plate', construction: false, role: 'outer', geometry: { kind: 'rectangle', x: 0, y: 0, width: 50, height: 40, cornerRadius: 0 } }] } },
      { kind: 'add-feature', feature: { id: 'pad', name: 'Pad 1', kind: 'extrude', suppressed: false, sketchId: 'sketch', distance: 10, symmetric: false, operation: 'new', targetId: null } },
      { kind: 'add-feature', feature: { id: 'fillet', name: 'Fillet 1', kind: 'fillet', suppressed: false, targetId: 'pad', radius: 1 } },
    ]);
    const section = vi.fn();
    await mount(initial, { onSectionForCam: section, buildState: 'ready', build: { meshes: [{ featureId: 'fillet', name: 'Fillet 1', positions: [], normals: [], indices: [], edges: [], volume: 100, bounds: { min: [0, 0, 0], max: [50, 40, 10] } }], diagnostics: [], durationMs: 1 } });
    await click('Select Pad 1 in history'); await click('Section for CAM');
    expect(section).toHaveBeenCalledWith('fillet');
    await click('Move');
    expect(button('Section for CAM').disabled).toBe(true);
    const sourceSelect = [...container.querySelectorAll('label')].find((label) => label.querySelector('span')?.textContent === 'Body')?.querySelector('select');
    expect(sourceSelect?.value).toBe('fillet');
    expect([...sourceSelect?.options ?? []].map((option) => option.value)).toEqual(['fillet']);
    await click('Apply');
    expect(currentDocument.features.at(-1)).toMatchObject({ kind: 'transform', sourceId: 'fillet' });
  });

  it('draws snapped geometry with the keyboard and guards the real shared session', async () => {
    await mount(); await click('Sketch'); await click('Apply');
    await canvasKey('Enter');
    expect(() => currentSession.assertWorkflowClosed()).toThrow('Finish or cancel');
    await canvasKey('ArrowRight', true); await canvasKey('ArrowUp', true); await canvasKey('Enter');
    const sketch = currentDocument.features[0];
    expect(sketch.kind === 'sketch' && sketch.profiles[0].geometry).toEqual({ kind: 'rectangle', x: 0, y: 0, width: 50, height: 50, cornerRadius: 0 });
    expect(() => currentSession.assertWorkflowClosed()).not.toThrow();
  });

  it('ignores right-button clicks and leaves browser zoom gestures to the browser', async () => {
    await mount(); await click('Sketch'); await click('Apply');
    const canvas = container.querySelector<SVGSVGElement>('[aria-label="Sketch drawing canvas"]');
    if (!canvas) throw new Error('Sketch canvas missing.');
    const originalView = canvas.getAttribute('viewBox');
    await act(async () => {
      canvas.dispatchEvent(new MouseEvent('click', { button: 2, bubbles: true, clientX: 200, clientY: 100 }));
      canvas.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: 100, bubbles: true }));
    });
    expect(currentSession.getSnapshot().workflowOpen).toBe(false);
    expect(canvas.getAttribute('viewBox')).toBe(originalView);
    expect(container.querySelector('.cad-sketch-vertex')).toBeNull();
  });

  it('focuses the safe delete action, traps keyboard focus and restores focus on Escape', async () => {
    await mount(); await click('Sketch'); await click('Apply'); await click('Finish sketch');
    const trigger = button('Delete selected feature or profile');
    trigger.focus(); await click('Delete selected feature or profile');
    const dialog = container.querySelector<HTMLDivElement>('[role="dialog"]');
    if (!dialog) throw new Error('Delete dialog missing.');
    const buttons = dialog.querySelectorAll('button');
    expect(window.document.activeElement).toBe(buttons[0]);
    await act(async () => { buttons[1].focus(); buttons[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); });
    expect(window.document.activeElement).toBe(buttons[0]);
    await act(async () => buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(currentDocument.features).toHaveLength(1);
    expect(window.document.activeElement).toBe(trigger);
    expect(currentSession.getSnapshot().workflowOpen).toBe(false);
  });

  it('publishes stable viewport controls and applies fit/grid/profile selection without editing the draft', async () => {
    await mount(); await click('Sketch'); await click('Apply');
    const controls = viewport();
    await canvasClick(300, 200);
    expect(() => controls.apply({ kind: 'fit' })).toThrow('Apply or cancel');
    await canvasClick(450, 100);
    expect(viewport()).toBe(controls);
    const version = currentSession.getSnapshot().version;
    await act(async () => controls.apply({ kind: 'fit' }));
    expect(controls.getState()).toMatchObject({ documentVersion: version, view: { mode: 'sketch', centerMm: [25, 20], heightSpanMm: 50 } });
    await act(async () => controls.apply({ kind: 'set-grid', visible: false }));
    expect(button('Toggle sketch grid').getAttribute('aria-pressed')).toBe('false');
    await act(async () => controls.apply({ kind: 'select-profile', profileId: null }));
    expect(controls.getState().selectedProfileId).toBeNull();
    expect(currentSession.getSnapshot().version).toBe(version);
    expect(Object.isFrozen(controls.getState().view)).toBe(true);
  });

  it('keeps the newly mounted sketch controls when the old solid renderer disposes later', async () => {
    await mount();
    expect(viewport().getState().view).toMatchObject({ mode: 'solid', available: true });
    await click('Sketch'); await click('Apply');
    const controls = viewport();
    expect(controls.getState().view).toMatchObject({ mode: 'sketch', available: true });
    const sketchId = currentDocument.features[0].id;
    await click('Finish sketch');
    expect(controls.getState().view).toMatchObject({ mode: 'solid', available: true });
    await act(async () => controls.apply({ kind: 'edit-sketch', sketchId }));
    expect(controls.getState().view).toMatchObject({ mode: 'sketch', available: true });
    expect(currentSession.getSnapshot().workflowOpen).toBe(false);
  });
});
