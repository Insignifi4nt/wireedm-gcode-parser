import { MAX_PORTABLE_UPID_BYTES } from '@/domain/upid/portableUpidProject';
import { DXF_RESOURCE_LIMITS } from '@/domain/dxf/dxfResourceLimits';
import { MAX_MACHINE_PACKAGE_ARCHIVE_BYTES } from '@/domain/machine-package/machinePackageLimits';
import { ToolError } from './siteTools';

/** One immutable browser File, scoped to this tab and workbench. Never resolves paths or URLs. */
export class AgentImportFile {
  private staged: { file: File; fileToken: string } | null = null;
  clear() { this.staged = null; }
  stage(file: File) {
    if (!/\.(dxf|json|wireedm-package)$/i.test(file.name) || /[/\\\u0000-\u001f]/.test(file.name) || file.name.length > 200)
      throw new ToolError('WRONG_FILE', 'Choose a .dxf, .upid.json or .wireedm-package file.');
    const maximum = /\.dxf$/i.test(file.name) ? DXF_RESOURCE_LIMITS.inputBytes
      : /\.wireedm-package$/i.test(file.name) ? MAX_MACHINE_PACKAGE_ARCHIVE_BYTES : MAX_PORTABLE_UPID_BYTES;
    if (file.size > maximum) throw new ToolError('INPUT_TOO_LARGE', `This file exceeds the ${maximum / 1024 / 1024} MiB import limit. DXF, UPID and packages use their normal application limits.`);
    this.staged = { file, fileToken: crypto.randomUUID() };
    return this.summary();
  }
  summary() {
    return this.staged ? { fileToken: this.staged.fileToken, fileName: this.staged.file.name, byteLength: this.staged.file.size } : null;
  }
  get(fileToken: string) {
    if (!this.staged || this.staged.fileToken !== fileToken) throw new ToolError('FILE_TOKEN_STALE', 'Attach the file again in this tab and read edm_workflow_context.inputFile. File tokens do not survive reload or storage changes.');
    return this.staged.file;
  }
  async text(fileToken: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const file = this.get(fileToken);
    const text = await file.text();
    signal.throwIfAborted();
    if (this.get(fileToken) !== file) throw new ToolError('FILE_TOKEN_STALE', 'The attached file changed while reading. Attach and review it again.');
    return { fileName: file.name, text };
  }
}
