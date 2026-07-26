import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UpidProgramTree } from '@/domain/upid/upidProgramTree';

import { EditorProgramTree } from '../EditorProgramTree';
import {
  defaultEditorProgramTreeExpansion,
  pruneEditorProgramTreeExpansion
} from '../editorProgramTreeState';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tree: UpidProgramTree = {
  status: 'ready',
  sourceSetup: [{
    treeKey: 'setup:geometry',
    kind: 'setup',
    label: 'Geometry setup',
    status: 'ready',
    editTarget: { kind: 'geometry-setup' },
    children: []
  }],
  operations: [
    {
      treeKey: 'operation:alpha',
      kind: 'operation',
      label: '01 · Hole 1',
      status: 'ready',
      operationId: 'alpha',
      editTarget: { kind: 'operation', operationId: 'alpha' },
      children: [{
        treeKey: 'phase:alpha:entry',
        kind: 'phase',
        label: 'Entry / lead-in',
        status: 'ready',
        editTarget: { kind: 'entry-exit', operationId: 'alpha' },
        children: []
      }]
    },
    {
      treeKey: 'operation:beta',
      kind: 'operation',
      label: '02 · Hole 2',
      status: 'review-required',
      statusReason: 'Confirm clearance',
      operationId: 'beta',
      editTarget: { kind: 'operation', operationId: 'beta' },
      children: []
    }
  ]
};

describe('editorProgramTreeState', () => {
  it('starts with the program section and first operation expanded', () => {
    expect(defaultEditorProgramTreeExpansion(tree)).toEqual(
      new Set(['section:program', tree.operations[0].treeKey])
    );
  });

  it('drops expansion keys that are absent from the next projection', () => {
    const nextTree = { ...tree, operations: [tree.operations[0]] };

    expect(
      pruneEditorProgramTreeExpansion(
        new Set(['section:program', 'operation:alpha', 'removed-op']),
        nextTree
      )
    ).not.toContain('removed-op');
  });
});

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

  it('renders semantic levels and exposes expanded program nodes', async () => {
    await act(async () => {
      root.render(
        <EditorProgramTree
          expandedTreeKeys={new Set(['section:program', 'operation:alpha'])}
          onEdit={vi.fn()}
          onExpandedTreeKeysChange={vi.fn()}
          onSelect={vi.fn()}
          selectedTreeKey="operation:alpha"
          tree={tree}
        />
      );
    });

    expect(container.querySelector('[role="tree"]')).not.toBeNull();
    expect(container.querySelector('[aria-level="1"]')).not.toBeNull();
    expect(container.querySelector('[aria-expanded="true"]')).not.toBeNull();
    expect(container.querySelector('[aria-selected="true"]')?.getAttribute('data-tree-key'))
      .toBe('operation:alpha');
  });

  it('moves among visible rows, expands and collapses branches, selects with Space, and edits with Enter', async () => {
    const onEdit = vi.fn();
    const onExpandedTreeKeysChange = vi.fn();
    const onSelect = vi.fn();

    await act(async () => {
      root.render(
        <EditorProgramTree
          expandedTreeKeys={new Set(['section:program', 'operation:alpha'])}
          onEdit={onEdit}
          onExpandedTreeKeysChange={onExpandedTreeKeysChange}
          onSelect={onSelect}
          selectedTreeKey={null}
          tree={tree}
        />
      );
    });

    const programSection = container.querySelector<HTMLButtonElement>('button[data-tree-key="section:program"]');
    const operation = container.querySelector<HTMLButtonElement>('button[data-tree-key="operation:alpha"]');
    const entry = container.querySelector<HTMLButtonElement>('button[data-tree-key="phase:alpha:entry"]');

    await act(async () => {
      programSection?.focus();
      programSection?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
    });
    expect(document.activeElement).toBe(operation);

    await act(async () => {
      operation?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
    });
    expect(document.activeElement).toBe(entry);

    await act(async () => {
      entry?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft' }));
    });
    expect(document.activeElement).toBe(operation);

    await act(async () => {
      operation?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft' }));
    });
    expect(onExpandedTreeKeysChange).toHaveBeenLastCalledWith(
      new Set(['section:program'])
    );

    await act(async () => {
      operation?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' }));
      operation?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    });
    expect(onSelect).toHaveBeenLastCalledWith(tree.operations[0]);
    expect(onEdit).toHaveBeenLastCalledWith({ kind: 'operation', operationId: 'alpha' });
  });

  it('activates editable child actions directly', async () => {
    const onEdit = vi.fn();

    await act(async () => {
      root.render(
        <EditorProgramTree
          expandedTreeKeys={new Set(['section:program', 'operation:alpha'])}
          onEdit={onEdit}
          onExpandedTreeKeysChange={vi.fn()}
          onSelect={vi.fn()}
          selectedTreeKey={null}
          tree={tree}
        />
      );
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[data-tree-key="phase:alpha:entry"]')?.click();
    });
    expect(onEdit).toHaveBeenCalledWith({ kind: 'entry-exit', operationId: 'alpha' });
  });
});
