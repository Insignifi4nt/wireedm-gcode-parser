import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { downloadProgramFile } from '@/domain/post/downloadProgramFile';
import { inspectWorkbenchStorage, type WorkbenchStorageReport } from '@/domain/storage/workbenchStorageReport';
import type { ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';

export function StorageReviewPanel({ workbench, disabled }: { workbench: ConnectedWorkbenchCatalog; disabled: boolean }) {
  const [report, setReport] = useState<WorkbenchStorageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    setReport(null); setError(null); setScanning(false);
    return () => { generation.current++; };
  }, [workbench]);
  async function scan() {
    const current = ++generation.current;
    setScanning(true); setError(null); setReport(null);
    try {
      const result = await inspectWorkbenchStorage(workbench);
      if (current === generation.current) setReport(result);
    } catch (failure) {
      if (current === generation.current) setError(failure instanceof Error ? failure.message : 'Storage review failed.');
    } finally {
      if (current === generation.current) setScanning(false);
    }
  }
  return <section>
    <h3 className="text-xs font-semibold">Storage review</h3>
    <p className="mt-2 text-muted-foreground">List project files, retained migration backups and files outside the project index. This review does not change or delete files. Unreferenced files may still contain useful data.</p>
    <Button className="mt-3" disabled={disabled || scanning || !workbench.adapter.listFiles} onClick={scan} variant="outline">{scanning ? 'Reviewing storage…' : 'Review storage'}</Button>
    {error && <p className="mt-2 text-destructive" role="alert">{error}</p>}
    {report && <div className="mt-3 border-t border-border pt-3" aria-live="polite">
      <p>{report.files.length} files listed · {report.files.filter(({ category }) => category === 'referenced').length} referenced · {report.files.filter(({ category }) => category === 'retained-backup').length} retained backups · {report.files.filter(({ category }) => category === 'unreferenced').length} unreferenced</p>
      {!report.complete && <p className="mt-2 text-amber-400">Review incomplete or needs attention. Do not use this report to decide which files to delete.</p>}
      {report.problems.slice(0, 10).map((problem, index) => <p className="mt-1 break-words text-muted-foreground" key={index}>{problem}</p>)}
      {report.files.some(({ category }) => category === 'unreferenced') && <ul className="mt-2 list-inside list-disc break-all text-muted-foreground">{report.files.filter(({ category }) => category === 'unreferenced').slice(0, 10).map(({ path }) => <li key={path}>{path}</li>)}</ul>}
      <Button className="mt-3" onClick={() => downloadProgramFile({ fileName: 'wire-edm-storage-review.json', text: `${JSON.stringify(report, null, 2)}\n`, mimeType: 'application/json' })} variant="outline">Download full storage report</Button>
      <p className="mt-2 text-muted-foreground">The report contains file paths and diagnostics, not project contents. Browser cache can be lost when site data is cleared; retained backups share that storage.</p>
    </div>}
  </section>;
}
