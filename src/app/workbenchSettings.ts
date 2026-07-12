import type { UpdateWorkbenchSettingsInput } from '@/domain/storage/updateWorkbenchSettings';
import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';
import type { OutputExtension } from '@/domain/workbench/types';

export interface SettingsDraft {
  coordinatePrecision: string;
  customExtension: string;
  extension: OutputExtension;
  footer: string;
  header: string;
  lineEnding: 'lf' | 'crlf';
  machineName: string;
  sourceKey: string;
  workAreaLengthMm: string;
  workAreaWidthMm: string;
}

export function settingsDraftFromWorkbench(workbench: ConnectedWorkbench | null): SettingsDraft {
  if (!workbench) {
    return {
      coordinatePrecision: '3',
      customExtension: '',
      extension: 'iso',
      footer: '',
      header: '',
      lineEnding: 'crlf',
      machineName: '',
      sourceKey: 'none',
      workAreaLengthMm: '',
      workAreaWidthMm: ''
    };
  }

  const output = workbench.manifest.output;
  const profile = workbench.activeMachineProfile;

  return {
    coordinatePrecision: profile.output.coordinatePrecision.toString(),
    customExtension: output.customExtension ?? '',
    extension: output.extension,
    footer: workbench.footer,
    header: workbench.header,
    lineEnding: output.lineEnding,
    machineName: profile.name,
    sourceKey: [
      workbench.adapter.kind,
      workbench.adapter.name,
      workbench.header,
      workbench.footer,
      output.extension,
      output.customExtension ?? '',
      output.lineEnding,
      profile.output.coordinatePrecision,
      profile.name,
      profile.workArea.widthMm ?? '',
      profile.workArea.lengthMm ?? ''
    ].join('\u0000'),
    workAreaLengthMm: profile.workArea.lengthMm?.toString() ?? '',
    workAreaWidthMm: profile.workArea.widthMm?.toString() ?? ''
  };
}

export function workbenchSettingsInputFromDraft(
  activeWorkbench: ConnectedWorkbench,
  draft: SettingsDraft
): UpdateWorkbenchSettingsInput {
  const customExtension = draft.extension === 'custom' ? draft.customExtension : undefined;

  return {
    header: draft.header,
    footer: draft.footer,
    machineProfile: {
      ...activeWorkbench.activeMachineProfile,
      name: draft.machineName,
      templates: {
        header: draft.header,
        footer: draft.footer
      },
      output: {
        extension: draft.extension,
        customExtension,
        lineEnding: draft.lineEnding,
        coordinatePrecision: numberOrNaN(draft.coordinatePrecision)
      },
      workArea: {
        widthMm: numberOrNull(draft.workAreaWidthMm),
        lengthMm: numberOrNull(draft.workAreaLengthMm)
      }
    },
    output: {
      extension: draft.extension,
      customExtension,
      lineEnding: draft.lineEnding,
      coordinatePrecision: numberOrNaN(draft.coordinatePrecision)
    }
  };
}

function numberOrNull(value: string) {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function numberOrNaN(value: string) {
  return value.trim() === '' ? Number.NaN : Number(value);
}
