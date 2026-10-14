import { useState } from 'react';
import { ArrowLeft, ArrowRight } from '@/components/icons';
import type { CadDocument, CadPathSegment, CadScalar } from '@/domain/cad/cadDocument';
import { ScalarField } from './CadFields';

export function CadPathSegmentFields({ segments, parameters, onChange, label = 'Path' }: {
  segments: readonly CadPathSegment[];
  parameters: CadDocument['parameters'];
  onChange(segments: readonly CadPathSegment[]): void;
  label?: 'Path' | 'Curve';
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const index = Math.min(selectedIndex, segments.length - 1);
  const segment = segments[index];
  if (!segment) return null;
  const update = (next: CadPathSegment) => onChange(segments.map((entry, position) => position === index ? next : entry));
  const scalar = (label: string, value: CadScalar, onChangeScalar: (value: CadScalar) => void, unit?: string) => <ScalarField label={label} value={value} parameters={parameters} onChange={onChangeScalar} unit={unit} />;
  return <>
    <div className="cad-path-segment-picker">
      <button type="button" aria-label={`Previous ${label.toLowerCase()} segment`} disabled={index === 0} onClick={() => setSelectedIndex(index - 1)}><ArrowLeft size={14} /></button>
      <label className="cad-field"><span>Segment <small>{segment.kind === 'line' ? 'Line' : 'Arc'} / {segments.length}</small></span><input aria-label={`${label} segment`} type="number" min={1} max={segments.length} step={1} value={index + 1}
        onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }}
        onChange={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= segments.length) setSelectedIndex(value - 1); }} /></label>
      <button type="button" aria-label={`Next ${label.toLowerCase()} segment`} disabled={index === segments.length - 1} onClick={() => setSelectedIndex(index + 1)}><ArrowRight size={14} /></button>
    </div>
    {segment.kind === 'line' ? <>
      {scalar('Start X', segment.start[0], x => update({ ...segment, start: [x, segment.start[1]] }))}
      {scalar('Start Y', segment.start[1], y => update({ ...segment, start: [segment.start[0], y] }))}
      {scalar('End X', segment.end[0], x => update({ ...segment, end: [x, segment.end[1]] }))}
      {scalar('End Y', segment.end[1], y => update({ ...segment, end: [segment.end[0], y] }))}
    </> : <>
      {scalar('Center X', segment.center[0], x => update({ ...segment, center: [x, segment.center[1]] }))}
      {scalar('Center Y', segment.center[1], y => update({ ...segment, center: [segment.center[0], y] }))}
      {scalar('Radius', segment.radius, radius => update({ ...segment, radius }))}
      {scalar('Start angle', segment.startAngle, startAngle => update({ ...segment, startAngle }), 'deg')}
      {scalar('Sweep', segment.sweep, sweep => update({ ...segment, sweep }), 'deg')}
    </>}
  </>;
}
