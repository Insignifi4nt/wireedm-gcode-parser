import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  UpidProgramTree,
  UpidProgramTreeNode
} from '@/domain/upid/upidProgramTree';

import { EditorProgramTree } from '../EditorProgramTree';
import {
  defaultEditorProgramTreeExpansion,
  pruneEditorProgramTreeExpansion
} from '../editorProgramTreeState';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hostileEntryTreeKey = 'phase:alpha:entry"][data-tree-key="other';

const geometryNode: UpidProgramTreeNode = {
  treeKey: 'setup:geometry',
  kind: 'setup',
  label: 'Geometry setup',
  status: 'ready',
  editTarget: { kind: 'geometry-setup' },
  children: []
};

const initialWireNode: UpidProgramTreeNode = {
  treeKey: 'setup:initial-wire',
  kind: 'setup',
  label: 'Initial wire position',
  status: 'review-required',
  statusReason: 'review wire origin',
  editTarget: { kind: 'initial-wire' },
  children: []
};

const entryNode: UpidProgramTreeNode = {
  treeKey: hostileEntryTreeKey,
  kind: 'phase',
  label: 'Entry / lead-in',
  status: 'ready',
  editTarget: { kind: 'entry-exit', operationId: 'alpha' },
  children: []
};

const cutPathNode: UpidProgramTreeNode = {
  treeKey: 'operation:alpha:cut-path',
  kind: 'phase',
  label: 'Cut path',
  detail: '4 segments',
  status: 'ready',
  operationId: 'alpha',
  children: []
};

const alphaOperation: UpidProgramTreeNode = {
  treeKey: 'operation:alpha',
  kind: 'operation',
  label: '01 · Hole 1',
  status: 'ready',
  operationId: 'alpha',
  editTarget: { kind: 'operation', operationId: 'alpha' },
  sequenceEditTarget: { kind: 'cut-sequence', operationId: 'alpha' },
  children: [entryNode, cutPathNode]
};

const betaOperation: UpidProgramTreeNode = {
  treeKey: 'operation:beta',
  kind: 'operation',
  label: '02 · Hole 2',
  status: 'blocked',
  statusReason: 'compensation unsupported',
  operationId: 'beta',
  editTarget: { kind: 'operation', operationId: 'beta' },
  sequenceEditTarget: { kind: 'cut-sequence', operationId: 'beta' },
  children: [{
    treeKey: 'operation:beta:diagnostic:compensation',
    kind: 'phase',
    label: 'Controller compensation is unsupported',
    status: 'blocked',
    statusReason: 'compensation-unsupported',
    editTarget: { kind: 'diagnostics', diagnosticId: 'compensation' },
    children: []
  }]
};

const tree: UpidProgramTree = {
  status: 'blocked',
  sourceSetupStatus: 'review-required',
  programStatus: 'blocked',
  sourceSetup: [geometryNode, initialWireNode],
  operations: [alphaOperation, betaOperation]
};

