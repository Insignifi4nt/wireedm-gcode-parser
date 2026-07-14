import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { Copy, Download, FilePlus2, Save, ShieldCheck, Star, Trash2, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { UpdateWorkbenchSettingsInput } from '@/domain/storage/updateWorkbenchSettings';
import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';
import type { MachineProfile, OutputExtension } from '@/domain/workbench/types';

import {
  acknowledgeMachineProfileFromSettingsDraft,
  applySettingsDraftPatch,
  machineProfileFromSettingsDraft,
  settingsDraftFromWorkbench,
  settingsDraftValidationMessage,
  workbenchSettingsInputFromDraft,
  type SettingsDraft
} from './workbenchSettings';

export interface MachineProfileSettingsActions {
  onAcknowledgeMachineProfile: (profile: MachineProfile) => Promise<boolean>;
  onCreateBlankMachineProfile: () => Promise<string | null>;
  onCreateRobofilV2CandidateProfile: () => Promise<string | null>;
  onDeleteMachineProfile: (profileId: string) => Promise<string | null>;
  onDuplicateMachineProfile: (profileId: string) => Promise<string | null>;
  onExportMachineProfile: (profile: MachineProfile) => void;
  onImportMachineProfileFile: (file: File) => Promise<string | null>;
  onSaveMachineProfile: (profile: MachineProfile) => Promise<boolean>;
  onSetDefaultMachineProfile: (profileId: string) => Promise<boolean>;
}

interface MachineOutputSettingsPanelProps extends MachineProfileSettingsActions {
  connectedWorkbench: ConnectedWorkbench | null;
  interactionLocked: boolean;
  onSaveWorkbenchSettings: (input: UpdateWorkbenchSettingsInput) => void | Promise<void>;
  settingsErrorMessage: string | null;
  settingsStatus: 'idle' | 'saving' | 'saved' | 'error';
}

export function MachineOutputSettingsPanel({
  connectedWorkbench,
  interactionLocked,
  onAcknowledgeMachineProfile,
  onCreateBlankMachineProfile,
  onCreateRobofilV2CandidateProfile,
  onDeleteMachineProfile,
  onDuplicateMachineProfile,
  onExportMachineProfile,
  onImportMachineProfileFile,
  onSaveMachineProfile,
  onSaveWorkbenchSettings,
  onSetDefaultMachineProfile,
  settingsErrorMessage,
  settingsStatus
}: MachineOutputSettingsPanelProps) {
  const [selectedProfileId, setSelectedProfileId] = useState(
    connectedWorkbench?.activeMachineProfile.id ?? ''
  );
  const [settingsDraft, setSettingsDraft] = useState(() =>
    settingsDraftFromWorkbench(connectedWorkbench, selectedProfileId)
  );
  const profiles = connectedWorkbench?.manifest.machineProfiles ?? [];
  const selectedProfile =
    profiles.find(({ id }) => id === selectedProfileId) ?? connectedWorkbench?.activeMachineProfile;
  const effectiveSelectedId = selectedProfile?.id ?? '';
  const latestSettingsDraft = useMemo(
    () => settingsDraftFromWorkbench(connectedWorkbench, effectiveSelectedId),
    [connectedWorkbench, effectiveSelectedId]
  );
  const activeSettingsDraft =
    settingsDraft.sourceKey === latestSettingsDraft.sourceKey ? settingsDraft : latestSettingsDraft;
  const isSavingSettings = settingsStatus === 'saving';
  const settingsControlsDisabled = interactionLocked || isSavingSettings;
  const validationMessage = selectedProfile
    ? settingsDraftValidationMessage(selectedProfile, activeSettingsDraft)
    : 'Machine profile not found.';
  const verificationWasReset =
    selectedProfile?.controller.verification.status === 'user-verified' &&
    activeSettingsDraft.verificationStatus === 'unverified';

  useEffect(() => {
    if (!connectedWorkbench) return;
    if (!profiles.some(({ id }) => id === selectedProfileId)) {
      setSelectedProfileId(connectedWorkbench.activeMachineProfile.id);
    }
  }, [connectedWorkbench, profiles, selectedProfileId]);

  useEffect(() => {
    setSettingsDraft((current) =>
      current.sourceKey === latestSettingsDraft.sourceKey ? current : latestSettingsDraft
    );
  }, [latestSettingsDraft]);

  if (!connectedWorkbench || !selectedProfile) return null;
  const activeWorkbench = connectedWorkbench;
  const isDefault = selectedProfile.id === connectedWorkbench.manifest.activeMachineProfileId;

  async function handleSettingsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (validationMessage) return;
    const profile = machineProfileFromSettingsDraft(selectedProfile!, activeSettingsDraft);
    if (profile.id === activeWorkbench.manifest.activeMachineProfileId) {
      await onSaveWorkbenchSettings(workbenchSettingsInputFromDraft(activeWorkbench, activeSettingsDraft));
    } else {
      await onSaveMachineProfile(profile);
    }
  }

  function updateSettingsDraft(patch: Partial<Omit<SettingsDraft, 'sourceKey'>>) {
    setSettingsDraft((current) => applySettingsDraftPatch(selectedProfile!, current, patch));
  }

  function selectProfile(profileId: string) {
    setSelectedProfileId(profileId);
    setSettingsDraft(settingsDraftFromWorkbench(activeWorkbench, profileId));
  }

  async function selectCreatedProfile(action: () => Promise<string | null>) {
    const profileId = await action();
    if (profileId) setSelectedProfileId(profileId);
  }

  async function handleImportChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    await selectCreatedProfile(() => onImportMachineProfileFile(file));
  }

  async function handleAcknowledgeVerification() {
    if (validationMessage) return;
    const acknowledged = acknowledgeMachineProfileFromSettingsDraft(
      selectedProfile!,
      activeSettingsDraft
    );
    await onAcknowledgeMachineProfile(acknowledged);
  }

  function handleExport() {
    if (validationMessage) return;
    onExportMachineProfile(machineProfileFromSettingsDraft(selectedProfile!, activeSettingsDraft));
  }

  return (
    <form className="grid gap-4" onSubmit={handleSettingsSubmit}>
      <section className="grid gap-2 border-b border-border pb-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
          <label className="grid gap-1 text-[11px] text-muted-foreground">
            Machine Profile
            <select
              aria-label="Machine profile selector"
              className="technical-input technical-value px-2 text-[11px] outline-none"
              disabled={settingsControlsDisabled}
              onChange={(event) => selectProfile(event.currentTarget.value)}
              value={effectiveSelectedId}
            >
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}{profile.id === activeWorkbench.manifest.activeMachineProfileId ? ' — default' : ''}
                </option>
              ))}
            </select>
          </label>
          <span className={`border px-2 py-1.5 font-mono text-[10px] ${
            isDefault
              ? 'border-primary/50 bg-primary/10 text-primary'
              : 'border-border text-muted-foreground'
          }`}>
            {isDefault ? 'DEFAULT' : 'INACTIVE DRAFT'}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <ActionButton
            ariaLabel="New blank machine profile"
            disabled={settingsControlsDisabled}
            icon={<FilePlus2 />}
            label="New Blank"
            onClick={() => selectCreatedProfile(onCreateBlankMachineProfile)}
          />
          <ActionButton
            ariaLabel="New Robofil v2 candidate profile"
            disabled={settingsControlsDisabled}
            icon={<FilePlus2 />}
            label="Robofil v2"
            onClick={() => selectCreatedProfile(onCreateRobofilV2CandidateProfile)}
          />
          <ActionButton
            ariaLabel="Duplicate machine profile"
            disabled={settingsControlsDisabled}
            icon={<Copy />}
            label="Duplicate"
            onClick={() => selectCreatedProfile(() => onDuplicateMachineProfile(selectedProfile.id))}
          />
          <ActionButton
            ariaLabel="Delete machine profile"
            disabled={settingsControlsDisabled || profiles.length === 1}
            icon={<Trash2 />}
            label="Delete"
            onClick={async () => {
              const fallbackId = await onDeleteMachineProfile(selectedProfile.id);
              if (fallbackId) setSelectedProfileId(fallbackId);
            }}
          />
          <ActionButton
            ariaLabel="Set default machine profile"
            disabled={settingsControlsDisabled || isDefault}
            icon={<Star />}
            label="Set Default"
            onClick={() => onSetDefaultMachineProfile(selectedProfile.id)}
          />
          <label className={`inline-flex h-8 items-center gap-1.5 rounded-[2px] border border-border px-2 text-[10px] ${
            settingsControlsDisabled ? 'pointer-events-none opacity-50' : 'cursor-pointer hover:bg-accent'
          }`}>
            <Upload className="size-3.5" /> Import
            <input
              accept=".json,.wireedm-machine.json,application/json"
              aria-label="Import machine profile file"
              className="sr-only"
              disabled={settingsControlsDisabled}
              onChange={handleImportChange}
              type="file"
            />
          </label>
          <ActionButton
            ariaLabel="Export machine profile"
            disabled={settingsControlsDisabled || Boolean(validationMessage)}
            icon={<Download />}
            label="Export"
            onClick={handleExport}
          />
        </div>
      </section>

      <section className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold">Identity &amp; verification</h3>
          <Button
            aria-label="Acknowledge machine profile verification"
            disabled={settingsControlsDisabled || Boolean(validationMessage)}
            onClick={handleAcknowledgeVerification}
            size="sm"
            type="button"
            variant="outline"
          >
            <ShieldCheck /> Acknowledge Verified
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 max-[760px]:grid-cols-1">
          <TextField
            ariaLabel="Machine profile ID"
            disabled
            label="Stable ID"
            onChange={() => undefined}
            value={activeSettingsDraft.profileId}
          />
          <TextField
            ariaLabel="Machine profile name"
            disabled={settingsControlsDisabled}
            label="Name"
            onChange={(machineName) => updateSettingsDraft({ machineName })}
            value={activeSettingsDraft.machineName}
          />
        </div>
        <div className={`border p-2 font-mono text-[10px] ${
          activeSettingsDraft.verificationStatus === 'user-verified'
            ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200'
            : 'border-amber-500/50 bg-amber-500/10 text-amber-100'
        }`}>
          {activeSettingsDraft.verificationStatus === 'user-verified'
            ? 'User verified — acknowledgement matches the controller-sensitive fingerprint.'
            : verificationWasReset
              ? 'Unverified — Controller-sensitive settings changed. Acknowledge again only after review.'
              : 'Unverified — review controller syntax and compensation lifecycle before use.'}
        </div>
      </section>

      <section className="grid gap-2 border-t border-border pt-4">
        <h3 className="text-xs font-semibold">Controller post policy</h3>
        <div className="grid grid-cols-3 gap-2 max-[760px]:grid-cols-2 max-[520px]:grid-cols-1">
          <SelectField ariaLabel="Controller family" disabled={settingsControlsDisabled} label="Family" onChange={(controllerFamily) => updateSettingsDraft({ controllerFamily: controllerFamily as SettingsDraft['controllerFamily'] })} options={CONTROLLER_FAMILY_OPTIONS} value={activeSettingsDraft.controllerFamily} />
          <NumberField ariaLabel="Post version" disabled={settingsControlsDisabled} label="Post version" min="1" onChange={(postVersion) => updateSettingsDraft({ postVersion })} step="1" value={activeSettingsDraft.postVersion} />
          <SelectField ariaLabel="Block formatting" disabled={settingsControlsDisabled} label="Block format" onChange={(blockFormatting) => updateSettingsDraft({ blockFormatting: blockFormatting as SettingsDraft['blockFormatting'] })} options={BLOCK_FORMAT_OPTIONS} value={activeSettingsDraft.blockFormatting} />
          <SelectField ariaLabel="Coordinate system" disabled={settingsControlsDisabled} label="Coordinate system" onChange={(coordinateSystem) => updateSettingsDraft({ coordinateSystem: coordinateSystem as SettingsDraft['coordinateSystem'] })} options={COORDINATE_SYSTEM_OPTIONS} value={activeSettingsDraft.coordinateSystem} />
          <SelectField ariaLabel="Units code" disabled={settingsControlsDisabled} label="Units emission" onChange={(unitsCode) => updateSettingsDraft({ unitsCode: unitsCode as SettingsDraft['unitsCode'] })} options={UNITS_CODE_OPTIONS} value={activeSettingsDraft.unitsCode} />
          <SelectField ariaLabel="Plane code" disabled={settingsControlsDisabled} label="Plane emission" onChange={(planeCode) => updateSettingsDraft({ planeCode: planeCode as SettingsDraft['planeCode'] })} options={PLANE_CODE_OPTIONS} value={activeSettingsDraft.planeCode} />
          <SelectField ariaLabel="Work offset code" disabled={settingsControlsDisabled} label="Work offset" onChange={(workOffsetCode) => updateSettingsDraft({ workOffsetCode: workOffsetCode as SettingsDraft['workOffsetCode'] })} options={WORK_OFFSET_OPTIONS} value={activeSettingsDraft.workOffsetCode} />
          <SelectField ariaLabel="Distance mode" disabled={settingsControlsDisabled} label="Distance mode" onChange={(distanceMode) => updateSettingsDraft({ distanceMode: distanceMode as SettingsDraft['distanceMode'] })} options={[['G90', 'G90 absolute']]} value={activeSettingsDraft.distanceMode} />
          <SelectField ariaLabel="Arc center mode" disabled={settingsControlsDisabled} label="Arc I/J mode" onChange={(arcCenterMode) => updateSettingsDraft({ arcCenterMode: arcCenterMode as SettingsDraft['arcCenterMode'] })} options={ARC_CENTER_OPTIONS} value={activeSettingsDraft.arcCenterMode} />
          <SelectField ariaLabel="Program end" disabled={settingsControlsDisabled} label="Program end" onChange={(programEnd) => updateSettingsDraft({ programEnd: programEnd as SettingsDraft['programEnd'] })} options={PROGRAM_END_OPTIONS} value={activeSettingsDraft.programEnd} />
        </div>
      </section>

      <section className="grid gap-2 border-t border-border pt-4">
        <h3 className="text-xs font-semibold">Controller compensation</h3>
        <div className="grid grid-cols-2 gap-2 max-[620px]:grid-cols-1">
          <CheckboxField ariaLabel="Compensation supported" checked={activeSettingsDraft.compensationSupported} disabled={settingsControlsDisabled} label="Controller compensation supported" onChange={(compensationSupported) => updateSettingsDraft({ compensationSupported })} />
          <CheckboxField ariaLabel="Compensation enabled by default" checked={activeSettingsDraft.compensationEnabledByDefault} disabled={settingsControlsDisabled} label="Enable by default for eligible new projects" onChange={(compensationEnabledByDefault) => updateSettingsDraft({ compensationEnabledByDefault })} />
        </div>
        <div className="grid grid-cols-3 gap-2 max-[760px]:grid-cols-2 max-[520px]:grid-cols-1">
          <NumberField ariaLabel="D register index" disabled={settingsControlsDisabled} label="D register index" min="0" onChange={(dRegisterIndex) => updateSettingsDraft({ dRegisterIndex })} step="1" value={activeSettingsDraft.dRegisterIndex} />
          <SelectField ariaLabel="Compensation activation" disabled={settingsControlsDisabled} label="Activation" onChange={(activation) => updateSettingsDraft({ activation: activation as SettingsDraft['activation'] })} options={ACTIVATION_OPTIONS} value={activeSettingsDraft.activation} />
          <SelectField ariaLabel="Compensation cancellation" disabled={settingsControlsDisabled} label="Cancellation" onChange={(cancellation) => updateSettingsDraft({ cancellation: cancellation as SettingsDraft['cancellation'] })} options={CANCELLATION_OPTIONS} value={activeSettingsDraft.cancellation} />
          <SelectField ariaLabel="Compensation lifecycle" disabled={settingsControlsDisabled} label="Lifecycle" onChange={(lifecycleScope) => updateSettingsDraft({ lifecycleScope: lifecycleScope as SettingsDraft['lifecycleScope'] })} options={LIFECYCLE_OPTIONS} value={activeSettingsDraft.lifecycleScope} />
          <NumberField ariaLabel="Validation lead length" disabled={settingsControlsDisabled} label="Validation lead mm" min="0" onChange={(validationLeadLengthMm) => updateSettingsDraft({ validationLeadLengthMm })} step="any" value={activeSettingsDraft.validationLeadLengthMm} />
          <NumberField ariaLabel="Expected maximum offset" disabled={settingsControlsDisabled} label="Max offset envelope mm" min="0" onChange={(expectedMaximumOffsetMm) => updateSettingsDraft({ expectedMaximumOffsetMm })} placeholder="unset" step="any" value={activeSettingsDraft.expectedMaximumOffsetMm} />
        </div>
        <label className="grid gap-1 text-[11px] text-muted-foreground">
          Pre-activation blocks (one per line)
          <textarea aria-label="Pre-activation codes" className="technical-input technical-value min-h-16 resize-y p-2 text-[10px] leading-4 outline-none" disabled={settingsControlsDisabled} onChange={(event) => updateSettingsDraft({ preActivationCodes: event.currentTarget.value })} spellCheck={false} value={activeSettingsDraft.preActivationCodes} />
        </label>
      </section>

      <section className="grid gap-2 border-t border-border pt-4">
        <h3 className="text-xs font-semibold">Templates &amp; output</h3>
        <div className="grid grid-cols-2 gap-2 max-[620px]:grid-cols-1">
          <label className="grid gap-1 text-[11px] text-muted-foreground">Header<textarea aria-label="Header template" className="technical-input technical-value min-h-20 resize-y p-2 text-[10px] leading-4 outline-none" disabled={settingsControlsDisabled} onChange={(event) => updateSettingsDraft({ header: event.currentTarget.value })} spellCheck={false} value={activeSettingsDraft.header} /></label>
          <label className="grid gap-1 text-[11px] text-muted-foreground">Footer<textarea aria-label="Footer template" className="technical-input technical-value min-h-20 resize-y p-2 text-[10px] leading-4 outline-none" disabled={settingsControlsDisabled} onChange={(event) => updateSettingsDraft({ footer: event.currentTarget.value })} spellCheck={false} value={activeSettingsDraft.footer} /></label>
        </div>
        <div className="grid grid-cols-3 gap-2 max-[620px]:grid-cols-1">
          <SelectField ariaLabel="Output extension" disabled={settingsControlsDisabled} label="Extension" onChange={(extension) => updateSettingsDraft({ extension: extension as OutputExtension })} options={OUTPUT_EXTENSION_OPTIONS} value={activeSettingsDraft.extension} />
          <SelectField ariaLabel="Line ending" disabled={settingsControlsDisabled} label="Line ending" onChange={(lineEnding) => updateSettingsDraft({ lineEnding: lineEnding as SettingsDraft['lineEnding'] })} options={LINE_ENDING_OPTIONS} value={activeSettingsDraft.lineEnding} />
          <NumberField ariaLabel="Coordinate precision" disabled={settingsControlsDisabled} label="Coordinate precision" max="6" min="0" onChange={(coordinatePrecision) => updateSettingsDraft({ coordinatePrecision })} step="1" value={activeSettingsDraft.coordinatePrecision} />
        </div>
        <SelectField
          ariaLabel="Preferred DXF import unit"
          disabled={settingsControlsDisabled}
          label="Preferred DXF import unit"
          onChange={(preferredDxfImportUnit) => updateSettingsDraft({
            preferredDxfImportUnit: preferredDxfImportUnit === ''
              ? null
              : preferredDxfImportUnit as NonNullable<SettingsDraft['preferredDxfImportUnit']>
          })}
          options={PREFERRED_DXF_IMPORT_UNIT_OPTIONS}
          value={activeSettingsDraft.preferredDxfImportUnit ?? ''}
        />
        {activeSettingsDraft.extension === 'custom' && <TextField ariaLabel="Custom output extension" disabled={settingsControlsDisabled} label="Custom extension" onChange={(customExtension) => updateSettingsDraft({ customExtension })} value={activeSettingsDraft.customExtension} />}
        <div className="grid grid-cols-2 gap-2">
          <NumberField ariaLabel="Machine max width" disabled={settingsControlsDisabled} label="Max width mm" min="0" onChange={(workAreaWidthMm) => updateSettingsDraft({ workAreaWidthMm })} placeholder="unset" step="any" value={activeSettingsDraft.workAreaWidthMm} />
          <NumberField ariaLabel="Machine max length" disabled={settingsControlsDisabled} label="Max length mm" min="0" onChange={(workAreaLengthMm) => updateSettingsDraft({ workAreaLengthMm })} placeholder="unset" step="any" value={activeSettingsDraft.workAreaLengthMm} />
        </div>
        <label className="grid gap-1 text-[11px] text-muted-foreground">Notes<textarea aria-label="Machine profile notes" className="technical-input min-h-16 resize-y p-2 text-[10px] leading-4 outline-none" disabled={settingsControlsDisabled} onChange={(event) => updateSettingsDraft({ notes: event.currentTarget.value })} value={activeSettingsDraft.notes} /></label>
      </section>

      {validationMessage && <p className="border border-destructive bg-destructive/10 p-2 font-mono text-[10px] text-destructive" role="alert">{validationMessage}</p>}
      {settingsStatus === 'saved' && <p className="border border-emerald-500/50 bg-emerald-500/10 p-2 text-[11px] text-emerald-200">Settings saved</p>}
      {settingsErrorMessage && <p className="border border-destructive bg-destructive/10 p-2 text-[11px] text-destructive" role="alert">{settingsErrorMessage}</p>}
      <div className="sticky bottom-0 flex justify-end border-t border-border bg-card/95 py-3 backdrop-blur">
        <Button aria-label="Save machine profile" disabled={settingsControlsDisabled || Boolean(validationMessage)} size="sm" type="submit" variant="outline"><Save />{isSavingSettings ? 'Saving...' : 'Save Settings'}</Button>
      </div>
    </form>
  );
}

