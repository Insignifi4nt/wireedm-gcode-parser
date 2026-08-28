import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Download, Plus, Trash2, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type {
  CreateMachinePostBindingInput,
  MachinePostCompatibility
} from '@/domain/machine-definition/machineDefinition';
import type { DuplicateStoredMachinePostBindingInput } from '@/domain/machine-definition/machineLibraryMutations';
import type { PostInstallationRef } from '@/domain/post-processor/postLibrary';
import type {
  ConnectedWorkbenchCatalog,
  WorkbenchCatalogManifest
} from '@/domain/workbench-catalog/workbenchCatalog';

export interface MachinePostSettingsActions {
  readonly onCreateMachineBinding: (
    machineId: string,
    post: PostInstallationRef,
    input: CreateMachinePostBindingInput
  ) => void | Promise<void>;
  readonly onDuplicateMachineBinding: (
    machineId: string,
    sourceBindingId: string,
    input: DuplicateStoredMachinePostBindingInput
  ) => void | Promise<void>;
  readonly onExportMachineDefinition: (machineId: string) => void;
  readonly onImportMachineDefinition: (file: File) => void | Promise<void>;
  readonly onImportPostPackage: (file: File) => void | Promise<void>;
  readonly onRemoveMachineBinding: (
    machineId: string,
    bindingId: string
  ) => void | Promise<void>;
  readonly onRemoveMachineDefinition: (machineId: string) => void | Promise<void>;
  readonly onRemovePostInstallation: (post: PostInstallationRef) => void | Promise<void>;
  readonly onReplaceMachineDefinition: (file: File) => void | Promise<void>;
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
  importUnit: 'millimeters' | 'inches';
  exportStatus: 'unconfigured' | 'configured';
  extensionKind: 'standard' | 'custom';
  extension: string;
  lineEnding: 'lf' | 'crlf';
  planningMachineId: string;
};

