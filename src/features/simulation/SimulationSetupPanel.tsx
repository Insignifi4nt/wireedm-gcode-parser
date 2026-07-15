import { useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ProjectSimulationSettings } from '@/domain/simulation/simulationConfig';
import type { MachineProfile } from '@/domain/workbench/types';

export interface SimulationSetupPanelProps {
  projectName: string;
  settings: ProjectSimulationSettings;
  machineProfiles: readonly MachineProfile[];
  exportMachineProfileId: string;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  saveErrorMessage: string | null;
  onSave: (settings: ProjectSimulationSettings) => void | Promise<void>;
}

interface SetupDraft {
  machineProfileId: string;
  widthMm: string;
  lengthMm: string;
  thicknessMm: string;
  originX: string;
  originY: string;
  topZMm: string;
  material: string;
  entryHoleDiameterMm: string;
  visualPlaybackSpeed: string;
}

export function SimulationSetupPanel({
  projectName,
  settings,
  machineProfiles,
  exportMachineProfileId,
  saveStatus,
  saveErrorMessage,
  onSave
}: SimulationSetupPanelProps) {
  const [draft, setDraft] = useState(() => draftFromSettings(settings));

  useEffect(() => {
    setDraft(draftFromSettings(settings));
  }, [settings]);

  const validation = useMemo(
    () => validateDraft(draft, settings.schemaVersion, machineProfiles),
    [draft, machineProfiles, settings.schemaVersion]
  );
  const machineMismatch = draft.machineProfileId !== exportMachineProfileId;

  return (
    <aside
      aria-labelledby="simulation-setup-title"
      className="min-h-0 overflow-auto border-r border-border bg-card/95"
      data-simulation-setup
    >
      <div className="border-b border-border px-3 py-2.5">
        <p className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground">Project setup</p>
        <h2 className="mt-1 truncate text-xs font-semibold" id="simulation-setup-title" title={projectName}>
          {projectName}
        </h2>
      </div>

      <div className="grid gap-3 p-3 text-[10px]">
        <label className="grid gap-1 text-muted-foreground">
          <span className="uppercase tracking-[0.05em]">Simulation machine</span>
          <select
            aria-label="Simulation machine"
            className="technical-input h-8 px-2 text-[11px] text-foreground outline-none"
            disabled={saveStatus === 'saving'}
            onChange={(event) => update('machineProfileId', event.currentTarget.value)}
            value={draft.machineProfileId}
          >
            {machineProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.name}</option>
            ))}
          </select>
        </label>

        {machineMismatch && (
          <p className="border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[9px] leading-4 text-amber-200">
            Simulation machine differs from the project export machine. Export settings are unchanged.
          </p>
        )}

        <fieldset className="grid grid-cols-2 gap-2 border border-border p-2">
          <legend className="px-1 text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
            Stock envelope
          </legend>
          <NumericField label="Stock width (mm)" value={draft.widthMm} onChange={(value) => update('widthMm', value)} />
          <NumericField label="Stock length (mm)" value={draft.lengthMm} onChange={(value) => update('lengthMm', value)} />
          <NumericField label="Stock thickness (mm)" value={draft.thicknessMm} onChange={(value) => update('thicknessMm', value)} />
          <NumericField label="Stock top Z (mm)" value={draft.topZMm} onChange={(value) => update('topZMm', value)} />
          <NumericField label="Stock origin X (mm)" value={draft.originX} onChange={(value) => update('originX', value)} />
          <NumericField label="Stock origin Y (mm)" value={draft.originY} onChange={(value) => update('originY', value)} />
          <label className="col-span-2 grid gap-1 text-muted-foreground">
            <span>Stock material</span>
            <input
              aria-label="Stock material"
              className="technical-input h-7 px-2 text-[10px] text-foreground outline-none"
              onChange={(event) => update('material', event.currentTarget.value)}
              value={draft.material}
            />
          </label>
        </fieldset>

        <div className="grid gap-2">
          <NumericField
            label="Entry hole diameter (mm)"
            value={draft.entryHoleDiameterMm}
            onChange={(value) => update('entryHoleDiameterMm', value)}
          />
          <NumericField
            label="Visual playback speed multiplier"
            value={draft.visualPlaybackSpeed}
            onChange={(value) => update('visualPlaybackSpeed', value)}
          />
        </div>

        {validation.errors.length > 0 && (
          <div className="grid gap-1 border border-destructive/40 bg-destructive/10 p-2 text-[9px] text-destructive" role="alert">
            {validation.errors.map((error) => <p key={error}>{error}</p>)}
          </div>
        )}

        <Button
          aria-label="Save simulation setup"
          disabled={!validation.settings || saveStatus === 'saving'}
          onClick={() => validation.settings && void onSave(validation.settings)}
          size="sm"
          type="button"
        >
          <Save />
          {saveStatus === 'saving' ? 'Saving…' : 'Save setup'}
        </Button>

        {saveStatus === 'saved' && (
          <p className="text-[9px] text-emerald-400" role="status">Simulation setup saved.</p>
        )}
        {saveStatus === 'error' && saveErrorMessage && (
          <p className="text-[9px] text-destructive" role="alert">{saveErrorMessage}</p>
        )}
      </div>
    </aside>
  );

  function update<Key extends keyof SetupDraft>(key: Key, value: SetupDraft[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
}

function NumericField({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-muted-foreground">
      <span>{label.replace(' (mm)', '')}</span>
      <input
        aria-label={label}
        className="technical-input h-7 px-2 font-mono text-[10px] text-foreground outline-none"
        inputMode="decimal"
        onChange={(event) => onChange(event.currentTarget.value)}
        step="any"
        type="number"
        value={value}
      />
    </label>
  );
}

function draftFromSettings(settings: ProjectSimulationSettings): SetupDraft {
  return {
    machineProfileId: settings.machineProfileId,
    widthMm: formatDraftNumber(settings.stock.widthMm),
    lengthMm: formatDraftNumber(settings.stock.lengthMm),
    thicknessMm: formatDraftNumber(settings.stock.thicknessMm),
    originX: formatDraftNumber(settings.stock.originX),
    originY: formatDraftNumber(settings.stock.originY),
    topZMm: formatDraftNumber(settings.stock.topZMm),
    material: settings.stock.material,
    entryHoleDiameterMm: formatDraftNumber(settings.entryHoleDiameterMm),
    visualPlaybackSpeed: formatDraftNumber(settings.visualPlaybackSpeed)
  };
}

function formatDraftNumber(value: number) {
  return String(Number(value.toFixed(3)));
}

function validateDraft(
  draft: SetupDraft,
  schemaVersion: ProjectSimulationSettings['schemaVersion'],
  machineProfiles: readonly MachineProfile[]
) {
  const errors: string[] = [];
  const positive = (value: string, label: string) => {
    const parsed = finite(value);
    if (parsed === null || parsed <= 0) errors.push(`${label} must be greater than 0.`);
    return parsed;
  };
  const finiteValue = (value: string, label: string) => {
    const parsed = finite(value);
    if (parsed === null) errors.push(`${label} must be a finite number.`);
    return parsed;
  };

  const widthMm = positive(draft.widthMm, 'Stock width');
  const lengthMm = positive(draft.lengthMm, 'Stock length');
  const thicknessMm = positive(draft.thicknessMm, 'Stock thickness');
  const originX = finiteValue(draft.originX, 'Stock origin X');
  const originY = finiteValue(draft.originY, 'Stock origin Y');
  const topZMm = finiteValue(draft.topZMm, 'Stock top Z');
  const entryHoleDiameterMm = positive(draft.entryHoleDiameterMm, 'Entry hole diameter');
  const visualPlaybackSpeed = positive(draft.visualPlaybackSpeed, 'Visual playback speed');
  const material = draft.material.trim();
  if (!material) errors.push('Stock material is required.');
  if (!machineProfiles.some((profile) => profile.id === draft.machineProfileId)) {
    errors.push('Select a configured simulation machine.');
  }

  const settings = errors.length === 0
    ? {
        schemaVersion,
        machineProfileId: draft.machineProfileId,
        stock: {
          widthMm: widthMm!,
          lengthMm: lengthMm!,
          thicknessMm: thicknessMm!,
          originX: originX!,
          originY: originY!,
          topZMm: topZMm!,
          material
        },
        entryHoleDiameterMm: entryHoleDiameterMm!,
        visualPlaybackSpeed: visualPlaybackSpeed!
      } satisfies ProjectSimulationSettings
    : null;

  return { errors, settings };
}

function finite(value: string) {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