function ActionButton({ ariaLabel, disabled, icon, label, onClick }: { ariaLabel: string; disabled: boolean; icon: ReactNode; label: string; onClick: () => unknown | Promise<unknown> }) {
  return <Button aria-label={ariaLabel} disabled={disabled} onClick={onClick} size="sm" type="button" variant="outline">{icon}{label}</Button>;
}

function TextField({ ariaLabel, disabled, label, onChange, value }: { ariaLabel: string; disabled: boolean; label: string; onChange: (value: string) => void; value: string }) {
  return <label className="grid gap-1 text-[11px] text-muted-foreground">{label}<input aria-label={ariaLabel} className="technical-input px-2 text-[11px] outline-none" disabled={disabled} onChange={(event) => onChange(event.currentTarget.value)} value={value} /></label>;
}

function NumberField({ ariaLabel, disabled, label, max, min, onChange, placeholder, step, value }: { ariaLabel: string; disabled: boolean; label: string; max?: string; min?: string; onChange: (value: string) => void; placeholder?: string; step: string; value: string }) {
  return <label className="grid gap-1 text-[11px] text-muted-foreground">{label}<input aria-label={ariaLabel} className="technical-input technical-value px-2 text-[11px] outline-none" disabled={disabled} inputMode="decimal" max={max} min={min} onChange={(event) => onChange(event.currentTarget.value)} placeholder={placeholder} step={step} type="number" value={value} /></label>;
}

