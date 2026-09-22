import { createUpidFromDxfEntities } from '../src/domain/upid/upidDocument.ts';
import { compileWireEdmExecutionPlan } from '../src/domain/execution-plan/executionPlan.ts';

// Build outside the timed region so this measures compilation, including validation.
// One warm-up and three measured runs per size; compare on an otherwise idle machine.
for (const count of [1_000, 4_000]) {
  const document = createUpidFromDxfEntities(Array.from({ length: count }, (_, index) => ({
    type: 'line' as const,
    layer: 'BENCHMARK',
    start: { x: index * 3, y: 0 },
    end: { x: index * 3 + 1, y: 0 }
  })), { operationOrderStrategy: 'source-order' });
  document.geometryBasis = 'wire-centre';
  document.setup = {
    initialWirePosition: { kind: 'manual', point: { x: 0, y: 0 }, review: 'reviewed' },
    threadingDefault: { mode: 'manual', wireSeparation: 'manual-before-positioning' }
  };
  const times: number[] = [];
  for (let run = 0; run < 4; run++) {
    const start = performance.now();
    const result = compileWireEdmExecutionPlan(document);
    const elapsed = performance.now() - start;
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    if (result.plan.requirements.operationCount !== count) throw new Error('Incomplete benchmark plan.');
    if (run > 0) times.push(elapsed);
  }
  console.log(JSON.stringify({ operations: count, measuredMs: times, medianMs: [...times].sort((a, b) => a - b)[1] }));
}

// Closed finished contours exercise material-route classification, unlike the open-path baseline.
for (const count of [200, 800]) {
  const document = createUpidFromDxfEntities(Array.from({ length: count }, (_, index) => ({
    type: 'circle' as const, layer: 'BENCHMARK', center: { x: index * 30, y: 0 }, radius: 5
  })), { operationOrderStrategy: 'source-order' });
  for (const operation of document.plan.operations) operation.compensationIntent = { mode: 'centerline', source: 'manual' };
  for (const element of document.pathElements) if (element.operationId) element.compensationIntent = { mode: 'centerline', source: 'manual' };
  document.setup = {
    initialWirePosition: { kind: 'manual', point: { ...document.plan.operations[0].startPoint }, review: 'reviewed' },
    threadingDefault: { mode: 'manual', wireSeparation: 'manual-before-positioning' }
  };
  const times: number[] = [];
  for (let run = 0; run < 4; run++) {
    const start = performance.now();
    const result = compileWireEdmExecutionPlan(document);
    const elapsed = performance.now() - start;
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    if (result.plan.requirements.operationCount !== count) throw new Error('Incomplete benchmark plan.');
    if (run > 0) times.push(elapsed);
  }
  console.log(JSON.stringify({ scenario: 'finished-contour-rethread', operations: count, measuredMs: times,
    medianMs: [...times].sort((a, b) => a - b)[1] }));
}
