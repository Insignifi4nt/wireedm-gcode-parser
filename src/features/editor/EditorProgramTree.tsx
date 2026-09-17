import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import type {
  UpidEditorDiagnosticNode,
  UpidEditorEventNode,
  UpidEditorSourceNode,
  UpidEditorTree
} from '@/domain/upid/upidEditorTree';

import { pruneEditorProgramTreeExpansion, revealEditorProgramTreeNode } from './editorProgramTreeState';

export type EditorProgramTreeNode = UpidEditorSourceNode | UpidEditorTree['operations'][number] |
  UpidEditorEventNode | UpidEditorDiagnosticNode;

export interface EditorProgramTreeProps {
  readonly tree: UpidEditorTree;
  readonly selectedTreeKey: string | null;
  readonly expandedTreeKeys: ReadonlySet<string>;
  readonly onExpandedTreeKeysChange: (keys: ReadonlySet<string>) => void;
  readonly onSelect: (treeKey: string, node: EditorProgramTreeNode | null) => void;
  readonly onEdit: (node: EditorProgramTreeNode, treeKey: string) => void;
}

interface TreeItem {
  readonly children: readonly TreeItem[];
  readonly key: string;
  readonly label: string;
  readonly level: number;
  readonly node?: EditorProgramTreeNode;
  readonly parentKey?: string;
  readonly status: 'ready' | 'inactive' | 'invalid' | 'unresolved';
}

const SOURCE_SECTION = 'section:source';
const PROGRAM_SECTION = 'section:program';

export function EditorProgramTree(props: EditorProgramTreeProps) {
  const { tree, selectedTreeKey, expandedTreeKeys, onExpandedTreeKeysChange, onSelect, onEdit } = props;
  const items = useMemo(() => buildItems(tree), [tree]);
  const visibleItems = useMemo(() => flattenVisible(items, expandedTreeKeys), [expandedTreeKeys, items]);
  const refs = useRef(new Map<string, HTMLLIElement>());
  const [focusedKey, setFocusedKey] = useState(SOURCE_SECTION);
  const revealedSelection = useRef<string | null>(null);

  useEffect(() => {
    const pruned = pruneEditorProgramTreeExpansion(expandedTreeKeys, tree);
    const revealed = selectedTreeKey && selectedTreeKey !== revealedSelection.current
      ? revealEditorProgramTreeNode(tree, pruned, selectedTreeKey) : pruned;
    revealedSelection.current = selectedTreeKey;
    if (!sameSet(revealed, expandedTreeKeys)) onExpandedTreeKeysChange(revealed);
  }, [expandedTreeKeys, onExpandedTreeKeysChange, selectedTreeKey, tree]);

  useEffect(() => {
    if (!visibleItems.some(({ key }) => key === focusedKey)) setFocusedKey(visibleItems[0]?.key ?? '');
  }, [focusedKey, visibleItems]);

  function setExpanded(item: TreeItem, expanded: boolean) {
    focus(item);
    const next = new Set(expandedTreeKeys);
    if (expanded) next.add(item.key);
    else next.delete(item.key);
    onExpandedTreeKeysChange(next);
  }

  function focus(item: TreeItem) {
    setFocusedKey(item.key);
    refs.current.get(item.key)?.focus();
  }

  function select(item: TreeItem) {
    focus(item);
    onSelect(item.key, item.node ?? null);
  }

  function activate(item: TreeItem) {
    if (item.node) onEdit(item.node, item.key);
    else select(item);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLLIElement>, item: TreeItem) {
    if (event.target !== event.currentTarget) return;
    const index = visibleItems.findIndex(({ key }) => key === item.key);
    const hasChildren = item.children.length > 0;
    const expanded = expandedTreeKeys.has(item.key);
    if (event.key === 'ArrowDown' && index < visibleItems.length - 1) {
      event.preventDefault(); focus(visibleItems[index + 1]);
    } else if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault(); focus(visibleItems[index - 1]);
    } else if (event.key === 'ArrowRight' && hasChildren) {
      event.preventDefault(); expanded ? focus(item.children[0]) : setExpanded(item, true);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (hasChildren && expanded) setExpanded(item, false);
      else if (item.parentKey) {
        const parent = visibleItems.find(({ key }) => key === item.parentKey);
        if (parent) focus(parent);
      }
    } else if (event.key === 'Home' && visibleItems[0]) {
      event.preventDefault(); focus(visibleItems[0]);
    } else if (event.key === 'End' && visibleItems.at(-1)) {
      event.preventDefault(); focus(visibleItems.at(-1)!);
    } else if (event.key === 'Enter') {
      event.preventDefault(); activate(item);
    } else if (event.key === ' ') {
      event.preventDefault(); select(item);
    }
  }

  function renderItem(item: TreeItem) {
    const expanded = expandedTreeKeys.has(item.key);
    const selected = selectedTreeKey === item.key;
    return (
      <li aria-expanded={item.children.length > 0 ? expanded : undefined} aria-level={item.level}
        aria-selected={selected} className="outline-none" data-tree-key={item.key} key={item.key}
        onKeyDown={(event) => handleKeyDown(event, item)} ref={(element) => {
          if (element) refs.current.set(item.key, element); else refs.current.delete(item.key);
        }} role="treeitem" tabIndex={focusedKey === item.key ? 0 : -1}>
        <div className={`flex h-7 min-w-0 items-center gap-1 px-1.5 ${selected ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50'}`}
          onClick={() => select(item)} onDoubleClick={() => activate(item)}
          style={{ paddingLeft: `${(item.level - 1) * 12 + 6}px` }}>
          {item.children.length > 0 ? (
            <button aria-label={`${expanded ? 'Collapse' : 'Expand'} ${item.label}`} className="size-4 shrink-0"
              onClick={(event) => { event.stopPropagation(); setExpanded(item, !expanded); }} tabIndex={-1} type="button">
              {expanded ? '−' : '+'}
            </button>
          ) : <span className="w-4 shrink-0" />}
          <StatusDot status={item.status} />
          <span className={`truncate ${item.node?.kind === 'event' && item.node.spatialAction?.pause === 'generated-manual-thread' ? 'text-rose-300' : item.node?.kind === 'event' && item.node.spatialAction?.pause === 'authored' ? 'text-amber-300' : ''}`} title={item.node?.kind === 'event' ? item.node.spatialAction?.detail ?? item.label : item.label}>{item.label}</span>
        </div>
        {selected && item.node?.kind === 'event' && item.node.spatialAction?.pause &&
          <div className="border-b border-border/40 bg-accent/40 py-1 pr-2 text-[10px] text-muted-foreground"
            style={{ paddingLeft: `${(item.level - 1) * 12 + 28}px` }}
            data-program-action-detail={item.node.spatialAction.key}>
            {item.node.spatialAction.detail}
          </div>}
        {expanded && item.children.length > 0 && <ul role="group">{item.children.map(renderItem)}</ul>}
      </li>
    );
  }

  return <div className="h-full overflow-auto py-1" data-editor-program-tree>
    <ul aria-label="UPID execution plan" role="tree">{items.map(renderItem)}</ul>
  </div>;
}

