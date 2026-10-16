import { useState } from 'react';
import type { CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { CadContextMenu, type CadContextMenuAnchor, type CadContextMenuItem } from './CadContextMenu';
import type { CadSketchSnapCandidate } from './cadSketchGeometrySnaps';
import { formatCadQuantity } from './cadDisplayQuantity';

/** Every tied source identity stays reachable without mounting an unbounded menu. */
export function CadSketchSnapChooser({ anchor, candidates, graph, onChoose, onHighlight, onClose, onOutsidePointerDown }: {
  anchor: CadContextMenuAnchor; candidates: readonly CadSketchSnapCandidate[]; graph: CadSketchGraph;
  onChoose(candidate: CadSketchSnapCandidate): void; onHighlight(candidate: CadSketchSnapCandidate): void; onClose(): void;
  onOutsidePointerDown(event: PointerEvent): void;
}) {
  const [offset, setOffset] = useState(0), pageSize = 12;
  const entityName = (id: string) => {
    const index = graph.entities.findIndex(entity => entity.id === id), entity = graph.entities[index];
    return `${entity?.kind === 'line' ? 'Line' : entity?.kind === 'arc' ? 'Arc' : 'Circle'} ${index + 1}`;
  };
  const items: CadContextMenuItem[] = candidates.slice(offset, offset + pageSize).map(candidate => {
    const target = candidate.target, pointId = 'pointId' in target ? target.pointId : undefined;
    const name = pointId === undefined ? target.kind === 'midpoint' ? 'Midpoint' : 'Path start'
      : `Point ${graph.points.findIndex(point => point.id === pointId) + 1}`;
    const owners = candidate.entityIds.slice(0, 2).map(entityName), omitted = candidate.entityIds.length - owners.length;
    const details = [pointId === undefined ? '' : target.kind === 'endpoint' ? 'Endpoint' : target.kind === 'center' ? 'Center' : '', ...owners,
      ...(omitted ? [`+${omitted} owners`] : [])].filter(Boolean);
    return { label: [name, ...details].join(' · '), help: `${candidate.point.map(value => formatCadQuantity(value)).join(', ')} mm`,
      onHighlight: () => onHighlight(candidate), onSelect: () => onChoose(candidate) };
  });
  if (offset || offset + pageSize < candidates.length) {
    items.push({ kind: 'separator' });
    if (offset) items.push({ label: 'Previous candidates', keepOpen: true, onSelect: () => setOffset(offset - pageSize) });
    if (offset + pageSize < candidates.length) items.push({ label: 'Next candidates', keepOpen: true, onSelect: () => setOffset(offset + pageSize) });
  }
  return <CadContextMenu anchor={anchor} title="Choose snap target" items={items} onClose={onClose} onOutsidePointerDown={onOutsidePointerDown} />;
}
