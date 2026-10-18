import { act, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { AppRailProvider, type AppRailContent, type EditorCompactDrawer } from '@/app/AppRailContext';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { createWorkbenchProjectDocument } from '@/domain/workbench-catalog/workbenchProject';
import { createEmptyPostLibrary } from '@/domain/post-processor/postLibrary';
import { EditorPage } from '@/features/editor/EditorPage';
import { TOUCH_DOUBLE_TAP_TIMEOUT_MS } from '@/features/editor/editorPreviewHelpers';
import type { DraftReadSnapshot } from '@/features/webmcp/workbenchSiteTools';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
function editorTouchHarness(circle = false) {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => window.clearTimeout(frame));
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const pathDocument = createUpidFromDxfEntities(circle
    ? [{ type: 'circle', layer: 'CUT', center: { x: 5, y: 5 }, radius: 2 }]
    : [{ type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 10 } }]);
  const created = createWorkbenchProjectDocument({ id: 'touch-job', name: 'Touch job',
    source: { kind: 'upid', files: [] }, content: { kind: 'upid-document', document: pathDocument } });
  if (!created.ok) throw new Error(created.error.message);
  const program = { model: 'upid-document', pathDocument, parseResult: null, text: '', project: created.project, filePath: 'projects/touch-job.wireedm.json' } satisfies Parameters<typeof EditorPage>[0]['program'];
  const snapshot: { current: DraftReadSnapshot | null } = { current: null };
  const props = { program, machines: [], posts: createEmptyPostLibrary(), planningMachine: null,
    importStatus: 'idle', importErrorMessage: null, saveStatus: 'idle', saveErrorMessage: null,
    onBackToDashboard: vi.fn(), onDownloadEditorFile: vi.fn(),
    onGenerateControllerArtifact: async () => ({ ok: false, error: { code: 'CONTROLLER_ARTIFACT_POST_FAILED', message: 'Unused', diagnostics: [] } } as const),
    onImportProgramFile: vi.fn(), onSaveEditorDraft: vi.fn(), onReadSnapshot: (next: DraftReadSnapshot | null) => { snapshot.current = next; }
  } satisfies Parameters<typeof EditorPage>[0];
  const openMachineSettings = vi.fn(), closeCompactDrawerWithRailFocus = vi.fn();
  function Harness({ locked = false }: { locked?: boolean }) {
    const [header, setHeaderContent] = useState<ReactNode>(null), [rail, setRailContent] = useState<AppRailContent | null>(null);
    const [compactDrawer, setCompactDrawer] = useState<EditorCompactDrawer>(null), [compactTransitionOverlay, setCompactTransitionOverlay] = useState(false);
    const [, setRailCollapsed] = useState(false);
    return <AppRailProvider value={{ openMachineSettings, closeCompactDrawerWithRailFocus,
      compactDrawer, compactModalHost: null, compactTransitionOverlay, isCompactViewport: false, isMiddleViewport: false,
      setCompactDrawer, setCompactTransitionOverlay, setHeaderContent, setRailCollapsed, setRailContent }}>
      <header>{header}</header><aside>{rail?.expanded}</aside><EditorPage {...props} interactionLocked={locked} />
    </AppRailProvider>;
  }
  const button = (selector: string) => {
    const found = container.querySelector<HTMLButtonElement>(selector);
    if (!found) throw new Error(`Missing button ${selector}`);
    return found;
  };
  const render = (locked = false) => act(() => root.render(<Harness locked={locked} />));
  function openWorkflow(menu: string, command: string) {
    const menuButton = [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === menu);
    if (!menuButton) throw new Error(`Missing ${menu} menu`);
    act(() => menuButton.click());
    act(() => button(`[data-editor-workflow-command="${command}"]`).click());
  }
  function tap(clientX = 80, clientY = 20) {
    const svg = container.querySelector<SVGSVGElement>('svg[data-preview-model]');
    if (!svg) throw new Error('Missing canvas');
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 220, 120));
    const touch = { clientX, clientY, identifier: 1, target: svg };
    for (const type of ['touchstart', 'touchend']) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { touches: { value: type === 'touchstart' ? [touch] : [] }, changedTouches: { value: [touch] } });
      act(() => svg.dispatchEvent(event));
    }
  }
  return { button, container, openWorkflow, render, snapshot, tap,
    dispose: () => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); } };
}

