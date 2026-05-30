import {
  FOOTER_TEMPLATE_PATH,
  HEADER_TEMPLATE_PATH,
  WORKBENCH_MANIFEST_FILE,
  type ConnectedWorkbench,
  type WorkbenchManifest
} from './workbenchStorage';

export interface UpdateWorkbenchSettingsInput {
  header?: string;
  footer?: string;
  output?: Partial<WorkbenchManifest['output']>;
  now?: Date;
}

export async function updateWorkbenchSettings(
  workbench: ConnectedWorkbench,
  input: UpdateWorkbenchSettingsInput
): Promise<ConnectedWorkbench> {
  const header = input.header ?? workbench.header;
  const footer = input.footer ?? workbench.footer;
  const output = {
    ...workbench.manifest.output,
    ...input.output
  };

  if (output.extension !== 'custom') {
    delete output.customExtension;
  } else if (typeof output.customExtension === 'string') {
    output.customExtension = output.customExtension.trim().replace(/^\.+/, '').toLowerCase();
  }

  const updatedManifest: WorkbenchManifest = {
    ...workbench.manifest,
    updatedAt: (input.now ?? new Date()).toISOString(),
    output
  };

  await workbench.adapter.writeText(HEADER_TEMPLATE_PATH, header);
  await workbench.adapter.writeText(FOOTER_TEMPLATE_PATH, footer);
  await workbench.adapter.writeText(
    WORKBENCH_MANIFEST_FILE,
    JSON.stringify(updatedManifest, null, 2)
  );

  return {
    ...workbench,
    header,
    footer,
    manifest: updatedManifest
  };
}
