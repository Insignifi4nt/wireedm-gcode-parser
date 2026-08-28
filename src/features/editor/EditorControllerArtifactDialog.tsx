import { useState } from 'react';

import type { MachineDefinition } from '@/domain/machine-definition/machineDefinition';
import type { WorkbenchCatalogManifest } from '@/domain/workbench-catalog/workbenchCatalog';
import type {
  ControllerArtifactResult,
  ControllerProgramArtifact
} from '@/domain/wire-edm-job/controllerArtifact';

export interface ControllerArtifactSelection {
  readonly machineId: string;
  readonly bindingId: string;
}

export interface EditorControllerArtifactDialogProps {
  readonly exportPreference: WorkbenchCatalogManifest['preferences']['export'];
  readonly hasUnsavedChanges: boolean;
  readonly machines: readonly MachineDefinition[];
  readonly onClose: () => void;
  readonly onDownload: (fileName: string, text: string) => void;
  readonly onGenerateControllerArtifact: (
    selection: ControllerArtifactSelection
  ) => Promise<ControllerArtifactResult>;
}

export function EditorControllerArtifactDialog({
  exportPreference,
  hasUnsavedChanges,
  machines,
  onClose,
  onDownload,
  onGenerateControllerArtifact
}: EditorControllerArtifactDialogProps) {
  const [machineId, setMachineId] = useState('');
  const [bindingId, setBindingId] = useState('');
  const [artifact, setArtifact] = useState<ControllerProgramArtifact | null>(null);
  const [failure, setFailure] = useState<Extract<ControllerArtifactResult, { ok: false }>['error'] | null>(null);
  const [generating, setGenerating] = useState(false);
  const selectedMachine = machines.find((machine) => machine.id === machineId) ?? null;
  const configured = exportPreference.status === 'configured';
  const canGenerate = configured && !hasUnsavedChanges && machineId !== '' && bindingId !== '' && !generating;

  async function generate() {
    if (!canGenerate) return;
    setGenerating(true);
    setArtifact(null);
    setFailure(null);
    try {
      const result = await onGenerateControllerArtifact({ machineId, bindingId });
      if (result.ok) setArtifact(result.artifact);
      else setFailure(result.error);
    } catch (error) {
      setFailure({
        code: 'CONTROLLER_ARTIFACT_POST_FAILED',
        message: error instanceof Error ? error.message : String(error),
        diagnostics: []
      });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div
      aria-label="Controller artifact export"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4"
      role="dialog"
    >
      <section className="grid max-h-[90vh] w-full max-w-3xl gap-3 overflow-auto border border-border bg-card p-3 text-[11px] shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-border pb-2">
          <div>
            <h2 className="text-sm font-semibold">Controller artifact</h2>
            <p className="text-muted-foreground">Generate from the exact saved project revision and selected machine binding.</p>
          </div>
          <button aria-label="Close controller artifact export" className="h-7 border border-border px-2" onClick={onClose} type="button">
            Close
          </button>
        </header>

        {!configured && (
          <p className="border border-amber-500/50 bg-amber-500/10 p-2 text-amber-200">
            Configure the controller artifact extension and line endings in Workbench Settings before generating.
          </p>
        )}
        {hasUnsavedChanges && (
          <p className="border border-amber-500/50 bg-amber-500/10 p-2 text-amber-200">
            Save the project before generating a controller artifact. Draft geometry is never posted.
          </p>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1 uppercase text-muted-foreground">
            Physical machine
            <select
              aria-label="Controller export machine"
              className="h-8 border border-border bg-background px-2 text-foreground"
              onChange={(event) => {
                setMachineId(event.currentTarget.value);
                setBindingId('');
                setArtifact(null);
                setFailure(null);
              }}
              value={machineId}
            >
              <option value="">Select a machine</option>
              {machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 uppercase text-muted-foreground">
            Exact post binding
            <select
              aria-label="Controller export binding"
              className="h-8 border border-border bg-background px-2 text-foreground"
              disabled={!selectedMachine}
              onChange={(event) => {
                setBindingId(event.currentTarget.value);
                setArtifact(null);
                setFailure(null);
              }}
              value={bindingId}
            >
              <option value="">Select a binding</option>
              {selectedMachine?.bindings.map((binding) => (
                <option key={binding.id} value={binding.id}>{binding.name}</option>
              ))}
            </select>
          </label>
        </div>

        {configured && (
          <p className="text-muted-foreground">
            Output: .{exportPreference.fileExtension.extension} · {exportPreference.lineEnding.toUpperCase()} line endings
          </p>
        )}

        <button
          className="h-8 border border-primary bg-primary px-3 text-primary-foreground disabled:opacity-40"
          disabled={!canGenerate}
          onClick={() => void generate()}
          type="button"
        >
          {generating ? 'Generating…' : 'Generate controller artifact'}
        </button>

        {failure && (
          <div className="border border-destructive/60 bg-destructive/10 p-2 text-destructive" role="alert">
            <div className="font-mono font-semibold">{failure.code}</div>
            <p>{failure.message}</p>
          </div>
        )}

        {artifact && (
          <section className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono">{artifact.fileName}</span>
              <button
                className="h-7 border border-border px-2"
                onClick={() => onDownload(artifact.fileName, artifact.text)}
                type="button"
              >
                Download {artifact.fileName}
              </button>
            </div>
            <pre className="max-h-[50vh] overflow-auto whitespace-pre border border-border bg-background p-2 font-mono text-[10px]">{artifact.text}</pre>
          </section>
        )}
      </section>
    </div>
  );
}
