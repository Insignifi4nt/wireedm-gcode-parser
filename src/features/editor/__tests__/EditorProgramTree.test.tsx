import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildUpidEditorTree } from '@/domain/upid/upidEditorTree';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { reviewCenterline } from '@/__tests__/reviewedUpid';

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

  it('reveals selected events once and lets the operator collapse their details while retaining focus', async () => {
    const source = createUpidFromDxfEntities([{
      type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }
    }]);
    source.setup = { initialWirePosition: { kind: 'manual', point: { x: -1, y: 0 }, review: 'reviewed' } };
    reviewCenterline(source);
    const tree = buildUpidEditorTree(source);
    const operation = tree.operations[0];
    function Harness() {
      const [expanded, setExpanded] = useState(defaultEditorProgramTreeExpansion(tree));
      const [selected, setSelected] = useState<string | null>(null);
      return <EditorProgramTree tree={tree} expandedTreeKeys={expanded} onExpandedTreeKeysChange={setExpanded}
        selectedTreeKey={selected} onSelect={setSelected} onEdit={vi.fn()} />;
    }
    await act(async () => root.render(<Harness />));
    const row = container.querySelector<HTMLElement>(`[data-tree-key="${operation.treeKey}"]`);
    if (!row) throw new Error('Missing operation row');
    expect(row.getAttribute('aria-expanded')).toBe('false');
    await act(async () => row.querySelector('div')?.click());
    expect(row.getAttribute('aria-expanded')).toBe('false');
    await act(async () => row.querySelector('button')?.click());
    const eventRow = row.querySelector<HTMLElement>('[role="group"] [role="treeitem"]');
    if (!eventRow) throw new Error('Missing execution event');
    await act(async () => eventRow.querySelector('div')?.click());
    expect(eventRow.getAttribute('aria-selected')).toBe('true');
    await act(async () => row.querySelector('button')?.click());
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(row);
    await act(async () => row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(row.querySelector('[aria-selected="true"]')?.getAttribute('data-tree-key')).toBe(eventRow.dataset.treeKey);
  });

  it('renders the neutral execution tree and routes the authored operation identity', async () => {
    const document = createUpidFromDxfEntities([{
      type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }
    }]);
    document.setup = {
      initialWirePosition: { kind: 'manual', point: { x: -1, y: 0 }, review: 'reviewed' }
    };
    reviewCenterline(document);
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
    if (tree.status !== 'ready') throw new Error('Expected a ready execution plan');
    const programRows = [...container.querySelectorAll('[data-tree-key="section:program"] > ul > li')];
    expect(programRows.map((row) => row.getAttribute('data-tree-key'))).toEqual([
      ...tree.programEvents.filter((node) => node.eventKind !== 'program-end').map((node) => node.treeKey),
      ...tree.operations.map((node) => node.treeKey),
      ...tree.programEvents.filter((node) => node.eventKind === 'program-end').map((node) => node.treeKey)
    ]);
  });

  it('renders an operation diagnostic once and reaches it with keyboard navigation', async () => {
    const source = createUpidFromDxfEntities([{
      type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }
    }]);
    const tree = buildUpidEditorTree(source);
    if (tree.status === 'ready') throw new Error('Expected unresolved initial wire position');
    const operation = tree.operations[0];
    const diagnostic = { ...tree.diagnostics[0], operationId: operation.operationId };
    const onEdit = vi.fn();
    await act(async () => root.render(
      <EditorProgramTree
        tree={{ ...tree, diagnostics: [diagnostic], operations: [{ ...operation, children: [diagnostic] }] }}
        expandedTreeKeys={new Set(['section:program', operation.treeKey])}
        onEdit={onEdit} onSelect={vi.fn()} onExpandedTreeKeysChange={vi.fn()} selectedTreeKey={null}
      />
    ));
    const rows = [...container.querySelectorAll<HTMLElement>('[data-tree-key]')];
    expect(rows.filter((row) => row.dataset.treeKey === diagnostic.treeKey)).toHaveLength(1);
    const operationRow = rows.find((row) => row.dataset.treeKey === operation.treeKey);
    if (!operationRow) throw new Error('Missing operation row');
    expect(operationRow.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('unresolved');
    await act(async () => {
      operationRow.focus();
      operationRow.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(document.activeElement?.getAttribute('data-tree-key')).toBe(diagnostic.treeKey);
    await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(onEdit).toHaveBeenCalledWith(diagnostic, diagnostic.treeKey);
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
