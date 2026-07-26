import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCharmillesRobofil100V2CandidateProfile } from '@/domain/machine/machineProfiles';
import { setMachiningSpanParticipation } from '@/domain/path-intel/machiningParticipation';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { buildUpidProgramTree } from '@/domain/upid/upidProgramTree';
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
  statusActionTarget: { kind: 'initial-wire' },
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
  statusActionTarget: { kind: 'diagnostics', diagnosticId: 'compensation' },
  operationId: 'beta',
  editTarget: { kind: 'operation', operationId: 'beta' },
  sequenceEditTarget: { kind: 'cut-sequence', operationId: 'beta' },
  children: [{
    treeKey: 'operation:beta:diagnostic:compensation',
    kind: 'phase',
    label: 'Controller compensation is unsupported',
    status: 'blocked',
    statusReason: 'compensation-unsupported',
    statusActionTarget: { kind: 'diagnostics', diagnosticId: 'compensation' },
    editTarget: { kind: 'diagnostics', diagnosticId: 'compensation' },
    children: []
  }]
};

const tree: UpidProgramTree = {
  status: 'blocked',
  sourceSetupStatus: 'review-required',
  sourceSetupStatusReason: 'review wire origin',
  sourceSetupStatusActionTarget: { kind: 'initial-wire' },
  programStatus: 'blocked',
  programStatusReason: 'compensation unsupported',
  programStatusActionTarget: { kind: 'diagnostics', diagnosticId: 'compensation' },
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

  it('activates editable child rows atomically and keeps operation and Cut path rows selection-only', async () => {
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
    expect(onEdit).toHaveBeenLastCalledWith(
      { kind: 'entry-exit', operationId: 'alpha' },
      hostileEntryTreeKey
    );
    expect(onSelect).not.toHaveBeenCalled();

    onEdit.mockClear();
    await act(async () => {
      treeItem(alphaOperation.treeKey)
        ?.querySelector<HTMLElement>(':scope > [data-editor-program-tree-row]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSelect).toHaveBeenLastCalledWith(alphaOperation.treeKey, alphaOperation);
    expect(onEdit).not.toHaveBeenCalled();

    await act(async () => {
      cutPathRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      cutPath?.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter'
      }));
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
      statusActionTarget: blockedDiagnostic.editTarget,
      children: [blockedDiagnostic]
    };
    const blockedOperation = {
      ...alphaOperation,
      status: 'blocked' as const,
      statusActionTarget: blockedDiagnostic.editTarget,
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
      blockedCutPath.treeKey
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
      'Open status details for Source & Setup: Review required: review wire origin'
    );
    const programStatus = buttonWithLabel(
      'Open status details for Program Sequence: Blocked: compensation unsupported'
    );

    expect(sourceStatus).not.toBeNull();
    expect(programStatus).not.toBeNull();

    await act(async () => sourceStatus?.click());
    expect(onEdit).toHaveBeenLastCalledWith(
      { kind: 'initial-wire' },
      'section:source'
    );

    await act(async () => programStatus?.click());
    expect(onEdit).toHaveBeenLastCalledWith(
      { kind: 'diagnostics', diagnosticId: 'compensation' },
      'section:program'
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
      'section:source'
    );
    expect(onEdit).toHaveBeenNthCalledWith(
      2,
      { kind: 'diagnostics', diagnosticId: 'compensation' },
      'section:program'
    );
  });

  it('routes real unowned and operation-owned failures through explicit status targets', async () => {
    const onEdit = vi.fn();
    const document = twoRectangleDocument();
    document.machiningParticipation = {
      spans: [{
        id: 'orphan-span',
        sourceSegmentId: 'missing-segment',
        range: { start: 0, end: 1 },
        participation: 'inactive-reference'
      }]
    };
    const unownedTree = buildUpidProgramTree(
      document,
      createCharmillesRobofil100V2CandidateProfile()
    );

    await renderTree({
      expandedTreeKeys: new Set(['section:program']),
      onEdit,
      tree: unownedTree
    });
    const programStatus = buttonWithLabel(
      'Open status details for Program Sequence: Blocked: missing-source-segment'
    );
    expect(programStatus).not.toBeNull();
    await act(async () => programStatus?.click());
    expect(onEdit).toHaveBeenLastCalledWith(
      { kind: 'machining-participation' },
      'section:program'
    );

    const ownedDocument = twoRectangleDocument();
    const source = ownedDocument.plan.operations[0];
    const firstEdit = setMachiningSpanParticipation(ownedDocument, {
      sourceSegmentId: source.segmentRefs[0].segmentId,
      range: { start: 0, end: 1 },
      participation: 'inactive-reference'
    })!;
    const ownedFailure = setMachiningSpanParticipation(firstEdit, {
      sourceSegmentId: source.segmentRefs[2].segmentId,
      range: { start: 0, end: 1 },
      participation: 'inactive-reference'
    })!;
    const ownedTree = buildUpidProgramTree(
      ownedFailure,
      createCharmillesRobofil100V2CandidateProfile()
    );
    const operation = ownedTree.operations.find((node) => node.operationId === source.id)!;
    const cutPath = operation.children.find((node) => node.label === 'Cut path')!;

    await renderTree({
      expandedTreeKeys: new Set(['section:program', operation.treeKey]),
      onEdit,
      tree: ownedTree
    });
    onEdit.mockClear();

    await act(async () => {
      treeItem(operation.treeKey)
        ?.querySelector<HTMLButtonElement>(
          ':scope > [data-editor-program-tree-row] > button[aria-label^="Open status details"]'
        )
        ?.click();
    });
    expect(onEdit).toHaveBeenLastCalledWith(
      { kind: 'machining-participation', operationId: source.id },
      operation.treeKey
    );

    onEdit.mockClear();
    await act(async () => {
      treeItem(cutPath.treeKey)?.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter'
      }));
    });
    expect(onEdit).not.toHaveBeenCalled();

    await act(async () => {
      treeItem(cutPath.treeKey)?.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'Enter'
      }));
    });
    expect(onEdit).toHaveBeenLastCalledWith(
      { kind: 'machining-participation', operationId: source.id },
      cutPath.treeKey
    );
  });

  it('keeps selection, focus, and routing distinct for colliding imported operation ids', async () => {
    const onEdit = vi.fn();
    const onSelect = vi.fn();
    const pathDocument = twoRectangleDocument();
    const [first, second] = pathDocument.plan.operations;
    renameOperation(pathDocument, first.id, 'alpha');
    renameOperation(pathDocument, second.id, 'alpha:entry');
    const realTree = buildUpidProgramTree(
      pathDocument,
      createCharmillesRobofil100V2CandidateProfile()
    );
    const firstRoot = realTree.operations.find((node) => node.operationId === 'alpha')!;
    const firstEntry = firstRoot.children.find((node) => node.label === 'Entry / lead-in')!;
    const secondRoot = realTree.operations.find((node) => node.operationId === 'alpha:entry')!;
    const expansion = new Set(['section:program', firstRoot.treeKey, secondRoot.treeKey]);

    await renderTree({
      expandedTreeKeys: expansion,
      onEdit,
      onSelect,
      selectedTreeKey: firstEntry.treeKey,
      tree: realTree
    });

    expect(firstEntry.treeKey).not.toBe(secondRoot.treeKey);
    expect(treeItem(firstEntry.treeKey)?.getAttribute('aria-selected')).toBe('true');
    expect(treeItem(secondRoot.treeKey)?.getAttribute('aria-selected')).toBe('false');

    await act(async () => {
      treeItem(firstEntry.treeKey)
        ?.querySelector<HTMLButtonElement>('button[aria-label="Edit Entry / lead-in"]')
        ?.click();
      treeItem(secondRoot.treeKey)
        ?.querySelector<HTMLButtonElement>(
          `button[aria-label="Edit ${secondRoot.label}"]`
        )
        ?.click();
    });
    expect(onEdit).toHaveBeenNthCalledWith(
      1,
      { kind: 'entry-exit', operationId: 'alpha' },
      firstEntry.treeKey
    );
    expect(onEdit).toHaveBeenNthCalledWith(
      2,
      { kind: 'operation', operationId: 'alpha:entry' },
      secondRoot.treeKey
    );

    await renderTree({
      expandedTreeKeys: expansion,
      onEdit,
      onSelect,
      selectedTreeKey: secondRoot.treeKey,
      tree: realTree
    });
    expect(treeItem(firstEntry.treeKey)?.getAttribute('aria-selected')).toBe('false');
    expect(treeItem(secondRoot.treeKey)?.getAttribute('aria-selected')).toBe('true');

    await act(async () => {
      treeItem(firstEntry.treeKey)?.focus();
      treeItem(firstEntry.treeKey)?.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'ArrowLeft'
      }));
    });
    expect(document.activeElement).toBe(treeItem(firstRoot.treeKey));
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

