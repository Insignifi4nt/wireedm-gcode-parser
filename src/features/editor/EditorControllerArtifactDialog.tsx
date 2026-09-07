import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import type { MachineDefinition } from '@/domain/machine-definition/machineDefinition';
import type { PostLibrary } from '@/domain/post-processor/postLibrary';
import type {
  ControllerArtifactResult,
  ControllerProgramArtifact
} from '@/domain/wire-edm-job/controllerArtifact';

export interface ControllerArtifactSelection {
  readonly machineId: string;
}

export interface EditorControllerArtifactDialogProps {
  readonly defaultMachineId: string | null;
  readonly hasUnsavedChanges: boolean;
  readonly machines: readonly MachineDefinition[];
  readonly posts: PostLibrary;
  readonly onClose: () => void;
  readonly onDownload: (fileName: string, text: string) => void;
  readonly onGenerateControllerArtifact: (
    selection: ControllerArtifactSelection
  ) => Promise<ControllerArtifactResult>;
}

export function EditorControllerArtifactDialog({
  defaultMachineId,
  hasUnsavedChanges,
  machines,
  posts,
  onClose,
  onDownload,
  onGenerateControllerArtifact
}: EditorControllerArtifactDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    dialogRef.current?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  const [machineId, setMachineId] = useState(() => (
    defaultMachineId && machines.some(({ id }) => id === defaultMachineId)
      ? defaultMachineId
      : ''
  ));
  const [artifact, setArtifact] = useState<ControllerProgramArtifact | null>(null);
  const [failure, setFailure] = useState<Extract<ControllerArtifactResult, { ok: false }>['error'] | null>(null);
  const [generating, setGenerating] = useState(false);
  const selectedMachine = machines.find((machine) => machine.id === machineId) ?? null;
  const activeSetup = selectedMachine?.bindings.find(({ id }) => id === selectedMachine.activeBindingId) ?? null;
  const activePost = activeSetup
    ? posts.installations.find(({ ref }) => (
        ref.packageId === activeSetup.post.packageId &&
        ref.version === activeSetup.post.version &&
        ref.contentHash === activeSetup.post.contentHash
      )) ?? null
    : null;
  const canGenerate = !hasUnsavedChanges && activePost !== null && !generating;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Editor shortcuts must not change the revision behind this modal.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!generating) onClose();
    }
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>(':is(button, select):not(:disabled)')];
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) {
      event.preventDefault();
      event.currentTarget.focus();
    } else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) {
      event.preventDefault();
      first.focus();
    }
  }

  async function generate() {
    if (!canGenerate) return;
    setGenerating(true);
    setArtifact(null);
    setFailure(null);
    try {
      const result = await onGenerateControllerArtifact({ machineId });
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
    <div aria-label="Controller artifact export" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4 outline-none" onKeyDown={handleKeyDown} ref={dialogRef} role="dialog" tabIndex={-1}>
      <section className="grid max-h-[90vh] w-full max-w-3xl gap-3 overflow-auto border border-border bg-card p-3 text-[11px] shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-border pb-2">
          <div>
            <h2 className="text-sm font-semibold">Controller artifact</h2>
            <p className="text-muted-foreground">Generate from the exact saved project revision and the machine&apos;s active setup.</p>
          </div>
          <button aria-label="Close controller artifact export" className="h-7 border border-border px-2 disabled:opacity-40" disabled={generating} onClick={onClose} type="button">Close</button>
        </header>

        {hasUnsavedChanges && (
          <p className="border border-amber-500/50 bg-amber-500/10 p-2 text-amber-200">
            Save the project before generating a controller artifact. Draft geometry is never posted.
          </p>
        )}

        <label className="grid gap-1 uppercase text-muted-foreground">
          Physical machine
          <select
            aria-label="Controller export machine"
            className="h-8 border border-border bg-background px-2 text-foreground"
            disabled={generating}
            onChange={(event) => {
              setMachineId(event.currentTarget.value);
              setArtifact(null);
              setFailure(null);
            }}
            value={machineId}
          >
            <option value="">Select a machine</option>
            {machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.name}</option>)}
          </select>
        </label>

        {selectedMachine && !activeSetup && (
          <p className="border border-amber-500/50 bg-amber-500/10 p-2 text-amber-200">
            This machine has no active setup. Choose one in Workbench Settings.
          </p>
        )}
        {activeSetup && activePost && (
          <div className="technical-value grid gap-1 border-y border-border py-2 text-muted-foreground">
            <span>Setup: <strong className="text-foreground">{activeSetup.name}</strong></span>
            <span>Post: {activePost.package.manifest.name} {activePost.ref.version}</span>
            <span>Output: {outputSummary(activePost.package.manifest.output)}</span>
          </div>
        )}

        <button className="h-8 border border-primary bg-primary px-3 text-primary-foreground disabled:opacity-40" disabled={!canGenerate} onClick={() => void generate()} type="button">
          {generating ? 'Generating…' : 'Generate controller artifact'}
        </button>

        {failure && (
          <div className="border border-destructive/60 bg-destructive/10 p-2 text-destructive" role="alert">
            <div className="font-mono font-semibold">{failure.code}</div>
            <p>{failure.message}</p>
            {failure.code === 'CONTROLLER_ARTIFACT_POST_FAILED' && failure.diagnostics.length > 0 && (
              <ul className="mt-2 grid gap-1 border-t border-destructive/30 pt-2" data-controller-artifact-diagnostics>
                {failure.diagnostics.map((diagnostic, index) => (
                  <li className="grid gap-0.5" key={`${diagnostic.code}-${diagnostic.eventId ?? 'no-event'}-${index}`}>
                    <span className="font-mono font-semibold">{diagnostic.code}</span>
                    <span>{diagnostic.message}</span>
                    {(diagnostic.eventId || diagnostic.commandId) && (
                      <span className="font-mono text-[10px] opacity-80">
                        {diagnosticContext(diagnostic.eventId, diagnostic.commandId)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {failure.code === 'CONTROLLER_ARTIFACT_EXECUTION_PLAN_INVALID' && failure.diagnostics.length > 0 && (
              <ul className="mt-2 grid gap-1 border-t border-destructive/30 pt-2" data-controller-artifact-diagnostics>
                {failure.diagnostics.map((diagnostic, index) => (
                  <li className="grid gap-0.5" key={`${diagnostic.code}-${diagnostic.operationId ?? 'no-operation'}-${index}`}>
                    <span className="font-mono font-semibold">{diagnostic.code}</span>
                    <span>{diagnostic.message}</span>
                    {diagnostic.operationId && (
                      <span className="font-mono text-[10px] opacity-80">Operation {diagnostic.operationId}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {artifact && (
          <section className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono">{artifact.fileName}</span>
              <button className="h-7 border border-border px-2" onClick={() => onDownload(artifact.fileName, artifact.text)} type="button">Download {artifact.fileName}</button>
            </div>
            <pre className="max-h-[50vh] overflow-auto whitespace-pre border border-border bg-background p-2 font-mono text-[10px]">{artifact.text}</pre>
          </section>
        )}
      </section>
    </div>
  );
}

function diagnosticContext(eventId: string | null, commandId: string | null) {
  const parts: string[] = [];
  if (eventId) parts.push(`Event ${eventId}`);
  if (commandId) parts.push(`Command ${commandId}`);
  return parts.join(' · ');
}

function outputSummary(output: PostLibrary['installations'][number]['package']['manifest']['output']) {
  const numbering = output.blockNumbering.mode === 'sequential'
    ? `${output.blockNumbering.prefix}${output.blockNumbering.start} numbering`
    : 'no numbering';
  const markers = output.programEnvelope.prefix.length + output.programEnvelope.suffix.length > 0
    ? 'program markers'
    : 'no program markers';
  return `.${output.fileExtension} · ${output.lineEnding.toUpperCase()} · ${output.encoding.toUpperCase()} · ${numbering} · ${markers}`;
}
