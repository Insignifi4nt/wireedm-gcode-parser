import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useEffect, useRef, useState } from 'react';
import { AddIcon, CloseIcon, FileCodeIcon, NavigateBackIcon, SearchIcon } from '@wire-edm/icons-react';
import { BUNDLED_CAD_PLUGINS, CAD_LINKED_RECIPE_EXAMPLE, type CadPluginPackage } from '@/domain/cad/plugins/cadPlugins';
import { reviewCadPluginSource, type listCadPlugins } from '@/domain/cad/plugins/cadPluginStorage';

export interface CadPluginCommands {
  onListPlugins?(): ReturnType<typeof listCadPlugins>;
  onInstallPlugin?(text: string): Promise<unknown>;
}
export function CadPluginsPanel({ onClose, onAdd, onListPlugins, onInstallPlugin }: CadPluginCommands & { onClose(): void; onAdd(plugin: CadPluginPackage): void }) {
  const [packages, setPackages] = useState<readonly CadPluginPackage[]>(BUNDLED_CAD_PLUGINS);
  const [source, setSource] = useState('');
  const [reviewed, setReviewed] = useState<CadPluginPackage | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [view, setView] = useState<'library' | 'author'>('library');
  const [search, setSearch] = useState('');
  const panel = useRef<HTMLElement>(null);
  const authorInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => { if (view === 'author') authorInput.current?.focus(); else panel.current?.querySelector<HTMLInputElement>('input')?.focus(); }, [view]);
  useEffect(() => {
    const controller = new AbortController();
    if (onListPlugins) void onListPlugins().then(result => {
      if (!controller.signal.aborted) { setPackages(result.packages); setNotice([...result.diagnostics.map(item => `${item.path}: ${item.message}`), ...(result.truncated ? ['Plugin listing is truncated. Originals remain preserved.'] : [])].join('\n')); }
    }).catch(error => { if (!controller.signal.aborted) setError(String(error)); });
    return () => controller.abort();
  }, [onListPlugins]);
  const setText = (text: string) => { setSource(text); setReviewed(null); setError(''); };
  const visiblePackages = packages.filter(plugin => `${plugin.name} ${plugin.description} ${plugin.id}`.toLowerCase().includes(search.toLowerCase().trim()));
  return <div className="cad-plugin-overlay"><section ref={panel} className={`cad-plugin-panel ${view === 'author' ? 'is-authoring' : ''}`} role="dialog" aria-modal="true" aria-label="CAD plugins" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); }
    if (event.key === 'Tab') {
      const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), summary') ?? []).filter(control => !control.closest('details:not([open])') || control.tagName === 'SUMMARY');
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <header><strong>{view === 'library' ? 'Add a profile' : 'Plugin authoring'}</strong><Button type="button" className="cad-plugin-icon-button" aria-label="Close" disabled={busy} onClick={onClose}><CloseIcon size={16} /></Button></header>
    {view === 'library' ? <>
      <label className="cad-plugin-search"><SearchIcon size={14} /><Input aria-label="Search plugins" placeholder="Search profiles…" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <div className="cad-plugin-list">{visiblePackages.map(plugin => <article key={`${plugin.id}@${plugin.version}`}>
        <div className="cad-plugin-row-copy"><div><strong>{plugin.name}</strong><small>v{plugin.version}</small></div><p>{plugin.description}</p></div>
        <Button type="button" className="cad-plugin-icon-button" aria-label={`View package ${plugin.name} ${plugin.version}`} title="View package" disabled={busy} onClick={() => { setText(JSON.stringify(plugin, null, 2)); setView('author'); }}><FileCodeIcon size={15} /></Button>
        <Button variant="primary" type="button" className="cad-primary" aria-label={`Add ${plugin.name}`} disabled={busy} onClick={() => onAdd(plugin)}><AddIcon size={13} /> Add</Button>
      </article>)}</div>
      {!visiblePackages.length && <p className="cad-plugin-empty">No matching profiles.</p>}
      <footer><span>Profiles rebuild with your part.</span><Button type="button" onClick={() => setView('author')}>Author or install a plugin</Button></footer>
    </> : <>
      <div className="cad-plugin-author-toolbar"><Button type="button" disabled={busy} onClick={() => setView('library')}><NavigateBackIcon size={13} /> Profiles</Button><Button type="button" disabled={busy} onClick={() => setText(JSON.stringify(CAD_LINKED_RECIPE_EXAMPLE, null, 2))}>Load recipe example</Button></div>
      <label className="cad-plugin-source"><span>Package JSON</span><Textarea ref={authorInput} aria-label="Plugin package JSON" rows={14} value={source} disabled={busy} onChange={event => setText(event.target.value)} spellCheck={false} /></label>
      <details className="cad-plugin-author-help"><summary>Recipe reference</summary><p>Recipes use bounded arithmetic, min/max and sin, cos, tan, sqrt, atan and abs in radians. API v2 also supports derived values, dependent limits, choices and conditions. Packages cannot access network, files or application state.</p></details>
      <div className="cad-plugin-author-actions"><Button type="button" disabled={busy || !source} onClick={() => { try { setReviewed(reviewCadPluginSource(source)); setError(''); } catch (error) { setReviewed(null); setError(String(error)); } }}>Validate package</Button>
      {reviewed && <Button variant="primary" type="button" className="cad-primary" disabled={busy || !onInstallPlugin} onClick={async () => {
        if (!onInstallPlugin) return;
        setBusy(true); setError('');
        try { await onInstallPlugin(source); if (onListPlugins) setPackages((await onListPlugins()).packages); setNotice(`${reviewed.name} v${reviewed.version} installed.`); setReviewed(null); setView('library'); }
        catch (error) { setError(String(error)); }
        finally { setBusy(false); }
      }}>{busy ? 'Installing…' : 'Install validated package'}</Button>}</div>
      {reviewed && <p className="cad-plugin-review" role="status">Ready: {reviewed.name} v{reviewed.version}. Existing parts keep their saved version.</p>}
    </>}
    {notice && <p className="cad-plugin-notice" role="status">{notice}</p>}{error && <p role="alert" className="cad-error">{error}</p>}
  </section></div>;
}
