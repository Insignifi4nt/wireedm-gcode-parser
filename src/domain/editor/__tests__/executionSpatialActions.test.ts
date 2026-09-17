import { expect, it } from 'vitest';

import { compileWireEdmExecutionPlan } from '@/domain/execution-plan/executionPlan';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { executionSpatialActions } from '../executionSpatialActions';

it('keeps exact cut endpoints and resolves controller pauses on non-thread and automatic-thread events', () => {
  const document = createUpidFromDxfEntities([
    { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 },
    { type: 'circle', layer: 'CUT', center: { x: 20, y: 0 }, radius: 5 }
  ]);
  document.geometryBasis = 'wire-centre';
  document.setup = { initialWirePosition: {
    kind: 'manual', point: { x: -3, y: 1 }, review: 'reviewed'
  } };
  document.plan.operations[1].threadingTransition = {
    mode: 'automatic', wireSeparation: 'automatic-before-positioning', source: 'operation-override'
  };
  const compiled = compileWireEdmExecutionPlan(document);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const position = compiled.plan.events.find((event) => event.kind === 'position');
  const automatic = compiled.plan.events.find((event) => event.kind === 'wire-thread' && event.method === 'automatic');
  const contour = compiled.plan.events.find((event) => event.kind === 'motion' && event.role === 'contour');
  if (!position || position.kind !== 'position' || !automatic || automatic.kind !== 'wire-thread' ||
      !contour || contour.kind !== 'motion') throw new Error('Expected positioning, automatic thread and cut');
  const sourceOperationId = (id: string) => id;
  const unverified = executionSpatialActions(compiled.plan.events, sourceOperationId);
  expect(unverified.find((action) => action.eventId === contour.id)).toMatchObject({
    label: 'Cut endpoint', point: contour.end, pause: null
  });
  expect(unverified.find((action) => action.eventId === automatic.id)).toMatchObject({
    pause: null, emittedPauseCommandIds: []
  });
  expect(unverified.find((action) => action.eventKind === 'program-start')).toMatchObject({
    point: { x: -3, y: 1 }, operationId: null
  });
  const noPause = executionSpatialActions(compiled.plan.events, sourceOperationId, new Map());
  expect(noPause.find((action) => action.eventId === automatic.id)?.detail)
    .toContain('no pause in generated program');
  const confirmed = executionSpatialActions(compiled.plan.events, sourceOperationId,
    new Map([[position.id, ['operator.program-stop']], [automatic.id, ['operator.program-stop']]]));
  expect(confirmed.find((action) => action.eventId === position.id)).toMatchObject({
    pause: 'emitted-post', label: 'Controller pause · Position wire',
    emittedPauseCommandIds: ['operator.program-stop']
  });
  expect(confirmed.find((action) => action.eventId === automatic.id)).toMatchObject({
    pause: 'emitted-post', label: 'Controller pause · Thread wire automatically',
    point: { x: 25, y: 0 }
  });
});
