import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Check, Trash2, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type {
  MachinePackageInstallationResolution,
  PreparedMachinePackageInstallation,
  PrepareStoredMachinePackageInstallationResult
} from '@/domain/machine-package';
import type {
  ConnectedWorkbenchCatalog,
  WorkbenchCatalogManifest
} from '@/domain/workbench-catalog/workbenchCatalog';

export interface MachinePostSettingsActions {
  readonly onActivateMachineSetup: (machineId: string, setupId: string) => void | Promise<void | boolean>;
  readonly onCommitMachinePackage: (
    prepared: PreparedMachinePackageInstallation,
    resolution: MachinePackageInstallationResolution
  ) => Promise<boolean>;
  readonly onPrepareMachinePackage: (file: File) => Promise<PrepareStoredMachinePackageInstallationResult>;
  readonly onRemoveMachineDefinition: (machineId: string) => void | Promise<void>;
  readonly onSaveCatalogPreferences: (
    preferences: WorkbenchCatalogManifest['preferences']
  ) => void | Promise<void>;
}

interface MachinePostSettingsPanelProps extends MachinePostSettingsActions {
  readonly connectedWorkbench: ConnectedWorkbenchCatalog;
  readonly interactionLocked: boolean;
  readonly settingsErrorMessage: string | null;
  readonly settingsStatus: 'idle' | 'saving' | 'saved' | 'error';
}

type PreferenceDraft = {
  importMode: 'ask' | 'fixed';
  importUnit: '' | 'millimeters' | 'inches';
  planningMachineId: string;
};