describe('editorProgramTreeState', () => {
  it('starts with the program section and first operation expanded', () => {
    expect(defaultEditorProgramTreeExpansion(tree)).toEqual(
      new Set(['section:program', tree.operations[0].treeKey])
    );
  });

  it('starts an empty program with Source & Setup expanded', () => {
    expect(defaultEditorProgramTreeExpansion({ ...tree, operations: [] })).toEqual(
      new Set(['section:source'])
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

  function treeItem(treeKey: string) {
    return [...container.querySelectorAll<HTMLElement>('[role="treeitem"]')]
      .find((item) => item.dataset.treeKey === treeKey) ?? null;
  }

  function buttonWithLabel(label: string) {
    return [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.getAttribute('aria-label') === label) ?? null;
  }

  async function renderTree({
    expandedTreeKeys = new Set(['section:program', 'operation:alpha']),
    onEdit = vi.fn(),
    onExpandedTreeKeysChange = vi.fn(),
    onSelect = vi.fn(),
    selectedTreeKey = null,
    tree: renderedTree = tree
  }: Partial<Parameters<typeof EditorProgramTree>[0]> = {}) {
    await act(async () => {
      root.render(
        <EditorProgramTree
          expandedTreeKeys={expandedTreeKeys}
          onEdit={onEdit}
          onExpandedTreeKeysChange={onExpandedTreeKeysChange}
          onSelect={onSelect}
          selectedTreeKey={selectedTreeKey}
          tree={renderedTree}
        />
      );
    });
  }

  it('renders semantic levels and exposes an explicitly selected child action', async () => {
    await renderTree({ selectedTreeKey: hostileEntryTreeKey });

    expect(container.querySelector('[role="tree"]')).not.toBeNull();
    expect(container.querySelector('[aria-level="1"]')).not.toBeNull();
    expect(container.querySelector('[aria-expanded="true"]')).not.toBeNull();
    expect(treeItem(hostileEntryTreeKey)?.getAttribute('aria-selected')).toBe('true');
    expect(treeItem('operation:alpha')?.getAttribute('aria-selected')).toBe('false');
  });

  it('navigates hostile valid keys with arrows and Home/End without selector interpolation', async () => {
    await renderTree();

    const programSection = treeItem('section:program');
    const operation = treeItem('operation:alpha');
    const entry = treeItem(hostileEntryTreeKey);
    const finalOperation = treeItem('operation:beta');

    await act(async () => {
      programSection?.focus();
      programSection?.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'ArrowRight'
      }));
    });
    expect(document.activeElement).toBe(operation);

    await act(async () => {
      operation?.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'ArrowDown'
      }));
    });
    expect(document.activeElement).toBe(entry);

    await act(async () => {
      entry?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'End' }));
    });
    expect(document.activeElement).toBe(finalOperation);

    await act(async () => {
      finalOperation?.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'Home'
      }));
    });
    expect(document.activeElement).toBe(treeItem('section:source'));

    await act(async () => {
      entry?.focus();
      entry?.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'ArrowLeft'
      }));
    });
    expect(document.activeElement).toBe(operation);
  });

  it('uses Space only for selection and Enter for activation on child actions', async () => {
    const onEdit = vi.fn();
    const onSelect = vi.fn();
    await renderTree({ onEdit, onSelect });

    const entry = treeItem(hostileEntryTreeKey);
    await act(async () => {
      entry?.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: ' '
      }));
    });

    expect(onSelect).toHaveBeenLastCalledWith(hostileEntryTreeKey, entryNode);
    expect(onEdit).not.toHaveBeenCalled();

    await act(async () => {
      entry?.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter'
      }));
    });

    expect(onEdit).toHaveBeenLastCalledWith(
      { kind: 'entry-exit', operationId: 'alpha' },
      hostileEntryTreeKey
    );
  });

  it('selects on row click, edits on double-click, and keeps Cut path selection-only', async () => {
    const onEdit = vi.fn();
    const onSelect = vi.fn();
    await renderTree({ onEdit, onSelect });

    const entryRow = treeItem(hostileEntryTreeKey)?.querySelector<HTMLElement>(
      ':scope > [data-editor-program-tree-row]'
    );
    const cutPath = treeItem(cutPathNode.treeKey);
    const cutPathRow = cutPath?.querySelector<HTMLElement>(
      ':scope > [data-editor-program-tree-row]'
    );

    await act(async () => {
      entryRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSelect).toHaveBeenLastCalledWith(hostileEntryTreeKey, entryNode);
    expect(onEdit).not.toHaveBeenCalled();

    await act(async () => {
      entryRow?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(onEdit).toHaveBeenLastCalledWith(
      { kind: 'entry-exit', operationId: 'alpha' },
      hostileEntryTreeKey
    );

    onEdit.mockClear();
    await act(async () => {
      cutPathRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      cutPath?.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter'
      }));
      cutPathRow?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });

    expect(onSelect).toHaveBeenLastCalledWith(cutPathNode.treeKey, cutPathNode);
    expect(onEdit).not.toHaveBeenCalled();
    expect(buttonWithLabel('Edit Cut path')).toBeNull();

    const blockedDiagnostic: UpidProgramTreeNode = {
      treeKey: 'operation:alpha:cut-path:diagnostic',
      kind: 'phase',
      label: 'Cut path diagnostic',
      status: 'blocked',
      editTarget: { kind: 'diagnostics', diagnosticId: 'cut-path' },
      children: []
    };
    const blockedCutPath = {
      ...cutPathNode,
      status: 'blocked' as const,
      children: [blockedDiagnostic]
    };
    const blockedOperation = {
      ...alphaOperation,
      status: 'blocked' as const,
      children: [entryNode, blockedCutPath]
    };
    await renderTree({
      onEdit,
      onSelect,
      tree: { ...tree, operations: [blockedOperation, betaOperation] }
    });
    onEdit.mockClear();

    await act(async () => {
      treeItem(blockedCutPath.treeKey)?.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter'
      }));
    });
    expect(onEdit).not.toHaveBeenCalled();

    await act(async () => {
      treeItem(blockedCutPath.treeKey)?.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'Enter'
      }));
    });
    expect(onEdit).toHaveBeenLastCalledWith(
      { kind: 'diagnostics', diagnosticId: 'cut-path' },
      blockedDiagnostic.treeKey
    );
  });

  it('exposes the operation ordinal as the exact Cut Sequence action', async () => {
    const onEdit = vi.fn();
    await renderTree({ onEdit });

    const sequenceAction = buttonWithLabel('Edit cut sequence for 01 · Hole 1');
    expect(sequenceAction?.textContent).toBe('01');

    await act(async () => sequenceAction?.click());
    expect(onEdit).toHaveBeenLastCalledWith(
      { kind: 'cut-sequence', operationId: 'alpha' },
      'operation:alpha'
    );

    await act(async () => buttonWithLabel('Edit 01 · Hole 1')?.click());
    expect(onEdit).toHaveBeenLastCalledWith(
      { kind: 'operation', operationId: 'alpha' },
      'operation:alpha'
    );

    onEdit.mockClear();
    await act(async () => {
      sequenceAction?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(onEdit).not.toHaveBeenCalled();

    onEdit.mockClear();
    await act(async () => {
      treeItem('operation:alpha')?.dispatchEvent(new KeyboardEvent('keydown', {
        altKey: true,
        bubbles: true,
        cancelable: true,
        key: 'Enter'
      }));
    });
    expect(onEdit).toHaveBeenLastCalledWith(
      { kind: 'cut-sequence', operationId: 'alpha' },
      'operation:alpha'
    );
  });

  it('renders section-specific statuses and routes actionable status markers truthfully', async () => {
    const onEdit = vi.fn();
    const onSelect = vi.fn();
    await renderTree({
      expandedTreeKeys: new Set(['section:source', 'section:program']),
      onEdit,
      onSelect
    });

    const sourceStatus = buttonWithLabel(
      'Open status details for Source & Setup: Review required'
    );
    const programStatus = buttonWithLabel(
      'Open status details for Program Sequence: Blocked'
    );

    expect(sourceStatus).not.toBeNull();
    expect(programStatus).not.toBeNull();

    await act(async () => sourceStatus?.click());
    expect(onEdit).toHaveBeenLastCalledWith(
      { kind: 'initial-wire' },
      initialWireNode.treeKey
    );

    await act(async () => programStatus?.click());
    expect(onEdit).toHaveBeenLastCalledWith(
      { kind: 'diagnostics', diagnosticId: 'compensation' },
      'operation:beta:diagnostic:compensation'
    );
    expect(onSelect).not.toHaveBeenCalled();

    onEdit.mockClear();
    await act(async () => {
      treeItem('section:source')?.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'Enter'
      }));
      treeItem('section:program')?.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'Enter'
      }));
    });
    expect(onEdit).toHaveBeenNthCalledWith(
      1,
      { kind: 'initial-wire' },
      initialWireNode.treeKey
    );
    expect(onEdit).toHaveBeenNthCalledWith(
      2,
      { kind: 'diagnostics', diagnosticId: 'compensation' },
      'operation:beta:diagnostic:compensation'
    );
  });

  it('keeps exactly one roving treeitem target and removes descendants from the tab order', async () => {
    await renderTree();

    const visibleItems = [...container.querySelectorAll<HTMLElement>('[role="treeitem"]')];
    expect(visibleItems.filter((item) => item.tabIndex === 0)).toHaveLength(1);
    expect(visibleItems.every((item) => item.hasAttribute('tabindex'))).toBe(true);

    for (const item of visibleItems) {
      const directRow = item.querySelector<HTMLElement>(
        ':scope > [data-editor-program-tree-row]'
      );
      const descendantControls = directRow?.querySelectorAll<HTMLButtonElement>('button') ?? [];
      expect([...descendantControls].every((button) => button.tabIndex === -1)).toBe(true);
    }
  });
});
