import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NavigateBackIcon, NavigateForwardIcon } from '@wire-edm/icons-react';
import { useState } from 'react';
import type { CadDocument, CadPoint2 } from '@/domain/cad/cadDocument';
import { ScalarField } from './CadFields';

export function CadPolygonVertexFields({ points, parameters, onChange }: {
  points: readonly CadPoint2[];
  parameters: CadDocument['parameters'];
  onChange(points: readonly CadPoint2[]): void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const index = Math.min(selectedIndex, points.length - 1);
  const point = points[index];
  if (!point) return null;
  const update = (next: CadPoint2) => onChange(points.map((entry, position) => position === index ? next : entry));
  return <>
    <div className="cad-path-segment-picker">
      <Button type="button" aria-label="Previous polygon vertex" disabled={index === 0} onClick={() => setSelectedIndex(index - 1)}><NavigateBackIcon size={13} /></Button>
      <label className="cad-field"><span>Vertex <small>/ {points.length}</small></span><Input aria-label="Polygon vertex" type="number" min={1} max={points.length} step={1} value={index + 1}
        onKeyDown={event => { if (!event.nativeEvent.isComposing && event.key === 'Enter') event.preventDefault(); }}
        onChange={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= points.length) setSelectedIndex(value - 1); }} /></label>
      <Button type="button" aria-label="Next polygon vertex" disabled={index === points.length - 1} onClick={() => setSelectedIndex(index + 1)}><NavigateForwardIcon size={13} /></Button>
    </div>
    <ScalarField label="X" value={point[0]} parameters={parameters} onChange={x => update([x, point[1]])} />
    <ScalarField label="Y" value={point[1]} parameters={parameters} onChange={y => update([point[0], y])} />
  </>;
}