export function MachinePostSettingsPanel({
  connectedWorkbench,
  interactionLocked,
  onCreateMachineBinding,
  onDuplicateMachineBinding,
  onExportMachineDefinition,
  onImportMachineDefinition,
  onImportPostPackage,
  onRemoveMachineBinding,
  onRemoveMachineDefinition,
  onRemovePostInstallation,
  onReplaceMachineDefinition,
  onSaveCatalogPreferences,
  settingsErrorMessage,
  settingsStatus
}: MachinePostSettingsPanelProps) {
  const [preferences, setPreferences] = useState(() => preferenceDraft(connectedWorkbench));
  const [machineId, setMachineId] = useState('');
  const [postKey, setPostKey] = useState('');
  const [bindingId, setBindingId] = useState('');
  const [bindingName, setBindingName] = useState('');
  const [propertiesText, setPropertiesText] = useState('{}');
  const [acknowledgedBy, setAcknowledgedBy] = useState('');
  const [compatibilityNotes, setCompatibilityNotes] = useState('');
  const [bindingDraftError, setBindingDraftError] = useState<string | null>(null);
  const disabled = interactionLocked || settingsStatus === 'saving';
  const machine = connectedWorkbench.machines.machines.find(({ id }) => id === machineId) ?? null;
  const postEntries = useMemo(
    () => connectedWorkbench.posts.installations.map((installation) => ({
      installation,
      key: postRefKey(installation.ref)
    })),
    [connectedWorkbench.posts]
  );

  useEffect(() => {
    setPreferences(preferenceDraft(connectedWorkbench));
    if (
      machineId &&
      !connectedWorkbench.machines.machines.some(({ id }) => id === machineId)
    ) setMachineId('');
    if (postKey && !postEntries.some(({ key }) => key === postKey)) setPostKey('');
  }, [connectedWorkbench, machineId, postEntries, postKey]);

  async function handlePreferenceSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = preferencesFromDraft(preferences);
    if (!parsed.ok) {
      setBindingDraftError(parsed.message);
      return;
    }
    setBindingDraftError(null);
    await onSaveCatalogPreferences(parsed.preferences);
  }

  async function handleBindingSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selectedPost = postEntries.find(({ key }) => key === postKey)?.installation.ref;
    if (!machineId || !selectedPost) {
      setBindingDraftError('Select an exact machine and post installation.');
      return;
    }
    let properties: unknown;
    try {
      properties = JSON.parse(propertiesText);
    } catch {
      setBindingDraftError('Binding properties must be valid JSON.');
      return;
    }
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
      setBindingDraftError('Binding properties must be a JSON object.');
      return;
    }
    if (!acknowledgedBy.trim()) {
      setBindingDraftError('Compatibility acknowledgement requires a person or organization.');
      return;
    }
    const compatibility = compatibilityClaim(acknowledgedBy, compatibilityNotes);
    setBindingDraftError(null);
    await onCreateMachineBinding(machineId, selectedPost, {
      id: bindingId.trim(),
      name: bindingName.trim(),
      properties: properties as Readonly<Record<string, unknown>>,
      compatibility
    });
  }

  return (
    <div className="grid gap-6">
      <form className="grid gap-3 border-b border-border pb-6" onSubmit={handlePreferenceSubmit}>
        <SectionTitle title="Workbench preferences" />
        <div className="grid grid-cols-2 gap-3 max-[720px]:grid-cols-1">
          <Select label="DXF import units" disabled={disabled} value={preferences.importMode} onChange={(value) => setPreferences((draft) => ({ ...draft, importMode: value as PreferenceDraft['importMode'] }))} options={[["ask", "Ask for every import"], ["fixed", "Use an explicit unit"]]} />
          <Select label="Fixed import unit" disabled={disabled || preferences.importMode !== 'fixed'} value={preferences.importUnit} onChange={(value) => setPreferences((draft) => ({ ...draft, importUnit: value as PreferenceDraft['importUnit'] }))} options={[["millimeters", "Millimeters"], ["inches", "Inches"]]} />
          <Select label="Controller export" disabled={disabled} value={preferences.exportStatus} onChange={(value) => setPreferences((draft) => ({ ...draft, exportStatus: value as PreferenceDraft['exportStatus'] }))} options={[["unconfigured", "Unconfigured"], ["configured", "Configured"]]} />
          <Select label="Line ending" disabled={disabled || preferences.exportStatus !== 'configured'} value={preferences.lineEnding} onChange={(value) => setPreferences((draft) => ({ ...draft, lineEnding: value as PreferenceDraft['lineEnding'] }))} options={[["lf", "LF"], ["crlf", "CRLF"]]} />
          <Select label="Extension type" disabled={disabled || preferences.exportStatus !== 'configured'} value={preferences.extensionKind} onChange={(value) => setPreferences((draft) => ({ ...draft, extensionKind: value as PreferenceDraft['extensionKind'], extension: value === 'standard' ? 'iso' : '' }))} options={[["standard", "Standard"], ["custom", "Custom"]]} />
          {preferences.extensionKind === 'standard' ? (
            <Select label="Extension" disabled={disabled || preferences.exportStatus !== 'configured'} value={preferences.extension} onChange={(extension) => setPreferences((draft) => ({ ...draft, extension }))} options={[["iso", ".iso"], ["nc", ".nc"], ["gcode", ".gcode"]]} />
          ) : (
            <TextField label="Custom extension" disabled={disabled || preferences.exportStatus !== 'configured'} value={preferences.extension} onChange={(extension) => setPreferences((draft) => ({ ...draft, extension }))} />
          )}
          <Select label="Recent planning machine" disabled={disabled} value={preferences.planningMachineId} onChange={(planningMachineId) => setPreferences((draft) => ({ ...draft, planningMachineId }))} options={[["", "None"], ...connectedWorkbench.machines.machines.map(({ id, name }) => [id, `${name} (${id})`] as const)]} />
        </div>
        <Button className="w-fit" disabled={disabled} size="sm" type="submit" variant="outline">Save preferences</Button>
      </form>

      <section className="grid gap-3 border-b border-border pb-6">
        <SectionTitle title="Physical machine library" />
        <p className="text-[10px] text-muted-foreground">Machine files contain physical identity, travel, threading hardware, evidence, and exact post bindings. Controller vocabulary belongs in post packages.</p>
        <div className="flex flex-wrap gap-2">
          <FileButton accept="application/json,.json" disabled={disabled} label="Install machine" onFile={onImportMachineDefinition} />
          <FileButton accept="application/json,.json" disabled={disabled} label="Replace from file" onFile={onReplaceMachineDefinition} />
        </div>
        <Select label="Machine to manage" disabled={disabled} value={machineId} onChange={setMachineId} options={[["", "Select a machine"], ...connectedWorkbench.machines.machines.map(({ id, name }) => [id, `${name} (${id})`] as const)]} />
        {machine && (
          <div className="grid gap-2 border border-border bg-background/40 p-3 text-[10px]">
            <div className="font-semibold text-foreground">{machine.name}</div>
            <div className="text-muted-foreground">{machine.identity.manufacturer} {machine.identity.model} · {machine.identity.controller.manufacturer} {machine.identity.controller.model}</div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={disabled} onClick={() => onExportMachineDefinition(machine.id)} size="sm" type="button" variant="outline"><Download />Export exact file</Button>
              <Button disabled={disabled} onClick={() => onRemoveMachineDefinition(machine.id)} size="sm" type="button" variant="danger"><Trash2 />Remove machine</Button>
            </div>
          </div>
        )}
      </section>

      <section className="grid gap-3 border-b border-border pb-6">
        <SectionTitle title="Versioned post library" />
        <FileButton accept="application/json,.json" disabled={disabled} label="Install post package" onFile={onImportPostPackage} />
        <div className="grid gap-2">
          {postEntries.map(({ installation, key }) => (
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border border-border bg-background/40 p-2 text-[10px]" key={key}>
              <div className="min-w-0"><div className="truncate text-foreground">{installation.package.manifest.name}</div><div className="truncate font-mono text-muted-foreground">{installation.ref.packageId}@{installation.ref.version} · {installation.ref.contentHash}</div></div>
              <Button aria-label={`Remove ${installation.ref.packageId} ${installation.ref.version}`} disabled={disabled} onClick={() => onRemovePostInstallation(installation.ref)} size="icon" type="button" variant="ghost"><Trash2 /></Button>
            </div>
          ))}
        </div>
      </section>

      <form className="grid gap-3" onSubmit={handleBindingSubmit}>
        <SectionTitle title="Bind an exact post to the selected machine" />
        <Select label="Post installation" disabled={disabled || !machine} value={postKey} onChange={setPostKey} options={[["", "Select an exact version"], ...postEntries.map(({ installation, key }) => [key, `${installation.ref.packageId}@${installation.ref.version} · ${installation.ref.contentHash.slice(0, 12)}`] as const)]} />
        <div className="grid grid-cols-2 gap-3 max-[720px]:grid-cols-1">
          <TextField label="Binding ID" disabled={disabled || !machine} value={bindingId} onChange={setBindingId} />
          <TextField label="Binding name" disabled={disabled || !machine} value={bindingName} onChange={setBindingName} />
          <TextField label="Acknowledged by" disabled={disabled || !machine} value={acknowledgedBy} onChange={setAcknowledgedBy} />
          <TextField label="Compatibility notes" disabled={disabled || !machine} value={compatibilityNotes} onChange={setCompatibilityNotes} />
        </div>
        <label className="grid gap-1 text-[10px] text-muted-foreground">Post properties JSON<textarea aria-label="Post properties JSON" className="technical-input min-h-20 p-2 font-mono text-[10px] text-foreground" disabled={disabled || !machine} onChange={(event) => setPropertiesText(event.currentTarget.value)} spellCheck={false} value={propertiesText} /></label>
        <Button className="w-fit" disabled={disabled || !machine} size="sm" type="submit" variant="outline"><Plus />Create binding</Button>
        {machine?.bindings.map((binding) => (
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border border-border p-2 text-[10px]" key={binding.id}>
            <div className="min-w-0"><div className="truncate text-foreground">{binding.name}</div><div className="truncate font-mono text-muted-foreground">{binding.id} → {binding.post.packageId}@{binding.post.version}</div></div>
            <Button disabled={disabled} onClick={() => onDuplicateMachineBinding(machine.id, binding.id, { id: `${binding.id}-copy`, name: `${binding.name} copy`, compatibility: compatibilityClaim(acknowledgedBy, compatibilityNotes) })} size="sm" type="button" variant="outline">Duplicate</Button>
            <Button aria-label={`Remove binding ${binding.id}`} disabled={disabled} onClick={() => onRemoveMachineBinding(machine.id, binding.id)} size="icon" type="button" variant="ghost"><Trash2 /></Button>
          </div>
        ))}
      </form>

      {(bindingDraftError || settingsErrorMessage) && <p className="border border-destructive bg-destructive/10 p-2 font-mono text-[10px] text-destructive">{bindingDraftError ?? settingsErrorMessage}</p>}
      {settingsStatus === 'saved' && <p className="border border-emerald-500/50 bg-emerald-500/10 p-2 text-[10px] text-emerald-200">Saved and verified from storage.</p>}
    </div>
  );
}

