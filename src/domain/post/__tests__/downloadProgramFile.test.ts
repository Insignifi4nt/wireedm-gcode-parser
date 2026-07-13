import { afterEach, describe, expect, it, vi } from 'vitest';

import { downloadProgramFile } from '../downloadProgramFile';

describe('downloadProgramFile', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('downloads generated program text with the requested filename', async () => {
    let downloadedBlob: Blob | undefined;
    let downloadedLink: HTMLAnchorElement | undefined;
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function captureDownloadLink(this: HTMLAnchorElement) {
        downloadedLink = this;
      });
    const createObjectUrl = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation((blob) => {
        downloadedBlob = blob as Blob;
        return 'blob:wire-edm-program';
      });
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    downloadProgramFile({
      fileName: 'part.iso',
      text: 'G90\nG1 X10.000 Y0.000\nM30\n'
    });

    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:wire-edm-program');
    expect(downloadedLink?.download).toBe('part.iso');
    expect(downloadedLink?.href).toBe('blob:wire-edm-program');
    expect(downloadedLink?.rel).toBe('noopener');
    expect(downloadedLink?.isConnected).toBe(false);
    expect(downloadedBlob).toBeInstanceOf(Blob);
    expect(downloadedBlob!.type).toBe('text/plain;charset=utf-8');
    expect(await downloadedBlob!.text()).toBe('G90\nG1 X10.000 Y0.000\nM30\n');
  });

  it('downloads portable JSON with an explicit MIME type', async () => {
    let downloadedBlob: Blob | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      downloadedBlob = blob as Blob;
      return 'blob:wire-edm-profile';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    downloadProgramFile({
      fileName: 'robofil-100.wireedm-machine.json',
      mimeType: 'application/json;charset=utf-8',
      text: '{"format":"wire-edm-machine-profile"}\n'
    });

    expect(downloadedBlob?.type).toBe('application/json;charset=utf-8');
    expect(await downloadedBlob!.text()).toBe('{"format":"wire-edm-machine-profile"}\n');
  });

  it('removes the temporary anchor and revokes the object URL when clicking throws', () => {
    let downloadedLink: HTMLAnchorElement | undefined;
    const clickError = new Error('Synthetic click failure');
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function throwOnClick(
      this: HTMLAnchorElement
    ) {
      downloadedLink = this;
      throw clickError;
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:wire-edm-failed-download');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    expect(() =>
      downloadProgramFile({ fileName: 'part.iso', text: 'M02\n' })
    ).toThrow(clickError);

    expect(downloadedLink?.isConnected).toBe(false);
    expect(revokeObjectUrl).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:wire-edm-failed-download');
  });
});
