import type { PathOperation, PathPlanningDocument } from '@/domain/path-intel/types';
import type { SimulationDiagnostic, SimulationPieceRole } from './types';

export function operationMaterialRole(operation: PathOperation): SimulationPieceRole {
  const intent = operation.compensationIntent;
  if (intent?.mode === 'controller' && 'keptMaterial' in intent) {
    return intent.keptMaterial === 'inside' ? 'part' : 'waste';
  }
  return classificationRole(operation);
}

function classificationRole(operation: PathOperation): SimulationPieceRole {
  return operation.classification === 'hole' ? 'waste'
    : operation.classification === 'exterior' || operation.classification === 'island' ? 'part' : 'unclassified';
}

/** Use all active authored outer boundaries, including incomplete/unrepresentable ones. */
export function compileMaterialRoles(document: PathPlanningDocument, activeOperationIds: readonly string[]): {
  remainingStockRole: SimulationPieceRole; diagnostics: SimulationDiagnostic[];
} {
  const activeIds = new Set(activeOperationIds);
  const closed = document.plan.operations.filter(operation => operation.closed && activeIds.has(operation.id));
  const contourIds = new Set(closed.map(operation => operation.contourId));
  const contours = new Map(document.contours.map(contour => [contour.id, contour]));
  const roots = closed.filter(operation => {
    let parentId = contours.get(operation.contourId)?.parentId;
    while (parentId) {
      if (contourIds.has(parentId)) return false;
      parentId = contours.get(parentId)?.parentId;
    }
    return true;
  });
  const rootRoles = new Set(roots.map(operationMaterialRole));
  const remainingStockRole = rootRoles.size !== 1 ? 'unclassified'
    : rootRoles.has('part') ? 'waste' : rootRoles.has('waste') ? 'part' : 'unclassified';
  const diagnostics: SimulationDiagnostic[] = [];
  if (rootRoles.size > 1) diagnostics.push({ code: 'SIMULATION_REMAINING_STOCK_ROLE_UNKNOWN', severity: 'warning', operationId: null,
    message: 'The active outer boundaries disagree about retaining the surrounding stock. Its material role remains unclassified and it is omitted from final-part geometry.' });
  for (const operation of closed) {
    const role = operationMaterialRole(operation);
    if (role === 'unclassified') diagnostics.push({ code: 'SIMULATION_MATERIAL_ROLE_UNKNOWN', severity: 'warning', operationId: operation.id,
      message: 'This closed boundary has no known kept-material role. Its released piece remains in the scenario and is omitted from final-part geometry.' });
    else if (role !== classificationRole(operation)) diagnostics.push({ code: 'SIMULATION_MATERIAL_ROLE_OVERRIDE', severity: 'info', operationId: operation.id,
      message: 'The saved compensation kept-material side takes precedence over contour classification for this piece’s part/waste role.' });
  }
  return { remainingStockRole, diagnostics };
}
