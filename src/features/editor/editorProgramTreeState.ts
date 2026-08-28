import type { UpidEditorTree } from '@/domain/upid/upidEditorTree';

const SOURCE_SECTION = 'section:source';
const PROGRAM_SECTION = 'section:program';

export function defaultEditorProgramTreeExpansion(tree: UpidEditorTree): ReadonlySet<string> {
  return tree.operations.length === 0
    ? new Set([SOURCE_SECTION])
    : new Set([PROGRAM_SECTION, tree.operations[0].treeKey]);
}

export function revealEditorProgramTreeNode(
  tree: UpidEditorTree,
  expanded: ReadonlySet<string>,
  treeKey: string
): ReadonlySet<string> {
  const next = new Set(expanded);
  if (tree.sourceSetup.some((node) => node.treeKey === treeKey)) next.add(SOURCE_SECTION);
  const operation = tree.operations.find(
    (node) => node.treeKey === treeKey || node.children.some((child) => child.treeKey === treeKey)
  );
  if (operation) {
    next.add(PROGRAM_SECTION);
    next.add(operation.treeKey);
  }
  const isProgramNode = tree.status === 'ready'
    ? tree.programEvents.some((node) => node.treeKey === treeKey)
    : tree.diagnostics.some((node) => node.treeKey === treeKey);
  if (isProgramNode) next.add(PROGRAM_SECTION);
  return next;
}

export function pruneEditorProgramTreeExpansion(
  expanded: ReadonlySet<string>,
  tree: UpidEditorTree
): ReadonlySet<string> {
  const valid = new Set([SOURCE_SECTION, PROGRAM_SECTION, ...tree.operations.map(({ treeKey }) => treeKey)]);
  return new Set([...expanded].filter((key) => valid.has(key)));
}