function compatibilityClaim(acknowledgedBy: string, notes: string): MachinePostCompatibility {
  return {
    status: 'acknowledged',
    acknowledgedAt: new Date().toISOString(),
    acknowledgedBy: acknowledgedBy.trim(),
    notes: notes.trim()
  };
}

function preferenceDraft(workbench: ConnectedWorkbenchCatalog): PreferenceDraft {
  const { preferences } = workbench.manifest;
  return {
    importMode: preferences.importUnits.mode,
    importUnit: preferences.importUnits.mode === 'fixed' ? preferences.importUnits.unit : 'millimeters',
    exportStatus: preferences.export.status,
    extensionKind: preferences.export.status === 'configured' ? preferences.export.fileExtension.kind : 'standard',
    extension: preferences.export.status === 'configured' ? preferences.export.fileExtension.extension : 'iso',
    lineEnding: preferences.export.status === 'configured' ? preferences.export.lineEnding : 'lf',
    planningMachineId: preferences.recentPlanningMachineId ?? ''
  };
}

function preferencesFromDraft(draft: PreferenceDraft):
  | { ok: true; preferences: WorkbenchCatalogManifest['preferences'] }
  | { ok: false; message: string } {
  const extension = draft.extension.trim().replace(/^\./, '');
  if (draft.exportStatus === 'configured' && !/^[A-Za-z0-9]{1,16}$/.test(extension)) {
    return { ok: false, message: 'Configured output extension must contain 1–16 letters or digits.' };
  }
  if (draft.extensionKind === 'standard' && !['iso', 'nc', 'gcode'].includes(extension)) {
    return { ok: false, message: 'Select one of the declared standard extensions.' };
  }
  return {
    ok: true,
    preferences: {
      importUnits: draft.importMode === 'ask'
        ? { mode: 'ask' }
        : { mode: 'fixed', unit: draft.importUnit },
      export: draft.exportStatus === 'unconfigured'
        ? { status: 'unconfigured' }
        : {
            status: 'configured',
            fileExtension: draft.extensionKind === 'standard'
              ? { kind: 'standard', extension: extension as 'iso' | 'nc' | 'gcode' }
              : { kind: 'custom', extension },
            lineEnding: draft.lineEnding
          },
      recentPlanningMachineId: draft.planningMachineId || null
    }
  };
}