function twoRectangleDocument() {
  const document = createUpidFromDxfEntities([
    ...rectangleLines(0, 0, 20, 20),
    ...rectangleLines(5, 5, 10, 10)
  ]);
  document.setup = {
    initialWirePosition: {
      kind: 'manual',
      point: { x: 0, y: 0 },
      review: 'reviewed'
    }
  };
  return document;
}

function renameOperation(
  document: ReturnType<typeof twoRectangleDocument>,
  originalId: string,
  nextId: string
) {
  const operation = document.plan.operations.find((candidate) => candidate.id === originalId)!;
  operation.id = nextId;
  for (const pathElement of document.pathElements) {
    if (pathElement.operationId === originalId) pathElement.operationId = nextId;
  }
}

function rectangleLines(minX: number, minY: number, maxX: number, maxY: number) {
  return [
    { type: 'line' as const, layer: 'CUT', start: { x: minX, y: minY }, end: { x: maxX, y: minY } },
    { type: 'line' as const, layer: 'CUT', start: { x: maxX, y: minY }, end: { x: maxX, y: maxY } },
    { type: 'line' as const, layer: 'CUT', start: { x: maxX, y: maxY }, end: { x: minX, y: maxY } },
    { type: 'line' as const, layer: 'CUT', start: { x: minX, y: maxY }, end: { x: minX, y: minY } }
  ];
}
