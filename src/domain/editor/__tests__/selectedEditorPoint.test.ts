import { expect, it } from 'vitest';

import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { selectedEditorPoint } from '../selectedEditorPoint';

it('reports coordinates only for an exact action or source point, never a travel or line selection', () => {
  const document = createUpidFromDxfEntities([
    { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
  ]);
  const operation = document.plan.operations[0];
  const segmentId = operation.segmentRefs[0].segmentId;
  const line = { operationId: operation.id, segmentId };
  expect(selectedEditorPoint(document, line, null)).toBeNull();
  expect(selectedEditorPoint(document, { ...line, travelRole: 'rapid-in' }, null)).toBeNull();
  expect(selectedEditorPoint(document, { ...line, travelRole: 'rapid-in', pointRole: 'start' }, null)).toBeNull();
  expect(selectedEditorPoint(document, { ...line, pointRole: 'start' }, null)).toEqual({ x: 0, y: 0 });
  expect(selectedEditorPoint(document, { ...line, pointRole: 'end' }, null)).toEqual({ x: 10, y: 0 });
  expect(selectedEditorPoint(document, null, {
    key: 'initial', eventId: 'initial', eventKind: 'program-start', operationId: null,
    point: { x: -3, y: 2 }, label: 'Initial wire', detail: '', pause: null,
    emittedPauseCommandIds: []
  })).toEqual({ x: -3, y: 2 });
});