describe('actual editor touch target handoff', () => {
  it.each(['unchanged', 'exit', 'locked', 'measure'] as const)('keeps a touch pick scoped across %s', change => {
    const h = editorTouchHarness();
    try {
      h.render();
      h.openWorkflow('Machining', 'machining.entry-exit');
      act(() => h.button('button[aria-label="Pick entry point on canvas"]').click());
      h.tap();
      const reviewed = h.snapshot.current;
      if (change === 'exit') act(() => h.button('button[aria-label="Pick exit point on canvas"]').click());
      if (change === 'locked') h.render(true);
      if (change === 'measure') h.openWorkflow('Construction', 'inspect.measure');
      act(() => vi.advanceTimersByTime(TOUCH_DOUBLE_TAP_TIMEOUT_MS));
      const current = h.snapshot.current;
      expect(current?.dirty).toBe(change === 'unchanged');
      if (change !== 'unchanged') expect(current?.document).toBe(reviewed?.document);
      if (change === 'exit') expect(h.button('button[aria-label="Pick exit point on canvas"]').getAttribute('aria-pressed')).toBe('true');
    } finally { h.dispose(); }
  });

  it('keeps both distinct construction taps when the first point causes a render before the second expires', () => {
    const h = editorTouchHarness();
    try {
      h.render();
      h.openWorkflow('Construction', 'construction.measurement');
      act(() => h.button('button[aria-label="Place measurement points on canvas"]').click());
      h.tap(50);
      act(() => vi.advanceTimersByTime(50));
      h.tap(170);
      const reviewedVersion = h.snapshot.current?.version;
      expect(h.container.querySelectorAll('[data-measurement-point-row]')).toHaveLength(0);

      act(() => vi.advanceTimersByTime(TOUCH_DOUBLE_TAP_TIMEOUT_MS - 50));
      expect(h.container.querySelectorAll('[data-measurement-point-row]')).toHaveLength(1);
      expect(h.snapshot.current?.version).not.toBe(reviewedVersion);
      act(() => vi.advanceTimersByTime(50));
      const rows = [...h.container.querySelectorAll('[data-measurement-point-row]')];
      expect(rows).toHaveLength(2);
      expect(rows[0].textContent).toContain('P1');
      expect(rows[1].textContent).toContain('P2');
      expect(rows[0].children[1].textContent).not.toBe(rows[1].children[1].textContent);
    } finally { h.dispose(); }
  });

  it.each(['perpendicular', 'tangent'] as const)('retains a delayed %s pick with the same construction source', mode => {
    const h = editorTouchHarness(mode === 'tangent');
    try {
      h.render(); h.openWorkflow('Construction', 'construction.measurement');
      act(() => h.button('button[aria-label="Place measurement points on canvas"]').click());
      h.tap(50, 20);
      act(() => vi.advanceTimersByTime(TOUCH_DOUBLE_TAP_TIMEOUT_MS + 1));
      act(() => h.button(`button[aria-label="Magnetize latest point ${mode}"]`).click());
      h.tap(170, 20);
      act(() => vi.advanceTimersByTime(TOUCH_DOUBLE_TAP_TIMEOUT_MS));
      const rows = h.container.querySelectorAll('[data-measurement-point-row]');
      expect(rows).toHaveLength(2);
      expect(rows[1].querySelector('[data-measurement-point-mode]')?.textContent)
        .toBe(mode === 'perpendicular' ? 'Perp' : 'Tan');
    } finally { h.dispose(); }
  });

  it.each(['delete', 'clear', 'move', 'previous-source'] as const)(
    'discards a delayed perpendicular pick after its construction source changes by %s', change => {
      const h = editorTouchHarness();
      try {
        h.render(); h.openWorkflow('Construction', 'construction.measurement');
        act(() => h.button('button[aria-label="Place measurement points on canvas"]').click());
        h.tap(50, 20);
        act(() => vi.advanceTimersByTime(TOUCH_DOUBLE_TAP_TIMEOUT_MS + 1));
        if (change === 'previous-source') {
          h.tap(170, 20);
          act(() => vi.advanceTimersByTime(TOUCH_DOUBLE_TAP_TIMEOUT_MS + 1));
        }
        act(() => h.button('button[aria-label="Magnetize latest point perpendicular"]').click());
        h.tap(110, 20);
        const previousRows = [...h.container.querySelectorAll('[data-measurement-point-row]')].map(row => row.textContent);
        if (change === 'delete' || change === 'previous-source') {
          act(() => h.button(`button[aria-label="Delete measurement point P${change === 'delete' ? 1 : 2}"]`).click());
        } else if (change === 'clear') {
          const clear = [...h.container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === 'Clear Points');
          if (!clear) throw new Error('Missing Clear Points button');
          act(() => clear.click());
        } else {
          const handle = h.container.querySelector('[data-measurement-point-handle="1"]');
          const svg = h.container.querySelector('svg[data-preview-model]');
          if (!handle || !svg) throw new Error('Missing construction point drag handle');
          act(() => handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
          act(() => svg.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 140, clientY: 90 })));
          act(() => svg.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 })));
        }
        const changedRows = [...h.container.querySelectorAll('[data-measurement-point-row]')].map(row => row.textContent);
        expect(changedRows).toHaveLength(change === 'delete' || change === 'clear' ? 0 : 1);
        if (change === 'move') expect(changedRows).not.toEqual(previousRows);
        act(() => vi.advanceTimersByTime(TOUCH_DOUBLE_TAP_TIMEOUT_MS));
        expect([...h.container.querySelectorAll('[data-measurement-point-row]')].map(row => row.textContent))
          .toEqual(changedRows);
        expect(h.button('button[aria-label="Magnetize latest point perpendicular"]').getAttribute('aria-pressed')).toBe('true');
      } finally { h.dispose(); }
    }
  );

  it.each(['unchanged', 'endpoint'] as const)('scopes a nearest contour-start pick across %s inference', change => {
    const h = editorTouchHarness(true);
    try {
      h.render(); h.openWorkflow('Machining', 'machining.set-start');
      const inference = h.container.querySelector<HTMLSelectElement>('select[aria-label="Set start point inference"]');
      if (!inference) throw new Error('Missing start inference control');
      act(() => { inference.value = 'nearest'; inference.dispatchEvent(new Event('change', { bubbles: true })); });
      act(() => h.button('button[aria-label="Pick explicit contour start"]').click());
      h.tap(170, 20);
      const reviewed = h.snapshot.current?.document;
      if (change === 'endpoint') act(() => { inference.value = 'endpoint'; inference.dispatchEvent(new Event('change', { bubbles: true })); });
      act(() => vi.advanceTimersByTime(TOUCH_DOUBLE_TAP_TIMEOUT_MS));
      expect(h.snapshot.current?.dirty).toBe(change === 'unchanged');
      if (change === 'endpoint') expect(h.snapshot.current?.document).toBe(reviewed);
      else expect(h.snapshot.current?.document?.segments).toHaveLength(2);
    } finally { h.dispose(); }
  });
});
