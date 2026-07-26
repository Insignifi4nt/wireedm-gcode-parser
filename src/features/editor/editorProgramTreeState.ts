import type { UpidProgramTree, UpidProgramTreeNode } from '@/domain/upid/upidProgramTree';

const SOURCE_SETUP_SECTION_KEY = 'section:source';
const PROGRAM_SEQUENCE_SECTION_KEY = 'section:program';

export function defaultEditorProgramTreeExpansion(tree: UpidProgramTree): ReadonlySet<string> {
  if (tree.operations.length === 0) return new Set([SOURCE_SETUP_SECTION_KEY]);

  const expanded = new Set([PROGRAM_SEQUENCE_SECTION_KEY]);
  expanded.add(tree.operations[0].treeKey);

  return expanded;
}

export function revealEditorProgramTreeNode(
  tree: UpidProgramTree,
  expanded: ReadonlySet<string>,
  treeKey: string
): ReadonlySet<string> {
  const path = findTreePath(tree, treeKey);
  if (!path) return expanded;

  const next = new Set(expanded);
  for (const key of path) next.add(key);
  return next;
}

export function pruneEditorProgramTreeExpansion(
  expanded: ReadonlySet<string>,
  tree: UpidProgramTree
): ReadonlySet<string> {
  const validKeys = new Set<string>([SOURCE_SETUP_SECTION_KEY, PROGRAM_SEQUENCE_SECTION_KEY]);
  addNodeKeys(validKeys, tree.sourceSetup);
  addNodeKeys(validKeys, tree.operations);

  return new Set([...expanded].filter((key) => validKeys.has(key)));
}

function findTreePath(tree: UpidProgramTree, treeKey: string): string[] | null {
  if (treeKey === SOURCE_SETUP_SECTION_KEY || treeKey === PROGRAM_SEQUENCE_SECTION_KEY) {
    return [treeKey];
  }

  return findNodePath(tree.sourceSetup, treeKey, [SOURCE_SETUP_SECTION_KEY])
    ?? findNodePath(tree.operations, treeKey, [PROGRAM_SEQUENCE_SECTION_KEY]);
}

function findNodePath(
  nodes: readonly UpidProgramTreeNode[],
  treeKey: string,
  parentPath: readonly string[]
): string[] | null {
  for (const node of nodes) {
    const path = [...parentPath, node.treeKey];
    if (node.treeKey === treeKey) return path;

    const childPath = findNodePath(node.children, treeKey, path);
    if (childPath) return childPath;
  }

  return null;
}

function addNodeKeys(keys: Set<string>, nodes: readonly UpidProgramTreeNode[]) {
  for (const node of nodes) {
    keys.add(node.treeKey);
    addNodeKeys(keys, node.children);
  }
}
