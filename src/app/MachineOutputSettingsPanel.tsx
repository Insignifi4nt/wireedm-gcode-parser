import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Save } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { UpdateWorkbenchSettingsInput } from '@/domain/storage/updateWorkbenchSettings';
import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';
import type { OutputExtension } from '@/domain/workbench/types';

import {
  settingsDraftFromWorkbench,
  workbenchSettingsInputFromDraft,
  type SettingsDraft
} from './workbenchSettings';

interface MachineOutputSettingsPanelProps {
  connectedWorkbench: ConnectedWorkbench | null;
  onSaveWorkbenchSettings: (input: UpdateWorkbenchSettingsInput) => void | Promise<void>;
  settingsErrorMessage: string | null;
  settingsStatus: 'idle' | 'saving' | 'saved' | 'error';
}

export function MachineOutputSettingsPanel({
  connectedWorkbench,
  onSaveWorkbenchSettings,
  settingsErrorMessage,
  settingsStatus
}: MachineOutputSettingsPanelProps) {
  const [settingsDraft, setSettingsDraft] = useState(() =>
    settingsDraftFromWorkbench(connectedWorkbench)
  );
  const latestSettingsDraft = useMemo(
    () => settingsDraftFromWorkbench(connectedWorkbench),
    [connectedWorkbench]
  );
  const activeSettingsDraft =
    settingsDraft.sourceKey === latestSettingsDraft.sourceKey ? settingsDraft : latestSettingsDraft;
  const isSavingSettings = settingsStatus === 'saving';

  useEffect(() => {
    setSettingsDraft((current) =>
      current.sourceKey === latestSettingsDraft.sourceKey ? current : latestSettingsDraft
    );
  }, [latestSettingsDraft]);

  if (!connectedWorkbench) return null;
  const activeWorkbench = connectedWorkbench;

  async function handleSettingsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSaveWorkbenchSettings(
      workbenchSettingsInputFromDraft(activeWorkbench, activeSettingsDraft)
    );
  }

  function updateSettingsDraft(patch: Partial<Omit<SettingsDraft, 'sourceKey'>>) {
    setSettingsDraft((current) => ({ ...current, ...patch }));
  }

  return (
    <form className="grid gap-3" onSubmit={handleSettingsSubmit}>
      <div className="flex items-center justify-end">
        <Button disabled={isSavingSettings} size="sm" type="submit" variant="outline">
          <Save />
          {isSavingSettings ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>
      <div className="grid gap-2 text-[11px]">
        <label className="grid gap-1 text-muted-foreground">
          Machine Profile
          <input
            aria-label="Machine profile name"
            className="technical-input px-2 text-[11px] outline-none"
            disabled={isSavingSettings}
            onChange={(event) => updateSettingsDraft({ machineName: event.currentTarget.value })}
            value={activeSettingsDraft.machineName}
          />
        </label>
        <label className="grid gap-1 text-muted-foreground">
          Header
          <textarea
            aria-label="Header template"
            className="technical-input technical-value min-h-20 resize-y p-2 text-[10px] leading-4 outline-none"
            disabled={isSavingSettings}
            onChange={(event) => updateSettingsDraft({ header: event.currentTarget.value })}
            spellCheck={false}
            value={activeSettingsDraft.header}
          />
        </label>
        <label className="grid gap-1 text-muted-foreground">
          Footer
          <textarea
            aria-label="Footer template"
            className="technical-input technical-value min-h-20 resize-y p-2 text-[10px] leading-4 outline-none"
            disabled={isSavingSettings}
            onChange={(event) => updateSettingsDraft({ footer: event.currentTarget.value })}
            spellCheck={false}
            value={activeSettingsDraft.footer}
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-muted-foreground">
            Extension
            <select
              aria-label="Output extension"
              className="technical-input technical-value px-2 text-[11px] outline-none"
              disabled={isSavingSettings}
              onChange={(event) =>
                updateSettingsDraft({
                  extension: event.currentTarget.value as OutputExtension
                })
              }
              value={activeSettingsDraft.extension}
            >
              <option value="iso">.iso</option>
              <option value="nc">.nc</option>
              <option value="gcode">.gcode</option>
              <option value="custom">custom</option>
            </select>
          </label>
          <label className="grid gap-1 text-muted-foreground">
            Line Ending
            <select
              aria-label="Line ending"
              className="technical-input technical-value px-2 text-[11px] outline-none"
              disabled={isSavingSettings}
              onChange={(event) =>
                updateSettingsDraft({
                  lineEnding: event.currentTarget.value as 'lf' | 'crlf'
                })
              }
              value={activeSettingsDraft.lineEnding}
            >
              <option value="crlf">CRLF</option>
              <option value="lf">LF</option>
            </select>
          </label>
        </div>
        {activeSettingsDraft.extension === 'custom' && (
          <label className="grid gap-1 text-muted-foreground">
            Custom Extension
            <input
              aria-label="Custom output extension"
              className="technical-input technical-value px-2 text-[11px] outline-none"
              disabled={isSavingSettings}
              onChange={(event) =>
                updateSettingsDraft({ customExtension: event.currentTarget.value })
              }
              value={activeSettingsDraft.customExtension}
            />
          </label>
        )}
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-muted-foreground">
            Max Width mm
            <input
              aria-label="Machine max width"
              className="technical-input technical-value px-2 text-[11px] outline-none"
              disabled={isSavingSettings}
              inputMode="decimal"
              min="0"
              onChange={(event) =>
                updateSettingsDraft({ workAreaWidthMm: event.currentTarget.value })
              }
              placeholder="unset"
              step="any"
              type="number"
              value={activeSettingsDraft.workAreaWidthMm}
            />
          </label>
          <label className="grid gap-1 text-muted-foreground">
            Max Length mm
            <input
              aria-label="Machine max length"
              className="technical-input technical-value px-2 text-[11px] outline-none"
              disabled={isSavingSettings}
              inputMode="decimal"
              min="0"
              onChange={(event) =>
                updateSettingsDraft({ workAreaLengthMm: event.currentTarget.value })
              }
              placeholder="unset"
              step="any"
              type="number"
              value={activeSettingsDraft.workAreaLengthMm}
            />
          </label>
        </div>
        {settingsStatus === 'saved' && (
          <p className="border border-emerald-500/50 bg-emerald-500/10 p-2 text-emerald-200">
            Settings saved
          </p>
        )}
        {settingsErrorMessage && (
          <p className="border border-destructive bg-destructive/10 p-2 text-destructive">
            {settingsErrorMessage}
          </p>
        )}
      </div>
    </form>
  );
}
