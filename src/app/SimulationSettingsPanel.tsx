import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  normalizeWorkbenchSimulationSettings,
  type MachineSimulationSettings,
  type SimulationRenderingQuality,
  type WorkbenchSimulationSettings
} from '@/domain/simulation/simulationConfig';
import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';

interface SimulationSettingsPanelProps {
  connectedWorkbench: ConnectedWorkbench | null;
  interactionLocked: boolean;
  onSaveWorkbenchSimulationSettings: (
    settings: WorkbenchSimulationSettings
  ) => void | Promise<void>;
  settingsErrorMessage: string | null;
  settingsStatus: 'idle' | 'saving' | 'saved' | 'error';
}

type MachineSimulationDraft = Record<keyof MachineSimulationSettings, string>;

const MACHINE_FIELDS: Array<{
  key: keyof MachineSimulationSettings;
  label: string;
  positive: boolean;
  step: string;
}> = [
  { key: 'upperGuideZMm', label: 'Upper guide Z', positive: false, step: '0.1' },
  { key: 'lowerGuideZMm', label: 'Lower guide Z', positive: false, step: '0.1' },
  { key: 'tankDepthMm', label: 'Tank depth', positive: true, step: '0.1' },
  {
    key: 'defaultWireDiameterMm',
    label: 'Default wire diameter',
    positive: true,
    step: '0.01'
  },
  { key: 'fixtureClearanceMm', label: 'Fixture clearance', positive: true, step: '0.1' }
];

