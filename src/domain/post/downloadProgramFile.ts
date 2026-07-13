export interface DownloadProgramFileInput {
  fileName: string;
  mimeType?: string;
  text: string;
}

export function downloadProgramFile({
  fileName,
  mimeType = 'text/plain;charset=utf-8',
  text
}: DownloadProgramFileInput) {
  const blob = new Blob([text], {
    type: mimeType
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  try {
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    URL.revokeObjectURL(url);
  }
}
