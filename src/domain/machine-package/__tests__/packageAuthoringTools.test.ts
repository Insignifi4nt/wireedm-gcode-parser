import { describe, expect, it } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { runPackageAuthoringTool } from '../packageAuthoringTools';
import { machinePackageFixture } from './machinePackageFixture';
import { hashPostPackage } from '@/domain/post-processor/postLibrary';

describe('browser package authoring operations', () => {
  it('checks pasted post JSON, returns the exact canonical hash and rejects malformed input', async () => {
    const fixture = await machinePackageFixture();
    const checked = await runPackageAuthoringTool({ operation: 'check-post', text: JSON.stringify(fixture.document.posts[0]) });
    expect(checked.report).toMatchObject({ ok: true, details: { post: { contentHash: await hashPostPackage(fixture.document.posts[0]) }, conformance: { ok: true } } });
    expect(checked.output).toBeUndefined();
    expect((await runPackageAuthoringTool({ operation: 'check-post', text: '{' })).report).toMatchObject({ ok: false, details: { diagnostics: [{ code: 'POST_PACKAGE_JSON_INVALID' }] } });
  });

  it('builds and reopens the exact package using only browser inputs without changing them', async () => {
    const fixture = await machinePackageFixture();
    const text = JSON.stringify(fixture.document);
    const files = Object.entries(fixture.files).map(([path, bytes]) => ({ path, bytes }));
    const built = await runPackageAuthoringTool({ operation: 'build-package', text, files });
    expect(built.report.ok).toBe(true);
    expect(built.output?.fileName).toMatch(/\.wireedm-package$/);
    const inspected = await runPackageAuthoringTool({ operation: 'inspect-package', bytes: built.output!.archive! });
    expect(inspected.report).toMatchObject({ ok: true, details: { archiveHash: (built.report.details as { archiveHash: string }).archiveHash } });
    expect(JSON.parse(inspected.output!.documentText)).toEqual(JSON.parse(built.output!.documentText));
    const evidenceBytes = (entries: typeof files) => entries.map(({ path, bytes }) => ({ path, bytes: Array.from(bytes) }));
    expect(evidenceBytes([...inspected.output!.files])).toEqual(evidenceBytes(files));
    expect(JSON.stringify(fixture.document)).toBe(text);
  });

  it('rejects duplicate paths, altered evidence and invalid documents without a package download', async () => {
    const fixture = await machinePackageFixture();
    const text = JSON.stringify(fixture.document);
    const files = Object.entries(fixture.files).map(([path, bytes]) => ({ path, bytes }));
    for (const request of [
      { text, files: [...files, files[0]] },
      { text, files: [{ ...files[0], bytes: strToU8('altered evidence') }] },
      { text: '{}', files: [] }
    ]) {
      const result = await runPackageAuthoringTool({ operation: 'build-package', ...request });
      expect(result.report.ok).toBe(false);
      expect(result.output).toBeUndefined();
    }
  });

  it('allows repairing readable rejected packages, but never extracts unsafe archive paths', async () => {
    const fixture = await machinePackageFixture();
    const built = await runPackageAuthoringTool({ operation: 'build-package', text: JSON.stringify(fixture.document), files: Object.entries(fixture.files).map(([path, bytes]) => ({ path, bytes })) });
    const entries = unzipSync(built.output!.archive!);
    entries['wireedm-package.json'] = strToU8(JSON.stringify({ ...fixture.document, schemaVersion: 999 }));
    const broken = await runPackageAuthoringTool({ operation: 'inspect-package', bytes: zipSync(entries) });
    expect(broken.report.ok).toBe(false);
    expect(broken.output?.archive).toBeUndefined();
    expect(JSON.parse(broken.output!.documentText).schemaVersion).toBe(999);
    entries['../escape.txt'] = strToU8('unsafe');
    const unsafe = await runPackageAuthoringTool({ operation: 'inspect-package', bytes: zipSync(entries) });
    expect(unsafe.report.ok).toBe(false);
    expect(unsafe.output).toBeUndefined();
  });
});
