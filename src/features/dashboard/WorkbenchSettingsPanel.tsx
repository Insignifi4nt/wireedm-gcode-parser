import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Save } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { UpdateWorkbenchSettingsInput } from '@/domain/storage/updateWorkbenchSettings';
import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';
import type { OutputExtension } from '@/domain/workbench/types';

import { settingsDraftFromWorkbench, type SettingsDraft } from './dashboardSettings';

interface WorkbenchSettingsPanelProps {
  connectedWorkbench: ConnectedWorkbench | null;
  settingsErrorMessage: string | null;
  settingsStatus: 'idle' | 'saving' | 'saved' | 'error';
  onSaveWorkbenchSettings: (input: UpdateWorkbenchSettingsInput) => void | Promise<void>;
}

export function WorkbenchSettingsPanel({
  connectedWorkbench,
  settingsErrorMessage,
  settingsStatus,
  onSaveWorkbenchSettings
}: WorkbenchSettingsPanelProps) {
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
    await onSaveWorkbenchSettings({
      header: activeSettingsDraft.header,
      footer: activeSettingsDraft.footer,
      machineProfile: {
        ...activeWorkbench.activeMachineProfile,
        name: activeSettingsDraft.machineName,
        templates: {
          header: activeSettingsDraft.header,
          footer: activeSettingsDraft.footer
        },
        output: {
          extension: activeSettingsDraft.extension,
          customExtension:
            activeSettingsDraft.extension === 'custom'
              ? activeSettingsDraft.customExtension
              : undefined,
          lineEnding: activeSettingsDraft.lineEnding
        },
        workArea: {
          widthMm: numberOrNull(activeSettingsDraft.workAreaWidthMm),
          lengthMm: numberOrNull(activeSettingsDraft.workAreaLengthMm)
        }
      },
      output: {
        extension: activeSettingsDraft.extension,
        customExtension:
          activeSettingsDraft.extension === 'custom'
            ? activeSettingsDraft.customExtension
            : undefined,
        lineEnding: activeSettingsDraft.lineEnding
      }
    });
  }

  function updateSettingsDraft(patch: Partial<Omit<SettingsDraft, 'sourceKey'>>) {
    setSettingsDraft((current) => ({ ...current, ...patch }));
  }

  return (
    <form className="mt-4 border-t border-border pt-3" onSubmit={handleSettingsSubmit}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-mono text-xs font-semibold">Workbench Settings</h3>
        <Button disabled={isSavingSettings} size="sm" type="submit" variant="outline">
          <Save />
          {isSavingSettings ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>
      <div className="grid gap-2">
        <label className="grid gap-1 text-muted-foreground">
          Machine Profile
          <input
            aria-label="Machine profile name"
            className="h-8 border border-border bg-background px-2 font-mono text-[11px] text-foreground outline-none focus:border-ring"
            disabled={isSavingSettings}
            onChange={(event) => updateSettingsDraft({ machineName: event.currentTarget.value })}
            value={activeSettingsDraft.machineName}
          />
        </label>
        <label className="grid gap-1 text-muted-foreground">
          Header
          <textarea
            aria-label="Header template"
            className="min-h-20 resize-y border border-border bg-background/70 p-2 font-mono text-[10px] leading-4 text-foreground outline-none focus:border-ring"
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
            className="min-h-20 resize-y border border-border bg-background/70 p-2 font-mono text-[10px] leading-4 text-foreground outline-none focus:border-ring"
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
              className="h-8 border border-border bg-background px-2 font-mono text-[11px] text-foreground outline-none focus:border-ring"
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
              className="h-8 border border-border bg-background px-2 font-mono text-[11px] text-foreground outline-none focus:border-ring"
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
              className="h-8 border border-border bg-background px-2 font-mono text-[11px] text-foreground outline-none focus:border-ring"
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
              className="h-8 border border-border bg-background px-2 font-mono text-[11px] text-foreground outline-none focus:border-ring"
              disabled={isSavingSettings}
              inputMode="decimal"
              min="0"
              onChange={(event) =>
                updateSettingsDraft({ workAreaWidthMm: event.currentTarget.value })
              }
              placeholder="unset"
              type="number"
              value={activeSettingsDraft.workAreaWidthMm}
            />
          </label>
          <label className="grid gap-1 text-muted-foreground">
            Max Length mm
            <input
              aria-label="Machine max length"
              className="h-8 border border-border bg-background px-2 font-mono text-[11px] text-foreground outline-none focus:border-ring"
              disabled={isSavingSettings}
              inputMode="decimal"
              min="0"
              onChange={(event) =>
                updateSettingsDraft({ workAreaLengthMm: event.currentTarget.value })
              }
              placeholder="unset"
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

function numberOrNull(value: string) {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
