interface WritableFile {
  write(data: string): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

export interface SelectedTextFile {
  createWritable(): Promise<WritableFile>;
}

type SavePicker = (options: { suggestedName: string; types: Array<{
  description: string;
  accept: Record<string, string[]>;
}> }) => Promise<SelectedTextFile>;

export function supportsSaveTextFileAs() {
  return typeof (window as Window & { showSaveFilePicker?: SavePicker }).showSaveFilePicker === 'function';
}

export async function selectTextFileDestination(fileName: string): Promise<SelectedTextFile> {
  const picker = (window as Window & { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (!picker) throw new Error('Save As is unavailable in this browser.');
  return picker.call(window, {
    suggestedName: fileName,
    types: [{ description: 'UPID project', accept: { 'application/json': ['.json'] } }]
  });
}

export async function writeSelectedTextFile(handle: SelectedTextFile, text: string) {
  const writable = await handle.createWritable();
  try {
    await writable.write(text);
    await writable.close();
  } catch (error) {
    await writable.abort?.().catch(() => undefined);
    throw error;
  }
}