export function SimulationSettingsPanel({
  connectedWorkbench,
  interactionLocked,
  onSaveWorkbenchSimulationSettings,
  settingsErrorMessage,
  settingsStatus
}: SimulationSettingsPanelProps) {
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [renderingQuality, setRenderingQuality] =
    useState<SimulationRenderingQuality>('balanced');
  const [machineDrafts, setMachineDrafts] = useState<Record<string, MachineSimulationDraft>>({});
  const [validationError, setValidationError] = useState<string | null>(null);

  const profiles = connectedWorkbench?.manifest.machineProfiles ?? [];

  useEffect(() => {
    if (!connectedWorkbench) {
      setSelectedProfileId('');
      setMachineDrafts({});
      setRenderingQuality('balanced');
      return;
    }

    const settings = normalizeWorkbenchSimulationSettings(
      connectedWorkbench.manifest.simulation,
      connectedWorkbench.manifest.machineProfiles
    );
    setRenderingQuality(settings.renderingQuality);
    setMachineDrafts(
      Object.fromEntries(
        Object.entries(settings.machines).map(([profileId, machine]) => [
          profileId,
          machineDraftFromSettings(machine)
        ])
      )
    );
    setSelectedProfileId((current) => {
      if (connectedWorkbench.manifest.machineProfiles.some(({ id }) => id === current)) {
        return current;
      }
      return connectedWorkbench.manifest.machineProfiles.some(
        ({ id }) => id === connectedWorkbench.manifest.activeMachineProfileId
      )
        ? connectedWorkbench.manifest.activeMachineProfileId
        : connectedWorkbench.manifest.machineProfiles[0]?.id ?? '';
    });
    setValidationError(null);
  }, [connectedWorkbench]);

  const selectedDraft = machineDrafts[selectedProfileId];

  function updateSelectedDraft(key: keyof MachineSimulationSettings, value: string) {
    setMachineDrafts((current) => ({
      ...current,
      [selectedProfileId]: {
        ...current[selectedProfileId],
        [key]: value
      }
    }));
    setValidationError(null);
  }

  function handleSave() {
    if (!connectedWorkbench) return;

    try {
      const machines = Object.fromEntries(
        connectedWorkbench.manifest.machineProfiles.map(({ id }) => [
          id,
          settingsFromMachineDraft(machineDrafts[id], id)
        ])
      );
      setValidationError(null);
      void onSaveWorkbenchSimulationSettings({
        schemaVersion: 1,
        renderingQuality,
        machines
      });
    } catch (error) {
      setValidationError(
        error instanceof Error ? error.message : 'Simulation settings are invalid.'
      );
    }
  }

  if (!connectedWorkbench || profiles.length === 0 || !selectedDraft) {
    return (
      <p className="border border-border p-3 text-[11px] text-muted-foreground">
        Connect a workbench with at least one machine profile to configure 3D simulation.
      </p>
    );
  }

  return (
    <div className="grid gap-5">
      <section>
        <h3 className="text-xs font-semibold">Simulation rendering</h3>
        <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
          Reusable visualization defaults are stored per machine profile. They do not change the
          export machine or its verification.
        </p>
        <label className="mt-3 grid gap-1 text-[10px] text-muted-foreground">
          Rendering quality
          <select
            aria-label="Simulation rendering quality"
            className="h-8 border border-border bg-background px-2 text-[11px] text-foreground outline-none focus:border-primary"
            disabled={interactionLocked}
            onChange={(event) => {
              setRenderingQuality(event.target.value as SimulationRenderingQuality);
              setValidationError(null);
            }}
            value={renderingQuality}
          >
            <option value="performance">Performance</option>
            <option value="balanced">Balanced</option>
            <option value="quality">Quality</option>
          </select>
        </label>
      </section>

      <section>
        <h3 className="text-xs font-semibold">Machine visualization</h3>
        <label className="mt-3 grid gap-1 text-[10px] text-muted-foreground">
          Machine profile
          <select
            aria-label="Simulation machine profile"
            className="h-8 border border-border bg-background px-2 text-[11px] text-foreground outline-none focus:border-primary"
            disabled={interactionLocked}
            onChange={(event) => {
              setSelectedProfileId(event.target.value);
              setValidationError(null);
            }}
            value={selectedProfileId}
          >
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-3 grid grid-cols-2 gap-3 max-[720px]:grid-cols-1">
          {MACHINE_FIELDS.map((field) => (
            <label className="grid gap-1 text-[10px] text-muted-foreground" key={field.key}>
              {field.label} (mm)
              <input
                aria-label={field.label}
                className="h-8 border border-border bg-background px-2 font-mono text-[11px] text-foreground outline-none focus:border-primary"
                disabled={interactionLocked}
                min={field.positive ? '0' : undefined}
                onChange={(event) => updateSelectedDraft(field.key, event.target.value)}
                step={field.step}
                type="number"
                value={selectedDraft[field.key]}
              />
            </label>
          ))}
        </div>
      </section>

      {(validationError || settingsErrorMessage) && (
        <p className="border border-destructive bg-destructive/10 p-2 font-mono text-[10px] text-destructive">
          {validationError ?? settingsErrorMessage}
        </p>
      )}
      {settingsStatus === 'saved' && !validationError && (
        <p className="font-mono text-[10px] text-primary">3D simulation settings saved.</p>
      )}

      <div>
        <Button
          aria-label="Save 3D simulation settings"
          disabled={interactionLocked || settingsStatus === 'saving'}
          onClick={handleSave}
          type="button"
        >
          {settingsStatus === 'saving' ? 'Saving…' : 'Save simulation settings'}
        </Button>
      </div>
    </div>
  );
}

function machineDraftFromSettings(settings: MachineSimulationSettings): MachineSimulationDraft {
  return {
    upperGuideZMm: String(settings.upperGuideZMm),
    lowerGuideZMm: String(settings.lowerGuideZMm),
    tankDepthMm: String(settings.tankDepthMm),
    defaultWireDiameterMm: String(settings.defaultWireDiameterMm),
    fixtureClearanceMm: String(settings.fixtureClearanceMm)
  };
}

function settingsFromMachineDraft(
  draft: MachineSimulationDraft | undefined,
  profileId: string
): MachineSimulationSettings {
  if (!draft) throw new Error(`Simulation values are missing for machine ${profileId}.`);

  return Object.fromEntries(
    MACHINE_FIELDS.map(({ key, label, positive }) => {
      const value = Number(draft[key]);
      if (!Number.isFinite(value) || (positive && value <= 0)) {
        throw new Error(`${label} must be ${positive ? 'greater than zero' : 'a finite number'}.`);
      }
      return [key, value];
    })
  ) as unknown as MachineSimulationSettings;
}
