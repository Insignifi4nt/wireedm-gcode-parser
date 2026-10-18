import { Button } from '@/components/ui/button';
import type { UpidEditorDiagnosticNode, UpidEditorTree } from '@/domain/upid/upidEditorTree';

import { editorExecutionDiagnosticReviewLabel } from './editorProgramTreeActions';

export function EditorExecutionDiagnostics({ diagnostics, operations, onResolve }: {
  readonly diagnostics: readonly UpidEditorDiagnosticNode[];
  readonly operations: readonly Pick<UpidEditorTree['operations'][number], 'operationId' | 'label'>[];
  readonly onResolve: (node: UpidEditorDiagnosticNode, treeKey: string) => void;
}) {
  if (diagnostics.length === 0) return null;
  return (
    <section className="mb-3 grid gap-2 border-b border-border pb-3" aria-label="Execution issues">
      <h3 className="text-[10px] text-amber-200">Execution needs review</h3>
      {diagnostics.map((node) => {
        const operationIndex = node.operationId === null ? -1
          : operations.findIndex((operation) => operation.operationId === node.operationId);
        const operation = operations[operationIndex];
        const context = operation
          ? `Contour ${String(operationIndex + 1).padStart(2, '0')} · ${operation.label}`
          : node.operationId === null ? 'Program setup' : `Contour ${node.operationId}`;
        const reviewLabel = editorExecutionDiagnosticReviewLabel(node);
        return (
          <div className="grid gap-1 border border-amber-400/25 bg-amber-400/5 p-2 text-[11px]"
            data-editor-execution-diagnostic={node.diagnostic.code} key={node.treeKey}>
            <p className="text-[10px] text-muted-foreground" data-editor-execution-diagnostic-context>{context}</p>
            <p>{node.label}</p>
            {reviewLabel && (
              <Button aria-label={`${reviewLabel} for ${context}`} variant="outline" size="md" className="px-2 text-left"
                onClick={() => onResolve(node, node.treeKey)} type="button">
                {reviewLabel}
              </Button>
            )}
          </div>
        );
      })}
    </section>
  );
}
