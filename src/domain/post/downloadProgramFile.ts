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
  link.hidden = true;
  try {
    document.body.append(link);
    link.click();
    // The browser starts the download after the click handler returns.
    // Keep the anchor and its URL alive while the browser handles it.
    window.setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(url);
    }, 60_000);
  } catch (error) {
    link.remove();
    URL.revokeObjectURL(url);
    throw error;
  }
}
