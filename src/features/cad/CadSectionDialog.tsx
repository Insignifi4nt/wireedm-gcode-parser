import { useEffect, useRef, useState } from 'react';
import type { CadMesh, CadPlane } from '@/domain/cad/cadDocument';
import type { CadSectionRequest, CadSectionResult } from '@/domain/cad/cadSection';
import type { DxfEntity } from '@/domain/dxf/types';

/** Display exact analytic curves. This preview never becomes the machining source. */
function SectionPreview({ entities }: { entities: readonly DxfEntity[] }) {
  const points = entities.flatMap(entity => entity.type === 'line' || entity.type === 'arc'
    ? entity.type === 'line' ? [entity.start, entity.end] : [entity.start, entity.end,
      { x: entity.center.x - entity.radius, y: entity.center.y - entity.radius }, { x: entity.center.x + entity.radius, y: entity.center.y + entity.radius }]
    : entity.type === 'circle' ? [{ x: entity.center.x - entity.radius, y: entity.center.y - entity.radius }, { x: entity.center.x + entity.radius, y: entity.center.y + entity.radius }] : []);
  if (!points.length) return null;
  const minX = Math.min(...points.map(p => p.x)); const maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y)); const maxY = Math.max(...points.map(p => p.y));
  const margin = Math.max(maxX - minX, maxY - minY, 1) * 0.08;
  return <svg aria-label="Exact section preview" role="img" className="h-72 w-full bg-[#152029]" viewBox={`${minX - margin} ${-maxY - margin} ${maxX - minX + 2 * margin} ${maxY - minY + 2 * margin}`}>
    <g transform="scale(1,-1)" fill="none" stroke="#79c8e6" strokeWidth={1.5}>
      {entities.map((entity, index) => {
        if (entity.type === 'line') return <line key={index} vectorEffect="non-scaling-stroke" x1={entity.start.x} y1={entity.start.y} x2={entity.end.x} y2={entity.end.y} />;
        if (entity.type === 'circle') return <circle key={index} vectorEffect="non-scaling-stroke" cx={entity.center.x} cy={entity.center.y} r={entity.radius} />;
        if (entity.type !== 'arc') return null;
        const sweep = Math.abs(entity.sweepRadians ?? ((entity.clockwise ? entity.startAngle - entity.endAngle : entity.endAngle - entity.startAngle) + 2 * Math.PI) % (2 * Math.PI));
        return <path key={index} vectorEffect="non-scaling-stroke" d={`M ${entity.start.x} ${entity.start.y} A ${entity.radius} ${entity.radius} 0 ${sweep > Math.PI ? 1 : 0} ${entity.clockwise ? 0 : 1} ${entity.end.x} ${entity.end.y}`} />;
      })}
    </g>
  </svg>;
}

export function CadSectionDialog({ bodies, initialBodyId, version, onClose, onInspect, onSend }: {
  bodies: readonly Pick<CadMesh, 'featureId' | 'name'>[];
  initialBodyId: string;
  version: string;
  onClose(): void;
  onInspect(request: CadSectionRequest, version: string, signal: AbortSignal): Promise<CadSectionResult>;
  onSend(request: CadSectionRequest, version: string, signal: AbortSignal): Promise<unknown>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef<AbortController | null>(null);
  const [bodyId, setBodyId] = useState(initialBodyId);
  const [plane, setPlane] = useState<CadPlane>('XY');
  const [offset, setOffset] = useState('0');
  const [result, setResult] = useState<CadSectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'inspect' | 'send' | null>(null);
  const [reviewed, setReviewed] = useState<string | null>(null);
  const request: CadSectionRequest = { bodyId, plane, offset };
  const requestKey = JSON.stringify([version, request]);
  const currentKey = useRef(requestKey); currentKey.current = requestKey;
  useEffect(() => { dialog.current?.showModal(); return () => { pending.current?.abort(); }; }, []);
  async function execute(kind: 'inspect' | 'send') {
    if (pending.current || kind === 'send' && reviewed !== requestKey) return;
    const controller = new AbortController(); pending.current = controller;
    setBusy(kind); setError(null);
    try {
      if (kind === 'inspect') {
        const next = await onInspect(request, version, controller.signal);
        if (!controller.signal.aborted && currentKey.current === requestKey) { setResult(next); setReviewed(requestKey); }
      } else {
        await onSend(request, version, controller.signal);
        // A successful storage receipt remains successful even if cancellation arrived late.
        onClose();
      }
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Section operation failed.');
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(null); }
    }
  }
  const button = 'border border-border px-3 py-1.5 text-xs disabled:opacity-40 hover:bg-accent';
  const input = 'mt-1 w-full border border-border bg-background px-2 py-1.5 text-xs';
  return <dialog ref={dialog} aria-label="Section for CAM" className="m-auto w-[720px] max-h-[85vh] overflow-auto border border-border bg-card p-0 text-foreground backdrop:bg-black/60"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); else if (busy === 'inspect') pending.current?.abort(); }}>
    <div className="flex items-center justify-between border-b border-border px-4 py-3"><h2 className="text-sm font-semibold">Section for CAM</h2><button className={button} disabled={busy !== null} onClick={onClose}>Close</button></div>
    <div className="space-y-3 p-4 text-xs">
      <p className="text-muted-foreground">Cut the final solid with a plane and transfer its exact closed contours. The preview includes downstream cuts and Boolean operations.</p>
      <div className="grid grid-cols-[2fr_1fr_1fr] gap-3">
        <label>Solid body<select className={input} value={bodyId} disabled={busy !== null} onChange={event => setBodyId(event.target.value)}>{bodies.map(body => <option key={body.featureId} value={body.featureId}>{body.name}</option>)}</select></label>
        <label>Section plane<select className={input} value={plane} disabled={busy !== null} onChange={event => { if (event.target.value === 'XY' || event.target.value === 'XZ' || event.target.value === 'YZ') setPlane(event.target.value); }}><option>XY</option><option>XZ</option><option>YZ</option></select></label>
        <label>Plane offset (mm)<input className={input} value={offset} disabled={busy !== null} onChange={event => setOffset(event.target.value)} /></label>
      </div>
      <p className="text-muted-foreground">Offset follows {plane === 'XY' ? '+Z' : plane === 'XZ' ? '−Y' : '+X'}. Use a plane inside the material. Ellipse and spline sections are reported as unsupported.</p>
      <div className="flex items-center gap-3"><button className={button} disabled={busy !== null || !bodies.length} onClick={() => { void execute('inspect'); }}>Preview section</button>{busy === 'inspect' && <button className={button} onClick={() => pending.current?.abort()}>Cancel section</button>}<span role="status">{busy === 'inspect' ? 'Computing exact section…' : busy === 'send' ? 'Saving CAD and creating CAM project…' : reviewed === requestKey && result ? `${result.contourCount} closed contours · ${result.entities.length} analytic curves` : 'Preview the current plane before sending.'}</span></div>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {reviewed === requestKey && result && <SectionPreview entities={result.entities} />}
      <div className="flex items-center justify-between gap-6 border-t border-border pt-3"><p className="text-muted-foreground">Saves CAD, then opens a new detached CAM project in local plane coordinates. Review stock, wire and machining settings in CAM.</p><button className={`${button} shrink-0 bg-primary text-primary-foreground`} disabled={busy !== null || reviewed !== requestKey} onClick={() => { void execute('send'); }}>Send section to CAM</button></div>
    </div>
  </dialog>;
}
