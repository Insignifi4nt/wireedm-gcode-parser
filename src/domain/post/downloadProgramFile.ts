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
    // The browser starts the download after the click handler returns.
    // Revoking here can invalidate the URL before it has been read.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  } finally {
    link.remove();
  }
}
