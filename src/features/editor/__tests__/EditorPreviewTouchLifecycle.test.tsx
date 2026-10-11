import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { parseGCodeProgram } from '@/domain/editor/gcodeParser';
import { EditorPreview } from '../EditorPreview';
import { TOUCH_DOUBLE_TAP_TIMEOUT_MS } from '../editorPreviewHelpers';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function documentFixture() {
  return createUpidFromDxfEntities([
    { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 10 } }
  ]);
}

function previewHarness() {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container), source = documentFixture(), onPick = vi.fn();
  function render({ pointMode = true, pathDocument = source, pick = onPick, interactionKey, select, parseResult, measurement }: {
    pointMode?: boolean;
    pathDocument?: ReturnType<typeof documentFixture> | null;
    pick?: ((point: { x: number; y: number }) => void) | null;
    interactionKey?: string;
    select?: Parameters<typeof EditorPreview>[0]['onPathElementClick'];
    parseResult?: Parameters<typeof EditorPreview>[0]['parseResult'];
    measurement?: Parameters<typeof EditorPreview>[0]['measurement'];
  } = {}) {
    act(() => root.render(<EditorPreview program={null} pathDocument={pathDocument}
      canvasMouseMode={pointMode ? 'point' : 'select'} onPreviewPointClick={pick ?? undefined}
      interactionKey={interactionKey} onPathElementClick={select}
      parseResult={parseResult} measurement={measurement}
      hoveredLine={null} measurementPoints={[]} pinnedLines={[]} selectedLines={[]} />));
  }
  function tap(clientX = 110, clientY = 60) {
    const svg = container.querySelector<SVGSVGElement>('svg[data-preview-model]');
    if (!svg) throw new Error('Missing preview');
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 220, 120));
    const touch = { clientX, clientY, identifier: 1, target: svg };
    for (const type of ['touchstart', 'touchend']) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { touches: { value: type === 'touchstart' ? [touch] : [] }, changedTouches: { value: [touch] } });
      act(() => svg.dispatchEvent(event));
    }
  }
  return { container, source, onPick, render, tap, unmount: () => act(() => root.render(null)),
    dispose: () => { act(() => root.unmount()); container.remove(); } };
}

