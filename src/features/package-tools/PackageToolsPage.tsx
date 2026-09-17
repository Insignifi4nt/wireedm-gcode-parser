import { useEffect, useRef, useState } from 'react';
import { APP_VERSION } from '@/domain/release/appRelease';
import type { AuthoringFile, PackageAuthoringRequest, PackageAuthoringResult } from '@/domain/machine-package/packageAuthoringTools';
import { startPackageTool } from './packageToolsClient';

const MAX_EVIDENCE_BYTES = 64 * 1024 * 1024;
type EvidenceFile = AuthoringFile & { hash: string };
type Mode = 'post' | 'build' | 'inspect';

export function PackageToolsPage() {
  const [mode, setMode] = useState<Mode>('post');
  const [postText, setPostText] = useState('');
  const [documentText, setDocumentText] = useState('');
  const [evidence, setEvidence] = useState<readonly EvidenceFile[]>([]);
  const [archive, setArchive] = useState<File | null>(null);
  const [textPath, setTextPath] = useState('evidence/notes.txt');
  const [evidenceText, setEvidenceText] = useState('');
  const [result, setResult] = useState<PackageAuthoringResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [canCancel, setCanCancel] = useState(false);
  const cancel = useRef<(() => void) | null>(null);
  const requestId = useRef(0);
  useEffect(() => () => { requestId.current++; cancel.current?.(); }, []);
  const base = import.meta.env.BASE_URL;

  function invalidate() { setResult(null); setError(null); }
  async function work(action: () => Promise<void>) {
    const current = ++requestId.current;
    setBusy(true); invalidate();
    try { await action(); }
    catch (reason) { if (current === requestId.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (current === requestId.current) { setBusy(false); setCanCancel(false); cancel.current = null; } }
  }
  async function execute(request: PackageAuthoringRequest) {
    const current = requestId.current;
    const task = startPackageTool(request);
    cancel.current = task.cancel;
    setCanCancel(true);
    const next = await task.result;
    if (current === requestId.current) setResult(next);
  }
  async function readJson(file: File | undefined, kind: 'post' | 'build') {
    if (!file) return;
    await work(async () => {
      const maximum = kind === 'post' ? 1024 * 1024 : MAX_EVIDENCE_BYTES;
      if (file.size > maximum) throw new Error(`JSON exceeds the ${maximum / 1024 / 1024} MiB limit.`);
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      if (kind === 'post') setPostText(text); else setDocumentText(text);
    });
  }
  async function addFiles(files: readonly File[]) {
    await work(async () => {
      if (evidence.length + files.length > 2047 || evidence.reduce((sum, file) => sum + file.bytes.byteLength, 0) + files.reduce((sum, file) => sum + file.size, 0) > MAX_EVIDENCE_BYTES) {
        throw new Error('Evidence exceeds 2,047 files or 64 MiB.');
      }
      const additions: EvidenceFile[] = [];
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        additions.push({ path: `evidence/${file.name}`, bytes, hash: await hash(bytes) });
      }
      setEvidence((previous) => [...previous, ...additions]);
    });
  }
  async function reusePackage() {
    const output = result?.output;
    if (!output) return;
    await work(async () => {
      const files = [];
      for (const file of output.files) files.push({ ...file, hash: await hash(file.bytes) });
      setDocumentText(output.documentText); setEvidence(files); setMode('build');
    });
  }
  function download(name: string, data: string | Uint8Array) {
    try {
      const payload = typeof data === 'string' ? data : new Uint8Array(data).buffer;
      const url = URL.createObjectURL(new Blob([payload], { type: typeof data === 'string' ? 'application/json' : 'application/octet-stream' }));
      const link = document.createElement('a'); link.href = url; link.download = name;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) { setError(`Download failed: ${reason instanceof Error ? reason.message : String(reason)}`); }
  }

  return <>
    <header><a href={base}>Wire EDM Workbench</a><span>Package workbench · {APP_VERSION}</span><a href={`${base}documentation/`}>Documentation</a></header>
    <main>
      <h1>Build and check a machine package</h1>
      <p>Work with JSON and evidence files in this browser. Checks run locally; nothing is installed, saved to your project library, or sent to a server. Download your work before leaving this page.</p>
      <nav aria-label="Package tools">{(['post', 'build', 'inspect'] as const).map((value) => <button key={value} aria-pressed={mode === value} disabled={busy} onClick={() => { setMode(value); invalidate(); }} type="button">{{ post: 'Check post', build: 'Build package', inspect: 'Inspect package' }[value]}</button>)}</nav>
      <fieldset disabled={busy}>
        {mode === 'post' && <section aria-label="Check post">
          <h2>Check a post and calculate its hash</h2>
          <p>Paste or choose a .wireedm-post.json file. The report includes its canonical content hash and fixture results. Use that hash in the machine setup’s exact post reference.</p>
          <label>Post JSON file<input type="file" accept=".json,application/json" onChange={(event) => { void readJson(event.target.files?.[0], 'post'); event.target.value = ''; }} /></label>
          <label>Post JSON<textarea value={postText} onChange={(event) => { setPostText(event.target.value); invalidate(); }} spellCheck={false} /></label>
          <button disabled={!postText.trim()} onClick={() => void work(() => execute({ operation: 'check-post', text: postText }))} type="button">Validate post and run conformance</button>
        </section>}
        {mode === 'build' && <section aria-label="Build package">
          <h2>Build a complete package</h2>
          <p>The <a href={`${base}documentation/reference/docs/post-authoring/v1/schema/machine-package.schema.json`}>package document</a> contains the manifest, physical machine, complete setups and posts. Add every referenced evidence file and match its path and SHA-256 in the document.</p>
          <label>Package document file<input type="file" accept=".json,application/json" onChange={(event) => { void readJson(event.target.files?.[0], 'build'); event.target.value = ''; }} /></label>
          <label>Package document JSON<textarea value={documentText} onChange={(event) => { setDocumentText(event.target.value); invalidate(); }} spellCheck={false} /></label>
          <label>Add evidence files<input type="file" multiple onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) void addFiles(files); }} /></label>
          <details><summary>Add text evidence</summary><label>Text evidence path<input value={textPath} onChange={(event) => setTextPath(event.target.value)} /></label><label>Evidence text<textarea value={evidenceText} onChange={(event) => setEvidenceText(event.target.value)} /></label><button type="button" disabled={!textPath.trim() || !evidenceText} onClick={() => void work(async () => {
            const bytes = new TextEncoder().encode(evidenceText);
            if (evidence.length >= 2047 || bytes.byteLength + evidence.reduce((sum, file) => sum + file.bytes.byteLength, 0) > MAX_EVIDENCE_BYTES) throw new Error('Evidence exceeds the package limits.');
            setEvidence([...evidence, { path: textPath, bytes, hash: await hash(bytes) }]); setEvidenceText('');
          })}>Add text file</button></details>
          <ul className="evidence-list">{evidence.map((file, index) => <li key={index}>
            <label>Evidence path {index + 1}<input value={file.path} onChange={(event) => { const path = event.target.value; setEvidence(evidence.map((item, itemIndex) => itemIndex === index ? { ...item, path } : item)); invalidate(); }} /></label>
            <span>{file.bytes.byteLength} bytes · SHA-256</span><code>{file.hash}</code>
            <button type="button" onClick={() => { setEvidence(evidence.filter((_, itemIndex) => itemIndex !== index)); invalidate(); }}>Remove evidence {index + 1}</button>
          </li>)}</ul>
          <button disabled={!documentText.trim()} type="button" onClick={() => void work(() => execute({ operation: 'build-package', text: documentText, files: evidence }))}>Validate and build package</button>
        </section>}
        {mode === 'inspect' && <section aria-label="Inspect package">
          <h2>Validate an existing package</h2>
          <p>Choose a .wireedm-package to check its structure, evidence, exact bindings and post conformance. Safely readable contents can become editable build input even if validation fails; they must pass all checks before a rebuilt package is available.</p>
          <label>Machine package file<input type="file" accept=".wireedm-package,application/zip" onChange={(event) => { setArchive(event.target.files?.[0] ?? null); invalidate(); }} /></label>
          <button disabled={!archive} type="button" onClick={() => void work(async () => {
            if (!archive) return;
            if (archive.size > 32 * 1024 * 1024) throw new Error('Package exceeds the 32 MiB archive limit.');
            await execute({ operation: 'inspect-package', bytes: new Uint8Array(await archive.arrayBuffer()) });
          })}>Validate and inspect package</button>
        </section>}
      </fieldset>
      {busy && <p role="status">Checking inputs… {canCancel && <button type="button" onClick={() => cancel.current?.()}>Cancel check</button>}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {result && <section aria-label="Check results" className="results">
        <h2>{result.report.ok ? 'Checks passed' : 'Checks failed'}</h2>
        <p role="status">{result.report.ok ? 'Software validation completed. This does not certify physical machine behavior.' : 'Review the diagnostics and correct the inputs before building or installing.'}</p>
        <button type="button" onClick={() => download('package-check-report.json', JSON.stringify(result.report, null, 2))}>Download report</button>
        {result.output?.archive && <button type="button" onClick={() => download(result.output!.fileName!, result.output!.archive!)}>Download .wireedm-package</button>}
        {result.output && <button type="button" onClick={() => download('wireedm-package.json', result.output!.documentText)}>Download package document</button>}
        {result.output && mode === 'inspect' && <button type="button" onClick={() => void reusePackage()}>Use as build input</button>}
        <label>Validation report<textarea className="report" readOnly value={JSON.stringify(result.report, null, 2)} onFocus={(event) => event.currentTarget.select()} /></label>
      </section>}
    </main>
  </>;
}

async function hash(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
