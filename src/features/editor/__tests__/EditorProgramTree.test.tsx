import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildUpidEditorTree } from '@/domain/upid/upidEditorTree';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';

import { EditorProgramTree } from '../EditorProgramTree';
import { defaultEditorProgramTreeExpansion } from '../editorProgramTreeState';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('EditorProgramTree', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders the neutral execution tree and routes the authored operation identity', async () => {
    const document = createUpidFromDxfEntities([{
      type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }
    }]);
    document.setup = {
      initialWirePosition: { kind: 'manual', point: { x: -1, y: 0 }, review: 'reviewed' }
    };
    const tree = buildUpidEditorTree(document);
    const onSelect = vi.fn();
    const onEdit = vi.fn();

    await act(async () => {
      root.render(
        <EditorProgramTree
          expandedTreeKeys={defaultEditorProgramTreeExpansion(tree)}
          onEdit={onEdit}
          onExpandedTreeKeysChange={vi.fn()}
          onSelect={onSelect}
          selectedTreeKey={null}
          tree={tree}
        />
      );
    });

    const operation = container.querySelector<HTMLElement>(`[data-tree-key="operation:${encodeURIComponent(document.plan.operations[0].id)}"]`);
    expect(operation).not.toBeNull();
    await act(async () => operation?.querySelector('div')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(onEdit.mock.calls[0]?.[0]).toMatchObject({
      kind: 'operation', operationId: document.plan.operations[0].id
    });
  });

  it('surfaces unresolved execution diagnostics without creating post-specific nodes', async () => {
    const document = createUpidFromDxfEntities([{
      type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }
    }]);
    const tree = buildUpidEditorTree(document);
    await act(async () => {
      root.render(
        <EditorProgramTree expandedTreeKeys={new Set(['section:program'])} onEdit={vi.fn()}
          onExpandedTreeKeysChange={vi.fn()} onSelect={vi.fn()} selectedTreeKey={null} tree={tree} />
      );
    });
    expect(tree.status).toBe('unresolved');
    expect(container.textContent).toContain('A reviewed initial wire position is required');
  });
});