function SelectField({ ariaLabel, disabled, label, onChange, options, value }: { ariaLabel: string; disabled: boolean; label: string; onChange: (value: string) => void; options: readonly (readonly [string, string])[]; value: string }) {
  return <label className="grid gap-1 text-[11px] text-muted-foreground">{label}<select aria-label={ariaLabel} className="technical-input technical-value px-2 text-[11px] outline-none" disabled={disabled} onChange={(event) => onChange(event.currentTarget.value)} value={value}>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>;
}

function CheckboxField({ ariaLabel, checked, disabled, label, onChange }: { ariaLabel: string; checked: boolean; disabled: boolean; label: string; onChange: (checked: boolean) => void }) {
  return <label className="flex min-h-9 items-center gap-2 border border-border px-2 text-[11px] text-muted-foreground"><input aria-label={ariaLabel} checked={checked} disabled={disabled} onChange={(event) => onChange(event.currentTarget.checked)} type="checkbox" />{label}</label>;
}

const CONTROLLER_FAMILY_OPTIONS = [['generic-iso', 'Generic ISO'], ['charmilles-robofil-classic', 'Charmilles Robofil Classic'], ['custom', 'Custom']] as const;
const BLOCK_FORMAT_OPTIONS = [['spaced', 'Spaced'], ['compact', 'Compact']] as const;
const COORDINATE_SYSTEM_OPTIONS = [['template-managed', 'Template managed'], ['work-offset', 'Work offset'], ['wire-position-g92', 'Wire position G92']] as const;
const UNITS_CODE_OPTIONS = [['omit', 'Omit'], ['G21', 'G21 millimetres'], ['G20', 'G20 inches']] as const;
const PLANE_CODE_OPTIONS = [['omit', 'Omit'], ['G17', 'G17 XY']] as const;
const WORK_OFFSET_OPTIONS = [['template-managed', 'Template managed'], ['omit', 'Omit'], ['G54', 'G54']] as const;
const ARC_CENTER_OPTIONS = [['incremental-from-start', 'Incremental from start'], ['absolute', 'Absolute']] as const;
const PROGRAM_END_OPTIONS = [['template-managed', 'Template managed'], ['M02', 'M02'], ['M30', 'M30']] as const;
const ACTIVATION_OPTIONS = [['linear-lead', 'Linear lead'], ['charmilles-g38', 'Charmilles G38']] as const;
const CANCELLATION_OPTIONS = [['linear-lead-out', 'Linear lead out'], ['charmilles-g39', 'Charmilles G39'], ['program-end', 'Program end']] as const;
const LIFECYCLE_OPTIONS = [['operation', 'Per operation'], ['program', 'Whole program']] as const;
const OUTPUT_EXTENSION_OPTIONS = [['iso', '.iso'], ['nc', '.nc'], ['gcode', '.gcode'], ['custom', 'Custom']] as const;
const LINE_ENDING_OPTIONS = [['crlf', 'CRLF'], ['lf', 'LF']] as const;
const PREFERRED_DXF_IMPORT_UNIT_OPTIONS = [
  ['', 'Automatic / ask on import'],
  ['millimeters', 'Millimeters'],
  ['inches', 'Inches']
] as const;
