import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent
} from 'react';

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
  onSelect: (treeKey: string, node: UpidProgramTreeNode | null) => void;
  onEdit: (target: UpidProgramTreeEditTarget, treeKey: string) => void;
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
  statusActionTarget?: UpidProgramTreeEditTarget;
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
  const treeItemRefs = useRef(new Map<string, HTMLLIElement>());
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
    treeItemRefs.current.get(treeKey)?.focus();
  }

  function selectItem(item: EditorProgramTreeItem) {
    focusTreeItem(item.key);
    onSelect(item.key, item.node ?? null);
  }

  function handleRowClick(
    event: MouseEvent<HTMLDivElement>,
    item: EditorProgramTreeItem
  ) {
    if (event.detail > 1) return;
    focusTreeItem(item.key);
    if (
      item.children.length === 0 &&
      item.node?.kind !== 'operation' &&
      item.node?.editTarget
    ) {
      onEdit(item.node.editTarget, item.key);
      return;
    }
    onSelect(item.key, item.node ?? null);
  }

  function activateItem(item: EditorProgramTreeItem) {
    if (item.node?.editTarget) {
      onEdit(item.node.editTarget, item.key);
    }
  }

  function handleTreeItemKeyDown(
    event: KeyboardEvent<HTMLLIElement>,
    item: EditorProgramTreeItem
  ) {
    if (event.target !== event.currentTarget) return;

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
    if (event.key === 'Home' && visibleItems.length > 0) {
      event.preventDefault();
      focusTreeItem(visibleItems[0].key);
      return;
    }
    if (event.key === 'End' && visibleItems.length > 0) {
      event.preventDefault();
      focusTreeItem(visibleItems[visibleItems.length - 1].key);
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
      selectItem(item);
      return;
    }
    if (event.key === 'Enter' && event.altKey && item.node?.sequenceEditTarget) {
      event.preventDefault();
      onEdit(item.node.sequenceEditTarget, item.key);
      return;
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      if (item.statusActionTarget && isActionableStatus(item.status)) {
        event.preventDefault();
        onEdit(item.statusActionTarget, item.key);
        return;
      }
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      activateItem(item);
    }
  }

  function handleSecondaryAction(
    event: MouseEvent<HTMLButtonElement>,
    item: EditorProgramTreeItem,
    action: () => void
  ) {
    event.stopPropagation();
    if (event.detail > 1) return;
    focusTreeItem(item.key);
    action();
  }

  function renderItem(item: EditorProgramTreeItem): React.ReactNode {
    const hasChildren = item.children.length > 0;
    const isExpanded = expandedTreeKeys.has(item.key);
    const isSelected = item.key === selectedTreeKey;
    const sequenceTarget = item.node?.sequenceEditTarget;
    const operationOrdinal = sequenceTarget ? readOperationOrdinal(item.node?.label ?? '') : null;
    const statusActionTarget = isActionableStatus(item.status)
      ? item.statusActionTarget
      : undefined;

    return (
      <li
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-keyshortcuts={readItemKeyboardShortcuts(item, statusActionTarget)}
        aria-label={item.label}
        aria-level={item.level}
        aria-selected={isSelected}
        className="outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        data-tree-key={item.key}
        key={item.key}
        onFocus={(event) => {
          if (event.target === event.currentTarget) setFocusedTreeKey(item.key);
        }}
        onKeyDown={(event) => handleTreeItemKeyDown(event, item)}
        ref={(element) => {
          if (element) treeItemRefs.current.set(item.key, element);
          else treeItemRefs.current.delete(item.key);
        }}
        role="treeitem"
        tabIndex={focusedTreeKey === item.key ? 0 : -1}
      >
        <div
          className={`flex min-w-0 items-center gap-1 ${
            isSelected ? 'bg-accent text-foreground' : 'text-foreground hover:bg-accent/60'
          }`}
          data-editor-program-tree-row
          onClick={(event) => handleRowClick(event, item)}
          style={{ paddingLeft: `${(item.level - 1) * 10}px` }}
        >
          {hasChildren ? (
            <button
              aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${item.label}`}
              className="flex size-4 shrink-0 items-center justify-center text-muted-foreground outline-none hover:text-foreground"
              onClick={(event) => handleSecondaryAction(
                event,
                item,
                () => updateExpansion(item.key, !isExpanded)
              )}
              tabIndex={-1}
              title={`${isExpanded ? 'Collapse' : 'Expand'} ${item.label}`}
              type="button"
            >
              <span aria-hidden="true">{isExpanded ? '⌄' : '›'}</span>
            </button>
          ) : <span aria-hidden="true" className="size-4 shrink-0" />}
          {sequenceTarget && operationOrdinal ? (
            <button
              aria-label={`Edit cut sequence for ${item.node!.label}`}
              className="min-w-5 shrink-0 px-0.5 font-mono text-[9px] text-cyan-300 outline-none hover:bg-cyan-500/15 hover:text-cyan-100"
              onClick={(event) => handleSecondaryAction(
                event,
                item,
                () => onEdit(sequenceTarget, item.key)
              )}
              tabIndex={-1}
              title={`Open Cut Sequence for ${item.node!.label}`}
              type="button"
            >
              {operationOrdinal}
            </button>
          ) : null}
          <span
            className={`min-w-0 flex-1 truncate py-1 text-left ${
              item.node?.kind === 'operation' ? 'font-medium' : ''
            }`}
            title={item.statusReason ?? item.label}
          >
            {sequenceTarget ? stripOperationOrdinal(item.label) : item.label}
          </span>
          <StatusMarker
            item={item}
            onAction={statusActionTarget
              ? (event) => handleSecondaryAction(
                  event,
                  item,
                  () => onEdit(statusActionTarget, item.key)
                )
              : undefined}
          />
          {item.node?.editTarget ? (
            <button
              aria-label={`Edit ${item.node.label}`}
              className="shrink-0 px-1 text-[9px] uppercase text-muted-foreground outline-none hover:text-foreground"
              onClick={(event) => handleSecondaryAction(
                event,
                item,
                () => onEdit(item.node!.editTarget!, item.key)
              )}
              tabIndex={-1}
              title={`Edit ${item.node.label}`}
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
      aria-label="UPID program sequence"
      className="min-h-0 overflow-auto text-[11px] leading-4"
      role="tree"
    >
      {items.map(renderItem)}
    </ul>
  );
}

function StatusMarker({
  item,
  onAction
}: {
  item: EditorProgramTreeItem;
  onAction?: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const label = `${formatStatus(item.status)}${
    item.statusReason ? `: ${item.statusReason}` : ''
  }`;
  const color = {
    ready: 'bg-emerald-500',
    'review-required': 'bg-amber-400',
    blocked: 'bg-red-500',
    inactive: 'bg-muted-foreground'
  }[item.status];

  if (onAction) {
    return (
      <button
        aria-label={`Open status details for ${item.label}: ${label}`}
        className={`size-2 shrink-0 rounded-full outline-none ${color}`}
        onClick={onAction}
        tabIndex={-1}
        title={`${label}. Open status details.`}
        type="button"
      />
    );
  }

  return (
    <span
      aria-label={label}
      className={`size-1.5 shrink-0 rounded-full ${color}`}
      role="img"
      title={label}
    />
  );
}

function buildTreeItems(tree: UpidProgramTree): EditorProgramTreeItem[] {
  return [
    createSection(
      SOURCE_SETUP_SECTION_KEY,
      'Source & Setup',
      tree.sourceSetup,
      1,
      tree.sourceSetupStatus ?? tree.status,
      tree.sourceSetupStatusReason,
      tree.sourceSetupStatusActionTarget
    ),
    createSection(
      PROGRAM_SEQUENCE_SECTION_KEY,
      'Program Sequence',
      tree.operations,
      1,
      tree.programStatus ?? tree.status,
      tree.programStatusReason,
      tree.programStatusActionTarget
    )
  ];
}

function createSection(
  key: string,
  label: string,
  nodes: readonly UpidProgramTreeNode[],
  level: number,
  status: UpidProgramTreeStatus,
  statusReason?: string,
  statusActionTarget?: UpidProgramTreeEditTarget
): EditorProgramTreeItem {
  return {
    children: nodes.map((node) => createNodeItem(node, level + 1, key)),
    key,
    label,
    level,
    status,
    statusReason,
    statusActionTarget
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
    statusReason: node.statusReason,
    statusActionTarget: node.statusActionTarget
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

function readOperationOrdinal(label: string) {
  return /^(\d+)\s*·/.exec(label)?.[1] ?? null;
}

function readItemKeyboardShortcuts(
  item: EditorProgramTreeItem,
  statusActionTarget: UpidProgramTreeEditTarget | undefined
) {
  const shortcuts = [
    item.node?.sequenceEditTarget ? 'Alt+Enter' : null,
    statusActionTarget ? 'Control+Enter' : null
  ].filter((shortcut): shortcut is string => shortcut !== null);
  return shortcuts.length > 0 ? shortcuts.join(' ') : undefined;
}

function stripOperationOrdinal(label: string) {
  return label.replace(/^\d+\s*·\s*/, '');
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

function isActionableStatus(status: UpidProgramTreeStatus) {
  return status === 'blocked' || status === 'review-required';
}
