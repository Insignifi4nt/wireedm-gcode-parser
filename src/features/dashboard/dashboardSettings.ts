import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';
import type { OutputExtension } from '@/domain/workbench/types';

export interface SettingsDraft {
  customExtension: string;
  extension: OutputExtension;
  footer: string;
  header: string;
  lineEnding: 'lf' | 'crlf';
  sourceKey: string;
}

export function settingsDraftFromWorkbench(workbench: ConnectedWorkbench | null): SettingsDraft {
  if (!workbench) {
    return {
      customExtension: '',
      extension: 'iso',
      footer: '',
      header: '',
      lineEnding: 'crlf',
      sourceKey: 'none'
    };
  }

  const output = workbench.manifest.output;

  return {
    customExtension: output.customExtension ?? '',
    extension: output.extension,
    footer: workbench.footer,
    header: workbench.header,
    lineEnding: output.lineEnding,
    sourceKey: [
      workbench.adapter.kind,
      workbench.manifest.updatedAt,
      workbench.header,
      workbench.footer,
      output.extension,
      output.customExtension ?? '',
      output.lineEnding
    ].join('\u0000')
  };
}
