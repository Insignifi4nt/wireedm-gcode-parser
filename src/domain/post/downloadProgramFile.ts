export interface DownloadProgramFileInput {
  fileName: string;
  text: string;
}

export function downloadProgramFile({ fileName, text }: DownloadProgramFileInput) {
  const blob = new Blob([text], {
    type: 'text/plain;charset=utf-8'
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
