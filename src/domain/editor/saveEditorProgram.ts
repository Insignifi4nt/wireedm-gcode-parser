import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';

import { parseGCodeProgram } from './gcodeParser';
import type { LoadedEditorProgram } from './loadEditorProgram';

export interface SaveEditorProgramInput {
  filePath: string;
  text: string;
}

export async function saveEditorProgram(
  workbench: ConnectedWorkbench,
  input: SaveEditorProgramInput
): Promise<LoadedEditorProgram> {
  const existingText = await workbench.adapter.readText(input.filePath);
  if (existingText === null) {
    throw new Error(`Editor program file not found: ${input.filePath}`);
  }

  await workbench.adapter.writeText(input.filePath, input.text);

  return {
    filePath: input.filePath,
    text: input.text,
    parseResult: parseGCodeProgram(input.text)
  };
}