describe('delayed preview touch picks', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
  it.each(['mode', 'document', 'disabled callback', 'callback target', 'interaction target', 'unchanged'] as const)(
    'keeps a pending point pick scoped to its %s interaction', change => {
      const h = previewHarness(), replacementPick = vi.fn();
      try {
        h.render(change === 'interaction target' ? { interactionKey: 'entry:operation-1' } : {}); h.tap();
        expect(h.onPick).not.toHaveBeenCalled();
        if (change === 'mode') h.render({ pointMode: false });
        if (change === 'document') h.render({ pathDocument: documentFixture() });
        if (change === 'disabled callback') h.render({ pick: null });
        if (change === 'callback target') h.render({ pick: replacementPick });
        if (change === 'interaction target') h.render({ interactionKey: 'exit:operation-1' });
        act(() => vi.advanceTimersByTime(TOUCH_DOUBLE_TAP_TIMEOUT_MS));
        expect(h.onPick).toHaveBeenCalledTimes(change === 'unchanged' ? 1 : 0);
        expect(replacementPick).not.toHaveBeenCalled();
      } finally { h.dispose(); }
    }
  );
  it('retains an ordinary tap across cursor callbacks for the same explicit interaction', () => {
    const h = previewHarness(), refreshedCallback = vi.fn();
    try {
      h.render({ interactionKey: 'entry:operation-1' }); h.tap();
      h.render({ interactionKey: 'entry:operation-1', pick: refreshedCallback });
      act(() => vi.advanceTimersByTime(TOUCH_DOUBLE_TAP_TIMEOUT_MS));
      expect(h.onPick).toHaveBeenCalledOnce(); expect(refreshedCallback).not.toHaveBeenCalled();
    } finally { h.dispose(); }
  });
  it('cancels pending picks when the inspection source is parsed again', () => {
    const h = previewHarness();
    try {
      h.render({ pathDocument: null, parseResult: parseGCodeProgram('G90\nG1 X10 Y10') }); h.tap();
      h.render({ pathDocument: null, parseResult: parseGCodeProgram('G90\nG1 X20 Y20') });
      act(() => vi.advanceTimersByTime(TOUCH_DOUBLE_TAP_TIMEOUT_MS));
      expect(h.onPick).not.toHaveBeenCalled();
    } finally { h.dispose(); }
  });
  it('cancels a pending point when measurement becomes the active interaction', () => {
    const h = previewHarness();
    const measurement = { picks: [], hover: null, featurePair: null, snapEnabled: true, repeatMode: 'pair', precision: 3,
      onPick: vi.fn(), onHover: vi.fn(), clear: vi.fn(), setSnapEnabled: vi.fn(), setRepeatMode: vi.fn(), setPrecision: vi.fn()
    } satisfies NonNullable<Parameters<typeof EditorPreview>[0]['measurement']>;
    try {
      h.render({ interactionKey: 'source-1' }); h.tap();
      h.render({ interactionKey: 'source-1', measurement });
      act(() => vi.advanceTimersByTime(TOUCH_DOUBLE_TAP_TIMEOUT_MS));
      expect(h.onPick).not.toHaveBeenCalled(); expect(measurement.onPick).not.toHaveBeenCalled();
    } finally { h.dispose(); }
  });
  it.each(['unchanged', 'mode', 'unmount'] as const)('handles every distinct pending tap after %s', change => {
    const h = previewHarness();
    try {
      h.render(); h.tap(50); act(() => vi.advanceTimersByTime(50)); h.tap(170);
      expect(h.onPick).not.toHaveBeenCalled();
      if (change === 'mode') h.render({ pointMode: false, pick: null });
      if (change === 'unmount') h.unmount();
      act(() => vi.advanceTimersByTime(TOUCH_DOUBLE_TAP_TIMEOUT_MS));
      expect(h.onPick).toHaveBeenCalledTimes(change === 'unchanged' ? 2 : 0);
    } finally { h.dispose(); }
  });
  it('fits on a double tap without placing its single point', () => {
    const h = previewHarness();
    try {
      h.render();
      const zoom = h.container.querySelector<HTMLButtonElement>('button[aria-label="Zoom preview in"]');
      if (!zoom) throw new Error('Missing zoom button');
      act(() => zoom.click()); expect(h.container.textContent).toContain('125%');
      h.tap(); act(() => vi.advanceTimersByTime(50)); h.tap();
      act(() => vi.advanceTimersByTime(TOUCH_DOUBLE_TAP_TIMEOUT_MS));
      expect(h.onPick).not.toHaveBeenCalled(); expect(h.container.textContent).toContain('100%');
    } finally { h.dispose(); }
  });
  it('cancels only the matching double tap while retaining an earlier distinct tap', () => {
    const h = previewHarness();
    try {
      h.render(); h.tap(50); act(() => vi.advanceTimersByTime(50)); h.tap(170);
      act(() => vi.advanceTimersByTime(50)); h.tap(170);
      act(() => vi.advanceTimersByTime(TOUCH_DOUBLE_TAP_TIMEOUT_MS));
      expect(h.onPick).toHaveBeenCalledOnce();
    } finally { h.dispose(); }
  });
  it.each([false, true])('keeps a delayed contour selection scoped to its target, changed=%s', changed => {
    const h = previewHarness(), select = vi.fn();
    try {
      h.render({ pointMode: false, pick: null, select, interactionKey: 'source-1' }); h.tap();
      if (changed) h.render({ pointMode: false, pick: null, select, interactionKey: 'source-2' });
      act(() => vi.advanceTimersByTime(TOUCH_DOUBLE_TAP_TIMEOUT_MS));
      expect(select).toHaveBeenCalledTimes(changed ? 0 : 1);
      if (!changed) expect(select).toHaveBeenCalledWith(expect.objectContaining({ operationId: h.source.plan.operations[0].id }));
    } finally { h.dispose(); }
  });
  it('does not cancel an earlier contour pick when a later double tap hits empty canvas', () => {
    const h = previewHarness(), select = vi.fn();
    try {
      h.render({ pointMode: false, pick: null, select }); h.tap();
      act(() => vi.advanceTimersByTime(50)); h.tap(20, 10);
      act(() => vi.advanceTimersByTime(50)); h.tap(20, 10);
      act(() => vi.advanceTimersByTime(TOUCH_DOUBLE_TAP_TIMEOUT_MS));
      expect(select).toHaveBeenCalledOnce();
    } finally { h.dispose(); }
  });
});
