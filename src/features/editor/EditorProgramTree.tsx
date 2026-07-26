import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import type {
  UpidProgramTree,
  UpidProgramTreeEditTarget,
  UpidProgramTreeNode,
  UpidProgramTreeStatus
} from '@/domain/upid/upidProgramTree';

import {
  pruneEditorProgramTreeExpansion,
  revealEditorProgramTreeNode
} from './editorProgramTreeState';

export interface EditorProgramTreeProps {
  tree: UpidProgramTree;
  selectedTreeKey: string | null;
  expandedTreeKeys: ReadonlySet<string>;
  onExpandedTreeKeysChange: (keys: ReadonlySet<string>) => void;
  onSelect: (node: UpidProgramTreeNode) => void;
  onEdit: (target: UpidProgramTreeEditTarget) => void;
}

interface EditorProgramTreeItem {
  children: EditorProgramTreeItem[];
  key: string;
  label: string;
  level: number;
  node?: UpidProgramTreeNode;
  parentKey?: string;
  status: UpidProgramTreeStatus;
  statusReason?: string;
}

const SOURCE_SETUP_SECTION_KEY = 'section:source';
const PROGRAM_SEQUENCE_SECTION_KEY = 'section:program';

export function EditorProgramTree({
  expandedTreeKeys,
  onEdit,
  onExpandedTreeKeysChange,
  onSelect,
  selectedTreeKey,
  tree
}: EditorProgramTreeProps) {
  const treeRef = useRef<HTMLUListElement>(null);
  const [focusedTreeKey, setFocusedTreeKey] = useState<string>(SOURCE_SETUP_SECTION_KEY);
  const items = useMemo(() => buildTreeItems(tree), [tree]);
  const visibleItems = useMemo(
    () => flattenVisibleTreeItems(items, expandedTreeKeys),
    [expandedTreeKeys, items]
  );

  useEffect(() => {
    const pruned = pruneEditorProgramTreeExpansion(expandedTreeKeys, tree);
    const next = selectedTreeKey
      ? revealEditorProgramTreeNode(tree, pruned, selectedTreeKey)
      : pruned;

    if (!areTreeKeySetsEqual(next, expandedTreeKeys)) onExpandedTreeKeysChange(next);
  }, [expandedTreeKeys, onExpandedTreeKeysChange, selectedTreeKey, tree]);

  useEffect(() => {
    if (!visibleItems.some((item) => item.key === focusedTreeKey)) {
      setFocusedTreeKey(visibleItems[0]?.key ?? '');
    }
  }, [focusedTreeKey, visibleItems]);

  function updateExpansion(treeKey: string, expanded: boolean) {
    const next = new Set(expandedTreeKeys);
    if (expanded) next.add(treeKey);
    else next.delete(treeKey);
    onExpandedTreeKeysChange(next);
  }

  function focusTreeItem(treeKey: string) {
    setFocusedTreeKey(treeKey);
    treeRef.current
      ?.querySelector<HTMLButtonElement>(`button[data-tree-key="${treeKey}"]`)
      ?.focus();
  }

  function handleRowKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    item: EditorProgramTreeItem
  ) {
    const index = visibleItems.findIndex((visibleItem) => visibleItem.key === item.key);
    const isExpanded = expandedTreeKeys.has(item.key);
    const hasChildren = item.children.length > 0;

    if (event.key === 'ArrowDown' && index < visibleItems.length - 1) {
      event.preventDefault();
      focusTreeItem(visibleItems[index + 1].key);
      return;
    }
    if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault();
      focusTreeItem(visibleItems[index - 1].key);
      return;
    }
    if (event.key === 'ArrowRight' && hasChildren) {
      event.preventDefault();
      if (!isExpanded) updateExpansion(item.key, true);
      else focusTreeItem(item.children[0].key);
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (hasChildren && isExpanded) updateExpansion(item.key, false);
      else if (item.parentKey) focusTreeItem(item.parentKey);
      return;
    }
    if (event.key === ' ') {
      event.preventDefault();
      if (item.node) onSelect(item.node);
      return;
    }
    if (event.key === 'Enter' && item.node?.editTarget) {
      event.preventDefault();
      onEdit(item.node.editTarget);
    }
  }

  function handleRowClick(item: EditorProgramTreeItem) {
    if (!item.node) {
      if (item.children.length > 0) updateExpansion(item.key, !expandedTreeKeys.has(item.key));
      return;
    }

    if (item.node.kind === 'operation' || !item.node.editTarget) onSelect(item.node);
    else onEdit(item.node.editTarget);
  }

  function renderItem(item: EditorProgramTreeItem): React.ReactNode {
    const hasChildren = item.children.length > 0;
    const isExpanded = expandedTreeKeys.has(item.key);
    const isSelected = item.node?.treeKey === selectedTreeKey;
    const isOperation = item.node?.kind === 'operation';

    return (
      <li
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-level={item.level}
        aria-selected={item.node ? isSelected : undefined}
        data-tree-key={item.key}
        key={item.key}
        role="treeitem"
      >
        <div className="flex min-w-0 items-center gap-1" style={{ paddingLeft: `${(item.level - 1) * 10}px` }}>
          {hasChildren ? (
            <button
              aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${item.label}`}
              className="flex size-4 shrink-0 items-center justify-center text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => updateExpansion(item.key, !isExpanded)}
              title={`${isExpanded ? 'Collapse' : 'Expand'} ${item.label}`}
              type="button"
            >
              <span aria-hidden="true">{isExpanded ? '⌄' : '›'}</span>
            </button>
          ) : <span aria-hidden="true" className="size-4 shrink-0" />}
          <button
            className={`min-w-0 flex-1 truncate py-1 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring ${
              isSelected ? 'bg-accent text-foreground' : 'text-foreground hover:bg-accent/60'
            } ${isOperation ? 'font-medium' : ''}`}
            data-tree-key={item.key}
            onClick={() => handleRowClick(item)}
            onFocus={() => setFocusedTreeKey(item.key)}
            onKeyDown={(event) => handleRowKeyDown(event, item)}
            tabIndex={focusedTreeKey === item.key ? 0 : -1}
            title={item.statusReason ?? item.label}
            type="button"
          >
            {item.label}
          </button>
          <StatusMarker reason={item.statusReason} status={item.status} />
          {isOperation && item.node?.editTarget ? (
            <button
              aria-label={`Edit ${item.label}`}
              className="shrink-0 px-1 text-[9px] uppercase text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => onEdit(item.node!.editTarget!)}
              title={`Edit ${item.label}`}
              type="button"
            >
              Edit
            </button>
          ) : null}
        </div>
        {hasChildren && isExpanded ? (
          <ul role="group">
            {item.children.map(renderItem)}
          </ul>
        ) : null}
      </li>
    );
  }

  return (
    <ul
      aria-label="UPID program"
      className="min-h-0 overflow-auto text-[11px] leading-4"
      ref={treeRef}
      role="tree"
    >
      {items.map(renderItem)}
    </ul>
  );
}

function StatusMarker({ reason, status }: { reason?: string; status: UpidProgramTreeStatus }) {
  const label = `${formatStatus(status)}${reason ? `: ${reason}` : ''}`;
  const color = {
    ready: 'bg-emerald-500',
    'review-required': 'bg-amber-400',
    blocked: 'bg-red-500',
    inactive: 'bg-muted-foreground'
  }[status];

  return (
    <span aria-label={label} className={`size-1.5 shrink-0 rounded-full ${color}`} title={label} />
  );
}

function buildTreeItems(tree: UpidProgramTree): EditorProgramTreeItem[] {
  return [
    createSection(SOURCE_SETUP_SECTION_KEY, 'Source & Setup', tree.sourceSetup, 1, tree.status),
    createSection(PROGRAM_SEQUENCE_SECTION_KEY, 'Program Sequence', tree.operations, 1, tree.status)
  ];
}

function createSection(
  key: string,
  label: string,
  nodes: readonly UpidProgramTreeNode[],
  level: number,
  status: UpidProgramTreeStatus
): EditorProgramTreeItem {
  return {
    children: nodes.map((node) => createNodeItem(node, level + 1, key)),
    key,
    label,
    level,
    status
  };
}

function createNodeItem(
  node: UpidProgramTreeNode,
  level: number,
  parentKey: string
): EditorProgramTreeItem {
  return {
    children: node.children.map((child) => createNodeItem(child, level + 1, node.treeKey)),
    key: node.treeKey,
    label: node.detail ? `${node.label} · ${node.detail}` : node.label,
    level,
    node,
    parentKey,
    status: node.status,
    statusReason: node.statusReason
  };
}

function flattenVisibleTreeItems(
  items: readonly EditorProgramTreeItem[],
  expandedTreeKeys: ReadonlySet<string>
): EditorProgramTreeItem[] {
  return items.flatMap((item) => [
    item,
    ...(expandedTreeKeys.has(item.key)
      ? flattenVisibleTreeItems(item.children, expandedTreeKeys)
      : [])
  ]);
}

function areTreeKeySetsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  return left.size === right.size && [...left].every((key) => right.has(key));
}

function formatStatus(status: UpidProgramTreeStatus) {
  return {
    ready: 'Ready',
    'review-required': 'Review required',
    blocked: 'Blocked',
    inactive: 'Inactive'
  }[status];
}