function buildItems(tree: UpidEditorTree): readonly TreeItem[] {
  const operationChildKeys = new Set(tree.operations.flatMap((node) => node.children.map((child) => child.treeKey)));
  const programChildren: EditorProgramTreeNode[] = tree.status === 'ready'
    ? [
        ...tree.programEvents.filter((node) => node.eventKind !== 'program-end'),
        ...tree.operations,
        ...tree.programEvents.filter((node) => node.eventKind === 'program-end')
      ]
    : [
        ...tree.diagnostics.filter((node) => !operationChildKeys.has(node.treeKey)),
        ...tree.operations
      ];
  return [
    section(SOURCE_SECTION, 'Source & Setup', tree.sourceSetup, tree.status),
    section(PROGRAM_SECTION, 'Execution Plan', programChildren, tree.status)
  ];
}

function section(key: string, label: string, nodes: readonly EditorProgramTreeNode[], status: UpidEditorTree['status']): TreeItem {
  return { children: nodes.map((node) => nodeItem(node, 2, key)), key, label, level: 1, status };
}

function nodeItem(node: EditorProgramTreeNode, level: number, parentKey: string): TreeItem {
  const children = node.kind === 'operation' ? node.children : [];
  const status = node.kind === 'operation' && node.execution !== 'included'
    ? node.execution : node.kind === 'diagnostic' ? 'unresolved' : 'ready';
  return {
    children: children.map((child) => nodeItem(child, level + 1, node.treeKey)),
    key: node.treeKey,
    label: node.kind === 'source' ? `${node.label} · ${node.detail}`
      : node.kind === 'event' ? eventLabel(node) : node.label,
    level, node, parentKey, status
  };
}

const EVENT_LABELS: Record<UpidEditorEventNode['eventKind'], string> = {
  'program-start': 'Program start',
  'operation-start': 'Begin operation',
  'pass-start': 'Begin pass',
  'wire-continue': 'Keep wire threaded',
  'wire-separate': 'Separate wire',
  'wire-thread': 'Thread wire',
  position: 'Position wire',
  'compensation-start': 'Enable compensation',
  motion: 'Cut contour',
  'program-stop': 'Stop program',
  'compensation-end': 'Cancel compensation',
  'pass-end': 'End pass',
  'operation-end': 'End operation',
  'program-end': 'Program end'
};

function eventLabel(node: UpidEditorEventNode) {
  if (node.spatialAction?.pause) return node.spatialAction.label;
  const transition = node.sourceTrace.find((trace) => trace.kind === 'transition');
  if (node.eventKind === 'motion' && transition?.kind === 'transition') {
    if (transition.role === 'entry') return 'Cut entry';
    if (transition.role === 'exit') return 'Cut exit';
  }
  return EVENT_LABELS[node.eventKind];
}

function StatusDot({ status }: { status: TreeItem['status'] }) {
  const color = { ready: 'bg-emerald-500', inactive: 'bg-muted-foreground', invalid: 'bg-red-500', unresolved: 'bg-amber-400' }[status];
  return <span aria-label={status} className={`size-1.5 shrink-0 rounded-full ${color}`} role="img" />;
}

function flattenVisible(items: readonly TreeItem[], expanded: ReadonlySet<string>): TreeItem[] {
  return items.flatMap((item) => [item, ...(expanded.has(item.key) ? flattenVisible(item.children, expanded) : [])]);
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  return left.size === right.size && [...left].every((key) => right.has(key));
}