export function MachinePostSettingsPanel({
  connectedWorkbench,
  interactionLocked,
  onActivateMachineSetup,
  onCommitMachinePackage,
  onPrepareMachinePackage,
  onRemoveMachineDefinition,
  onSaveCatalogPreferences,
  settingsErrorMessage,
  settingsStatus
}: MachinePostSettingsPanelProps) {
  const [preferences, setPreferences] = useState(() => preferenceDraft(connectedWorkbench));
  const [prepared, setPrepared] = useState<PreparedMachinePackageInstallation | null>(null);
  const previewRequest = useRef(0);
  const [localError, setLocalError] = useState<string | null>(null);
  const disabled = interactionLocked || settingsStatus === 'saving';

  useEffect(() => {
    setPreferences(preferenceDraft(connectedWorkbench));
  }, [connectedWorkbench]);

  useEffect(() => {
    setPrepared(null);
    return () => { previewRequest.current += 1; };
  }, [connectedWorkbench.adapter, connectedWorkbench.machines, connectedWorkbench.posts]);

  async function handlePreferenceSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = preferencesFromDraft(preferences);
    if (!parsed.ok) {
      setLocalError(parsed.message);
      return;
    }
    setLocalError(null);
    await onSaveCatalogPreferences(parsed.preferences);
  }

  async function handlePackageFile(file: File) {
    setLocalError(null);
    setPrepared(null);
    const request = ++previewRequest.current;
    const result = await onPrepareMachinePackage(file);
    if (request !== previewRequest.current) return;
    if (result.ok) setPrepared(result.prepared);
    else setLocalError(result.error.message);
  }

  function rejectPackageFile(message: string) {
    previewRequest.current += 1;
    setPrepared(null);
    setLocalError(message);
  }

  async function commit(resolution: MachinePackageInstallationResolution) {
    if (!prepared || prepared.workbench.adapter !== connectedWorkbench.adapter) return;
    const installed = await onCommitMachinePackage(prepared, resolution);
    if (installed) setPrepared(null);
  }

  return (
    <div className="grid gap-6">
      <section className="grid gap-3 border-b border-border pb-6">
        <SectionTitle title="Install a machine package" />
        <p className="text-[10px] text-muted-foreground">
          A .wireedm-package contains one complete machine, its tested post processors, controller-file rules, setups, and evidence. Nothing else needs to be configured after installation.
        </p>
        <FileButton disabled={disabled} onFile={handlePackageFile} onReject={rejectPackageFile} />
        {prepared && (
          <PackagePreview disabled={disabled} onCommit={commit} prepared={prepared} />
        )}
      </section>

      <section className="grid gap-3 border-b border-border pb-6">
        <SectionTitle title="Installed machines" />
        {connectedWorkbench.machines.machines.length === 0 && (
          <p className="border border-dashed border-border p-3 text-[10px] text-muted-foreground">No machines installed.</p>
        )}
        {connectedWorkbench.machines.machines.map((machine) => {
          const activeSetup = machine.bindings.find(({ id }) => id === machine.activeBindingId) ?? null;
          return (
            <article className="grid gap-3 border border-border bg-background/40 p-3 text-[10px]" key={machine.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-xs font-semibold text-foreground">{machine.name}</h4>
                  <p className="text-muted-foreground">{machine.identity.manufacturer} {machine.identity.model} · {machine.identity.controller.manufacturer} {machine.identity.controller.model}</p>
                </div>
                <Button aria-label={`Remove ${machine.name}`} disabled={disabled} onClick={() => onRemoveMachineDefinition(machine.id)} size="icon" type="button" variant="ghost"><Trash2 /></Button>
              </div>
              <div className="grid gap-2">
                {machine.bindings.map((setup) => {
                  const post = connectedWorkbench.posts.installations.find(({ ref }) => (
                    ref.packageId === setup.post.packageId &&
                    ref.version === setup.post.version &&
                    ref.contentHash === setup.post.contentHash
                  ));
                  const active = setup.id === machine.activeBindingId;
                  const output = post?.package.manifest.output;
                  return (
                    <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border p-2 ${active ? 'border-primary/50 bg-primary/5' : 'border-border'}`} key={setup.id}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-foreground">{active && <Check className="size-3" />}{setup.name}</div>
                        <div className="truncate text-muted-foreground">
                          {post?.package.manifest.name ?? setup.post.packageId} {setup.post.version}
                          {post ? ` · ${setup.post.contentHash.slice(0, 12)}…` : ' · unavailable'}
                        </div>
                        {output && <div className="text-muted-foreground">{outputSummary(output)}</div>}
                        <div className="text-muted-foreground">
                          Post package {post ? 'installed with exact content' : 'unavailable'} · {setup.verification.status === 'claimed' ? 'verification claimed' : 'unverified setup'} · {postEvidenceSummary(post?.package.evidence ?? [])} · {machine.evidence.length} machine evidence file{machine.evidence.length === 1 ? '' : 's'}
                        </div>
                      </div>
                      {!active && <Button disabled={disabled} onClick={() => onActivateMachineSetup(machine.id, setup.id)} size="sm" type="button" variant="outline">Use setup</Button>}
                    </div>
                  );
                })}
                {!activeSetup && machine.bindings.length > 0 && <p className="text-amber-200">Choose an active setup before exporting controller code.</p>}
              </div>
            </article>
          );
        })}
      </section>

      <form className="grid gap-3" onSubmit={handlePreferenceSubmit}>
        <SectionTitle title="Workbench preferences" />
        <p className="text-[10px] text-muted-foreground">Only session-level choices live here. Export formatting is owned by each installed post processor.</p>
        <div className="grid grid-cols-2 gap-3 max-[720px]:grid-cols-1">
          <Select label="DXF import units" disabled={disabled} value={preferences.importMode} onChange={(importMode) => setPreferences((draft) => ({ ...draft, importMode }))} options={[["ask", "Ask for every import"], ["fixed", "Use an explicit unit"]]} />
          <Select label="Fixed import unit" disabled={disabled || preferences.importMode !== 'fixed'} value={preferences.importUnit} onChange={(importUnit) => setPreferences((draft) => ({ ...draft, importUnit }))} options={[["", "Select a unit"], ["millimeters", "Millimeters"], ["inches", "Inches"]]} />
          <Select label="Default planning machine" disabled={disabled} value={preferences.planningMachineId} onChange={(planningMachineId) => setPreferences((draft) => ({ ...draft, planningMachineId }))} options={[["", "None"], ...connectedWorkbench.machines.machines.map(({ id, name }) => [id, name] as const)]} />
        </div>
        <Button className="w-fit" disabled={disabled} size="sm" type="submit" variant="outline">Save preferences</Button>
      </form>

      {(localError || settingsErrorMessage) && <p className="border border-destructive bg-destructive/10 p-2 font-mono text-[10px] text-destructive" role="alert">{localError ?? settingsErrorMessage}</p>}
      {settingsStatus === 'saved' && <p className="border border-emerald-500/50 bg-emerald-500/10 p-2 text-[10px] text-emerald-200">Saved and verified from storage.</p>}
    </div>
  );
}

function PackagePreview({ disabled, onCommit, prepared }: {
  disabled: boolean;
  onCommit: (resolution: MachinePackageInstallationResolution) => void | Promise<void>;
  prepared: PreparedMachinePackageInstallation;
}) {
  const { preview } = prepared;
  const exactMachine = preview.machine.kind === 'exact' ? preview.machine : null;
  const changedMachine = preview.machine.kind === 'changed' ? preview.machine : null;
  const packageSetup = preview.machine.incoming.bindings.find(({ id }) => id === preview.activeBindingId);
  const previewExisting = exactMachine?.existing ?? changedMachine?.existing ?? null;
  const currentSetup = previewExisting?.bindings.find(({ id }) => id === previewExisting.activeBindingId) ?? null;
  const evidenceCount = prepared.package.document.machine.evidence.length +
    prepared.package.document.posts.reduce((total, post) => total + post.sources.length, 0);
  const postSummary = preview.posts.map((post) => {
    return `${post.name} ${post.version} · ${outputSummary(post.output)}${post.kind === 'already-installed' ? ' (already installed)' : ''}`;
  }).join(', ');
  return (
    <div className="grid gap-3 border border-primary/40 bg-primary/5 p-3 text-[10px]" data-machine-package-preview>
      <div><strong className="text-foreground">{preview.packageName}</strong> <span className="text-muted-foreground">{preview.packageVersion}</span></div>
      <div className="font-mono text-muted-foreground">Package SHA-256: {preview.packageHash}</div>
      <div className="text-muted-foreground">Machine: {preview.machine.incoming.name}</div>
      <div className="text-muted-foreground">Selected setup: {packageSetup?.name ?? preview.activeBindingId}{preview.machine.kind === 'possible' ? '' : currentSetup ? ` (currently ${currentSetup.name})` : ' (currently none)'}</div>
      <div className="text-muted-foreground">Evidence payloads: {evidenceCount}</div>
      <div className="text-muted-foreground">Posts: {postSummary}</div>
      {preview.machine.kind === 'new' && (
        <PreviewActions><Button disabled={disabled} onClick={() => onCommit({ kind: 'install-new' })} size="sm" type="button">Install machine package</Button></PreviewActions>
      )}
      {exactMachine && (
        <>
          <p>Existing machine detected: <strong>{exactMachine.existing.name}</strong>. The physical definition is identical.</p>
          <PreviewActions>
            <Button disabled={disabled} onClick={() => onCommit({ kind: 'reuse-existing', machineId: exactMachine.existing.id, activate: 'package' })} size="sm" type="button">Add and use new setup</Button>
            <Button disabled={disabled} onClick={() => onCommit({ kind: 'reuse-existing', machineId: exactMachine.existing.id, activate: 'keep-current' })} size="sm" type="button" variant="outline">Add without switching</Button>
          </PreviewActions>
        </>
      )}
      {changedMachine && (
        <>
          <p>The installed machine ID matches <strong>{changedMachine.existing.name}</strong>, but its physical definition changed.</p>
          <div className="grid gap-1 font-mono text-muted-foreground">{changedMachine.changes.map((change) => (
            <span className="break-all whitespace-pre-wrap" key={change.path}>
              {change.path}: {exactValue(change.before)} → {exactValue(change.after)}
            </span>
          ))}</div>
          <PreviewActions>
            <Button disabled={disabled} onClick={() => onCommit({ kind: 'replace-existing', machineId: changedMachine.existing.id, activate: 'package' })} size="sm" type="button">Update machine and use setup</Button>
            <Button disabled={disabled} onClick={() => onCommit({ kind: 'replace-existing', machineId: changedMachine.existing.id, activate: 'keep-current' })} size="sm" type="button" variant="outline">Update without switching</Button>
          </PreviewActions>
        </>
      )}
      {preview.machine.kind === 'possible' && (
        <>
          <p>A similar machine is already installed. Confirm whether this package belongs to it; no merge happens automatically.</p>
          {preview.machine.candidates.map((candidate) => (
            <div className="grid gap-1" key={candidate.id}>
              <p className="text-muted-foreground">{candidate.name}: currently {candidate.bindings.find(({ id }) => id === candidate.activeBindingId)?.name ?? 'no active setup'}</p>
              <PreviewActions>
                <Button disabled={disabled} onClick={() => onCommit({ kind: 'reuse-existing', machineId: candidate.id, activate: 'package' })} size="sm" type="button">Add setup to {candidate.name}</Button>
                <Button disabled={disabled} onClick={() => onCommit({ kind: 'reuse-existing', machineId: candidate.id, activate: 'keep-current' })} size="sm" type="button" variant="outline">Add to {candidate.name} without switching</Button>
              </PreviewActions>
            </div>
          ))}
          <Button className="w-fit" disabled={disabled} onClick={() => onCommit({ kind: 'install-new' })} size="sm" type="button" variant="outline">Install as a separate machine</Button>
        </>
      )}
    </div>
  );
}

function exactValue(value: unknown) {
  if (value === undefined) return 'undefined';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function outputSummary(output: PreparedMachinePackageInstallation['package']['document']['posts'][number]['manifest']['output']) {
  const numbering = output.blockNumbering.mode === 'sequential'
    ? `${output.blockNumbering.prefix}${output.blockNumbering.start} +${output.blockNumbering.increment}`
    : 'no numbering';
  const wrappers = output.programEnvelope.prefix.length + output.programEnvelope.suffix.length > 0
    ? `${output.programEnvelope.prefix.length} prefix / ${output.programEnvelope.suffix.length} suffix marker${output.programEnvelope.prefix.length + output.programEnvelope.suffix.length === 1 ? '' : 's'}`
    : 'no markers';
  return `.${output.fileExtension} · ${output.lineEnding.toUpperCase()} · ${output.encoding.toUpperCase()} · ${output.finalNewline ? 'final newline' : 'no final newline'} · ${numbering} · ${wrappers}`;
}

function postEvidenceSummary(
  evidence: PreparedMachinePackageInstallation['package']['document']['posts'][number]['evidence']
) {
  const reviewed = evidence.filter(({ review }) => review.status === 'reviewed').length;
  const unreviewed = evidence.length - reviewed;
  return `${reviewed} reviewed / ${unreviewed} unreviewed evidence claim${evidence.length === 1 ? '' : 's'}`;
}

function preferenceDraft(workbench: ConnectedWorkbenchCatalog): PreferenceDraft {
  const { preferences } = workbench.manifest;
  return {
    importMode: preferences.importUnits.mode,
    importUnit: preferences.importUnits.mode === 'fixed' ? preferences.importUnits.unit : '',
    planningMachineId: preferences.recentPlanningMachineId ?? ''
  };
}

function preferencesFromDraft(draft: PreferenceDraft):
  | { ok: true; preferences: WorkbenchCatalogManifest['preferences'] }
  | { ok: false; message: string } {
  let importUnits: WorkbenchCatalogManifest['preferences']['importUnits'];
  if (draft.importMode === 'ask') {
    importUnits = { mode: 'ask' };
  } else {
    if (draft.importUnit === '') return { ok: false, message: 'Select the fixed DXF import unit.' };
    importUnits = { mode: 'fixed', unit: draft.importUnit };
  }
  return {
    ok: true,
    preferences: {
      importUnits,
      recentPlanningMachineId: draft.planningMachineId === '' ? null : draft.planningMachineId
    }
  };
}

function FileButton({ disabled, onFile, onReject }: {
  disabled: boolean;
  onFile: (file: File) => void | Promise<void>;
  onReject: (message: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  return <div aria-label="Machine package drop zone"
    className={`grid justify-items-start gap-2 border border-dashed p-3 text-[10px] ${dragging && !disabled ? 'border-primary bg-primary/10' : 'border-border'}`}
    onDragEnter={(event) => {
      if (disabled || !Array.from(event.dataTransfer.types).includes('Files')) return;
      event.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    }}
    onDragOver={(event) => {
      if (!Array.from(event.dataTransfer.types).includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
      if (!disabled) setDragging(true);
    }}
    onDragLeave={() => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    }}
    onDrop={(event) => {
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (disabled) return;
      const files = Array.from(event.dataTransfer.files);
      if (files.length !== 1) {
        onReject('Drop one machine package file at a time.');
        return;
      }
      if (!/\.(wireedm-package|zip)$/i.test(files[0].name)) {
        onReject('Drop a .wireedm-package or .zip file.');
        return;
      }
      void onFile(files[0]);
    }}>
    <span className="text-muted-foreground">Drop a .wireedm-package here, or choose a file.</span>
    <label className={`inline-flex h-8 w-fit items-center gap-2 rounded-[2px] border border-border px-3 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-accent'}`}><Upload className="size-3.5" />Install machine package<input accept=".wireedm-package,application/zip" aria-label="Machine package file" className="sr-only" disabled={disabled} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void onFile(file); event.currentTarget.value = ''; }} type="file" /></label>
  </div>;
}

function PreviewActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

function SectionTitle({ title }: { title: string }) {
  return <h3 className="text-xs font-semibold text-foreground">{title}</h3>;
}

function Select<Value extends string>({ disabled, label, onChange, options, value }: { disabled: boolean; label: string; onChange: (value: Value) => void; options: readonly (readonly [Value, string])[]; value: Value }) {
  function handleChange(rawValue: string) {
    const selected = options.find(([optionValue]) => optionValue === rawValue);
    if (!selected) throw new Error(`Select ${label} received an undeclared option: ${rawValue}.`);
    onChange(selected[0]);
  }
  return <label className="grid gap-1 text-[10px] text-muted-foreground">{label}<select aria-label={label} className="technical-input h-8 px-2 text-[10px] text-foreground" disabled={disabled} onChange={(event) => handleChange(event.currentTarget.value)} value={value}>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>;
}