function postRefKey(ref: PostInstallationRef) {
  return `${ref.packageId}\u0000${ref.version}\u0000${ref.contentHash}`;
}

function FileButton({ accept, disabled, label, onFile }: { accept: string; disabled: boolean; label: string; onFile: (file: File) => void | Promise<void> }) {
  return <label className={`inline-flex h-8 w-fit items-center gap-2 rounded-[2px] border border-border px-3 text-[10px] ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-accent'}`}><Upload className="size-3.5" />{label}<input accept={accept} className="sr-only" disabled={disabled} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void onFile(file); event.currentTarget.value = ''; }} type="file" /></label>;
}

function SectionTitle({ title }: { title: string }) {
  return <h3 className="text-xs font-semibold text-foreground">{title}</h3>;
}

function Select({ disabled, label, onChange, options, value }: { disabled: boolean; label: string; onChange: (value: string) => void; options: readonly (readonly [string, string])[]; value: string }) {
  return <label className="grid gap-1 text-[10px] text-muted-foreground">{label}<select aria-label={label} className="technical-input h-8 px-2 text-[10px] text-foreground" disabled={disabled} onChange={(event) => onChange(event.currentTarget.value)} value={value}>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>;
}

function TextField({ disabled, label, onChange, value }: { disabled: boolean; label: string; onChange: (value: string) => void; value: string }) {
  return <label className="grid gap-1 text-[10px] text-muted-foreground">{label}<input aria-label={label} className="technical-input h-8 px-2 text-[10px] text-foreground" disabled={disabled} onChange={(event) => onChange(event.currentTarget.value)} value={value} /></label>;
}
