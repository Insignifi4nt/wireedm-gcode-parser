import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { buildUpidEditorTree } from '@/domain/upid/upidEditorTree';
import { setManualInitialWirePosition } from '@/domain/path-editor/pathDocumentOperations';
import { setMachiningSpanParticipation } from '@/domain/path-intel/machiningParticipation';

import { EditorExecutionDiagnostics } from '../EditorExecutionDiagnostics';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('EditorExecutionDiagnostics', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('names the program-level decision before opening its owning workflow', () => {
    const tree = buildUpidEditorTree(createUpidFromDxfEntities([{
      type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }
    }]));
    const resolve = vi.fn();
    act(() => root.render(<EditorExecutionDiagnostics diagnostics={tree.diagnostics} operations={tree.operations} onResolve={resolve} />));
    expect(container.querySelector('[data-editor-execution-diagnostic-context]')?.textContent).toBe('Program setup');
    const button = container.querySelector<HTMLButtonElement>('button');
    expect(button?.textContent).toBe('Review initial wire position');
    act(() => button?.click());
    expect(resolve).toHaveBeenCalledWith(tree.diagnostics[0], tree.diagnostics[0].treeKey);
  });

  it('shows the authored contour context for a derived partial operation and routes its exact diagnostic', () => {
    const source = createUpidFromDxfEntities([{
      type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 10
    }]);
    const positioned = setManualInitialWirePosition(source, { x: 10, y: 0 });
    if (!positioned) throw new Error('Expected an initial wire position');
    const partial = setMachiningSpanParticipation(positioned, {
      sourceSegmentId: source.segments[0].id, range: { start: 0.25, end: 0.75 }, participation: 'inactive-reference'
    });
    if (!partial) throw new Error('Expected a partial circle');
    const tree = buildUpidEditorTree(partial);
    const resolve = vi.fn();
    act(() => root.render(<EditorExecutionDiagnostics diagnostics={tree.diagnostics} operations={tree.operations} onResolve={resolve} />));
    expect(container.querySelector('[data-editor-execution-diagnostic-context]')?.textContent).toBe('Contour 01 · Exterior 1');
    const button = container.querySelector<HTMLButtonElement>('button');
    expect(button?.getAttribute('aria-label')).toBe('Review partial-path compensation for Contour 01 · Exterior 1');
    act(() => button?.click());
    expect(resolve).toHaveBeenCalledWith(tree.diagnostics[0], tree.diagnostics[0].treeKey);
  });
});
