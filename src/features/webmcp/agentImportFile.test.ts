import { File as NodeFile } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { AgentImportFile } from './agentImportFile';
class File extends globalThis.File {
  private original: NodeFile;
  constructor(parts: string[], name: string) { super(parts, name); this.original = new NodeFile(parts, name); }
  override text() { return this.original.text(); }
}

describe('browser-local file tokens', () => {
  it('reads more than the inline limit without embedding text, and replaces/clears old tokens', async () => {
    const files = new AgentImportFile();
    const text = '界'.repeat(400_000);
    const first = files.stage(new File([text], 'large.upid.json'));
    expect(first).toMatchObject({ byteLength: 1_200_000, fileName: 'large.upid.json' });
    if (!first) throw new Error('No token');
    expect(JSON.stringify(first).length).toBeLessThan(200);
    expect(await files.text(first.fileToken, new AbortController().signal)).toEqual({ fileName: 'large.upid.json', text });
    files.stage(new File(['replacement'], 'part.dxf'));
    expect(() => files.get(first.fileToken)).toThrow('Attach the file again');
    files.clear(); expect(files.summary()).toBeNull();
  });
  it('rejects paths, unsupported input and oversized attachments before reading, preserving the previous file', () => {
    const files = new AgentImportFile();
    files.stage(new File(['ok'], 'part.dxf'));
    const before = files.summary();
    expect(() => files.stage(new File(['bad'], 'secret.txt'))).toThrow('Choose a');
    expect(() => files.stage(new File(['bad'], 'folder/part.dxf'))).toThrow('Choose a');
    const large = new File([], 'large.upid.json');
    Object.defineProperty(large, 'size', { value: 64 * 1024 * 1024 + 1 });
    expect(() => files.stage(large)).toThrow('64 MiB');
    expect(files.summary()).toEqual(before);
  });
  it('rejects cancellation and attachment replacement while an asynchronous read is pending', async () => {
    const files = new AgentImportFile();
    const file = new File(['original'], 'part.dxf');
    let resolve!: (text: string) => void;
    vi.spyOn(file, 'text').mockImplementation(() => new Promise(done => { resolve = done; }));
    const token = files.stage(file)!;
    const reading = files.text(token.fileToken, new AbortController().signal);
    files.stage(new File(['new'], 'part.dxf')); resolve('original');
    await expect(reading).rejects.toMatchObject({ code: 'FILE_TOKEN_STALE' });
    const current = files.summary()!, cancel = new AbortController(); cancel.abort();
    await expect(files.text(current.fileToken, cancel.signal)).rejects.toHaveProperty('name', 'AbortError');
  });
});
