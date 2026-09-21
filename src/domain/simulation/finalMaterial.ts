import type { PathPlanningDocument } from '@/domain/path-intel/types';
import { releasedPieceSnapshots } from './releasedPieces';
import type { ResolvedSimulationSettings, SimulationFinalMaterial, SimulationMaterialSolid, SimulationPiece, SimulationPieceRole } from './types';

export function compileFinalMaterial(
  document: PathPlanningDocument, pieces: readonly SimulationPiece[], settings: ResolvedSimulationSettings,
  remainingStockRole: SimulationPieceRole, activeOperationIds: readonly string[]
): SimulationFinalMaterial {
  const lastRelease = pieces.reduce((last, piece) => Math.max(last, piece.releaseSeconds), 0);
  const released = releasedPieceSnapshots(pieces, settings, lastRelease);
  const solids: SimulationMaterialSolid[] = released.pieces.filter(piece => piece.role === 'part').map(piece => ({
    id: piece.id, operationId: piece.operationId, kind: 'piece', polygon: piece.polygon, holes: piece.holes,
    bottomZ: settings.stock.bottomZ, topZ: settings.stock.bottomZ + settings.stock.thickness
  }));
  if (remainingStockRole === 'part') {
    const { originX, originY, width, depth, bottomZ, thickness } = settings.stock;
    solids.unshift({ id: 'remaining-stock', operationId: null, kind: 'remaining-stock',
      polygon: [{ x: originX, y: originY }, { x: originX + width, y: originY },
        { x: originX + width, y: originY + depth }, { x: originX, y: originY + depth }],
      holes: released.stockHoles, bottomZ, topZ: bottomZ + thickness });
  }
  const releasedOperations = new Set(pieces.map(piece => piece.operationId));
  // These compiler source IDs omit fully excluded references while retaining partially cut boundaries.
  const activeOperations = new Set(activeOperationIds);
  const incomplete = document.plan.operations.some(operation => activeOperations.has(operation.id)
    && (!operation.closed || !releasedOperations.has(operation.id)))
    || pieces.some(piece => piece.role === 'unclassified') || remainingStockRole === 'unclassified';
  const status = !solids.length ? 'unavailable' : incomplete ? 'partial' : 'ready';
  return { status, solids, diagnostics: status === 'ready' ? [] : [{
    code: 'SIMULATION_FINAL_MATERIAL_INCOMPLETE', severity: 'warning', operationId: null,
    message: status === 'unavailable'
      ? 'A final part cannot be determined from the completed, supported closed boundaries and saved material roles.'
      : 'Only known kept material is shown. Open, incomplete, unsupported or unreachable boundaries, or unclassified material roles, prevent a complete final-part prediction; omitted cuts are not filled in.'
  }] };
}
