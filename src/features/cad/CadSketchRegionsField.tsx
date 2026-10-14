import { useContext, useMemo, useRef } from 'react';
import { SelectIcon, CloseIcon } from '@/components/icons';
import type { CadDocument } from '@/domain/cad/cadDocument';
import { prepareCadDatumFrames, resolveCadSketchPlacement } from '@/domain/cad/cadDatumPlanes';
import { prepareCadSketchCells } from '@/domain/cad/cadSketchRegionInspection';
import type { CadSketchCellReference } from '@/domain/cad/cadSketchRegionSelection';
import { CadFeatureReferencePickingContext } from './cadFeatureReferencePicking';
import { CadContextHelp } from './CadContextHelp';
import './cad-sketch-regions.css';

/** Select resolved areas without extracting profiles or rewriting the source sketch. */
export function CadSketchRegionsField({ document, sketchId, selection, onChange }: {
  document: CadDocument; sketchId: string; selection: readonly CadSketchCellReference[] | undefined;
  onChange(selection: readonly CadSketchCellReference[] | undefined): void;
}) {
  const picking = useContext(CadFeatureReferencePickingContext);
  const source = document.features.find(feature => feature.id === sketchId);
  const prepared = useMemo(() => {
    if (source?.kind !== 'sketch') return { kind: 'unavailable' as const, reason: 'Choose a profile sketch first.' };
    try {
      const sourceIndex = document.features.indexOf(source);
      const plane = source.plane;
      const datum = typeof plane === 'string' ? undefined : document.features.slice(0, sourceIndex)
        .find(feature => feature.id === plane.featureId);
      return { kind: 'ready' as const, cells: prepareCadSketchCells(source, document.parameters),
        placement: resolveCadSketchPlacement(source, document.parameters, prepareCadDatumFrames(datum?.kind === 'datum-plane' ? [datum] : [], document.parameters)) };
    } catch (cause) {
      return { kind: 'unavailable' as const, reason: cause instanceof Error ? cause.message : 'Correct the sketch before choosing its closed areas.' };
    }
  }, [source, document.features, document.parameters]);
  const current = useRef({ sketchId, onChange }); current.current = { sketchId, onChange };
  const begin = () => {
    if (prepared.kind !== 'ready' || !picking?.beginRegions || !picking.precedingIds.has(sketchId)) return;
    picking.beginRegions(sketchId, prepared.cells, prepared.placement, selection, next => {
      if (current.current.sketchId === sketchId) current.current.onChange(next);
    });
  };
  return <div className="cad-area-field" role="group" aria-label="Extrusion areas">
    <span>Areas <CadContextHelp label="Closed sketch areas">
      <svg className="cad-area-diagram" viewBox="0 0 160 66" role="img" aria-label="Outer area, bore and island are individually selectable">
        <path d="M8 8H86V58H8Z M38 33a15 15 0 1 0 30 0a15 15 0 1 0-30 0" fill="#d9ae67" fillRule="evenodd" />
        <circle cx="53" cy="33" r="7" fill="#d9ae67" />
        <path d="M94 33h13m-5-5 5 5-5 5" fill="none" stroke="#a3c2d0" strokeWidth="1.5" />
        <circle cx="132" cy="33" r="19" fill="#d9ae67" stroke="#eccea2" />
      </svg>
      <p>Click an area to use it. Hold Shift to add or remove areas. A bore's interior is a separate area.</p>
      <p>Whole sketch keeps the usual holes and islands. Choosing areas keeps the source sketch and its dimensions.</p>
      {prepared.kind === 'unavailable' && <p>{prepared.reason}</p>}
    </CadContextHelp></span>
    <div className="cad-area-actions">
      <button type="button" className="cad-area-choice" aria-label="Pick closed areas from model"
        aria-description={prepared.kind === 'unavailable' ? prepared.reason : 'Click an area; hold Shift to add or remove areas.'}
        disabled={!picking?.beginRegions || !picking.precedingIds.has(sketchId) || prepared.kind !== 'ready'} onClick={begin}>
        <SelectIcon size={13} /><span>{selection === undefined ? 'Whole sketch' : selection.length ? `${selection.length} ${selection.length === 1 ? 'area' : 'areas'}` : 'No areas'}</span>
      </button>
      {selection !== undefined && <button type="button" className="cad-area-reset" aria-label="Restore whole sketch" title="Restore whole sketch" onClick={() => onChange(undefined)}><CloseIcon size={12} /></button>}
    </div>
  </div>;
}
