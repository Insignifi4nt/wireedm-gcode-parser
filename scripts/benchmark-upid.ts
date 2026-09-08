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
