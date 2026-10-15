import { Button } from '@/components/ui/button';
import { Component, useEffect, useRef, useState, type ReactNode } from 'react';

export interface CadWorkspaceBoundaryProps {
  readonly children: ReactNode;
  readonly documentName: string;
  readonly busy: boolean;
  onSave(): Promise<unknown>;
  onDownloadDocument(): unknown | Promise<unknown>;
  onFailure(error: Error): void;
}

type RecoveryState = { readonly kind: 'idle' }
  | { readonly kind: 'busy' | 'success'; readonly action: 'save' | 'download' }
  | { readonly kind: 'error'; readonly message: string };

function CadWorkspaceRecovery({ documentName, busy, onSave, onDownloadDocument }: Omit<CadWorkspaceBoundaryProps, 'children' | 'onFailure'>) {
  const [state, setState] = useState<RecoveryState>({ kind: 'idle' });
  const pending = useRef(false); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const recover = async (action: 'save' | 'download') => {
    if (busy || pending.current) return;
    pending.current = true; setState({ kind: 'busy', action });
    try {
      await (action === 'save' ? onSave() : onDownloadDocument());
      if (mounted.current) setState({ kind: 'success', action });
    } catch (error) {
      if (mounted.current) setState({ kind: 'error', message: error instanceof Error ? error.message : 'The document could not be preserved. Try again.' });
    } finally { pending.current = false; }
  };
  const disabled = busy || state.kind === 'busy';
  return <section aria-label="CAD workspace recovery" className="flex min-h-0 flex-1 items-center justify-center bg-slate-950 p-6 text-xs text-slate-200">
    <div className="max-w-md space-y-3">
      <p role="alert" className="font-semibold">The CAD workspace could not be displayed.</p>
      <p>Your accepted document, <strong>{documentName}</strong>, is still available. Save or download your draft before reloading this page.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={disabled} onClick={() => { void recover('save'); }} className="rounded border border-slate-600 px-3 py-2 disabled:opacity-40">Save current document</Button>
        <Button type="button" disabled={disabled} onClick={() => { void recover('download'); }} className="rounded border border-slate-600 px-3 py-2 disabled:opacity-40">Download CAD document</Button>
      </div>
      {state.kind === 'busy' && <p role="status">{state.action === 'save' ? 'Saving document…' : 'Preparing CAD document download…'}</p>}
      {state.kind === 'success' && <p role="status">{state.action === 'save' ? 'Document saved.' : 'CAD document download requested. Check that the file was downloaded before reloading.'}</p>}
      {state.kind === 'error' && <p role="alert">{state.message}</p>}
    </div>
  </section>;
}

/** Keep this boundary below the session/controller owner, outside the lazy CAD module. */
export class CadWorkspaceBoundary extends Component<CadWorkspaceBoundaryProps, { readonly failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { this.props.onFailure(error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <CadWorkspaceRecovery documentName={this.props.documentName} busy={this.props.busy}
      onSave={this.props.onSave} onDownloadDocument={this.props.onDownloadDocument} />;
  }
}
