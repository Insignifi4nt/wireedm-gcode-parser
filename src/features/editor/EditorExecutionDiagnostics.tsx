import { Button } from '@/components/ui/button';
import type { UpidEditorDiagnosticNode } from '@/domain/upid/upidEditorTree';

import { resolveEditorProgramTreeAction } from './editorProgramTreeActions';

export function EditorExecutionDiagnostics({ diagnostics, onResolve }: {
  readonly diagnostics: readonly UpidEditorDiagnosticNode[];
  readonly onResolve: (node: UpidEditorDiagnosticNode, treeKey: string) => void;
}) {
  if (diagnostics.length === 0) return null;
  return (
    <section className="mb-3 grid gap-2 border-b border-border pb-3" aria-label="Execution issues">
      <h3 className="text-[10px] uppercase text-amber-200">Execution needs review</h3>
      {diagnostics.map((node) => (
        <div className="grid gap-1 text-[11px]" key={node.treeKey}>
          <p>{node.label}</p>
          {resolveEditorProgramTreeAction(node).commandId !== 'view.diagnostics' && (
            <Button variant="outline" size="md" className="px-2 text-left" onClick={() => onResolve(node, node.treeKey)} type="button">
              Review {node.operationId ? 'contour setup' : 'program setup'}
            </Button>
          )}
        </div>
      ))}
    </section>
  );
}
