import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import type { CadDocument } from '@/domain/cad/cadDocument';
import { MAX_CAD_LOFT_SECTIONS, MIN_CAD_LOFT_SECTIONS } from '@/domain/cad/cadLoft';
import { inspectCadLoftCandidates } from './cadLoftUi';

export function CadLoftSections({ document, featureId, sketchIds, onChange }: {
  document: CadDocument;
  featureId: string;
  sketchIds: readonly string[];
  onChange(sketchIds: readonly string[]): void;
}) {
  // Region analysis belongs to the immutable document, not each draft field edit.
  const candidates = useMemo(() => inspectCadLoftCandidates(document, featureId), [document.features, document.parameters, featureId]);
  const candidatesById = useMemo(() => new Map(candidates.map(candidate => [candidate.sketch.id, candidate])), [candidates]);
  const chosenIds = useMemo(() => new Set(sketchIds), [sketchIds]);
  const [addId, setAddId] = useState('');
  const host = useRef<HTMLDivElement>(null);
  const focusAfterChange = useRef<string | null>(null);
  const first = candidatesById.get(sketchIds[0]);
  const plane = first?.inspection.eligible ? first.inspection.section.plane : null;
  const candidateDisabled = (id: string, currentId?: string) => {
    const candidate = candidatesById.get(id);
    return !candidate?.inspection.eligible || id !== currentId && chosenIds.has(id) || Boolean(plane && currentId !== sketchIds[0] && candidate.inspection.section.plane !== plane);
  };
  const available = candidates.filter(candidate => !candidateDisabled(candidate.sketch.id));
  const selectedAddId = available.some(candidate => candidate.sketch.id === addId) ? addId : available[0]?.sketch.id ?? '';
  useLayoutEffect(() => {
    const requested = focusAfterChange.current;
    if (!requested) return;
    focusAfterChange.current = null;
    const fields = [...host.current?.querySelectorAll<HTMLSelectElement>('select') ?? []];
    fields.find(field => field.getAttribute('data-sketch-id') === requested)?.focus();
  }, [sketchIds]);
  const move = (index: number, direction: number) => {
    const ids = [...sketchIds];
    const current = ids[index], other = ids[index + direction];
    if (!current || !other) return;
    ids[index] = other; ids[index + direction] = current;
    focusAfterChange.current = current; onChange(ids);
  };
  return <div ref={host} className="cad-loft-sections">
    <div className="cad-field-section">Sections <small>{sketchIds.length} / {MAX_CAD_LOFT_SECTIONS}</small></div>
    <ol className="cad-loft-section-list" aria-label="Loft sections">
      {sketchIds.map((id, index) => {
        const candidate = candidatesById.get(id);
        const inspection = candidate?.inspection;
        const problem = !inspection ? 'Choose an earlier sketch.' : !inspection.eligible ? inspection.message
          : plane && inspection.section.plane !== plane ? `Use the ${plane} plane of the first section.` : null;
        return <li key={id} className="cad-loft-section-row">
          <span className="cad-loft-section-number">{index + 1}</span>
          <select aria-label={`Section ${index + 1}`} data-sketch-id={id} value={id} aria-invalid={problem ? true : undefined}
            onChange={event => { const nextId = event.target.value; if (!candidateDisabled(nextId, id)) { focusAfterChange.current = nextId; onChange(sketchIds.map((entry, position) => position === index ? nextId : entry)); } }}>
            {!candidate && <option value={id}>Choose a sketch</option>}
            {candidates.map(entry => <option key={entry.sketch.id} value={entry.sketch.id} disabled={candidateDisabled(entry.sketch.id, id)} title={entry.inspection.eligible ? entry.sketch.name : entry.inspection.message}>
              {entry.sketch.name}{entry.inspection.eligible ? '' : ` — ${entry.inspection.message.slice(0, 90)}`}
            </option>)}
          </select>
          <button type="button" aria-label={`Move section ${index + 1} up`} title="Move section up" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={12} /></button>
          <button type="button" aria-label={`Move section ${index + 1} down`} title="Move section down" disabled={index === sketchIds.length - 1} onClick={() => move(index, 1)}><ArrowDown size={12} /></button>
          <button type="button" aria-label={`Remove section ${index + 1}`} title="Remove section" disabled={sketchIds.length <= MIN_CAD_LOFT_SECTIONS} onClick={() => {
            focusAfterChange.current = sketchIds[index + 1] ?? sketchIds[index - 1] ?? null; onChange(sketchIds.filter((_, position) => position !== index));
          }}><X size={12} /></button>
          <small className={problem ? 'cad-error' : 'cad-loft-section-metadata'}>{problem ?? (inspection?.eligible ? `${inspection.section.plane} · ${Number(inspection.section.offset.toFixed(6))} mm` : '')}</small>
        </li>;
      })}
    </ol>
    <div className="cad-loft-section-add">
      <select aria-label="Sketch to add" value={selectedAddId} disabled={!selectedAddId || sketchIds.length >= MAX_CAD_LOFT_SECTIONS} onChange={event => setAddId(event.target.value)}>
        {!selectedAddId && <option value="">No compatible sketch</option>}
        {available.map(candidate => <option key={candidate.sketch.id} value={candidate.sketch.id}>{candidate.sketch.name}</option>)}
      </select>
      <button type="button" aria-label="Add section" title="Add section" disabled={!selectedAddId || sketchIds.length >= MAX_CAD_LOFT_SECTIONS} onClick={() => {
        if (selectedAddId && sketchIds.length < MAX_CAD_LOFT_SECTIONS && !candidateDisabled(selectedAddId)) { focusAfterChange.current = selectedAddId; onChange([...sketchIds, selectedAddId]); }
      }}><Plus size={13} /></button>
    </div>
    {sketchIds.length < MIN_CAD_LOFT_SECTIONS && <p className="cad-error">Choose at least two sketches, each with one closed material contour.</p>}
  </div>;
}
