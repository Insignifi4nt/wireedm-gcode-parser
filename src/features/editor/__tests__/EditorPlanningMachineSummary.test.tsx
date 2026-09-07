import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { evaluatePhysicalMachineFit } from '@/domain/machine-definition/machineFit';
import { machineDefinitionFixture } from '@/domain/machine-definition/__tests__/machineDefinitionFixture';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { EditorPlanningMachineSummary } from '../EditorPlanningMachineSummary';

describe('planning reference machine summary', () => {
  it.each([
    ['none', 'not-evaluated', 'Choose a default planning machine'],
    ['unknown', 'indeterminate', 'Unknown travel: Y'],
    ['limited', 'too-large', 'X 240.000 > 220.000 mm'],
    ['fits', 'fits', 'Source spans are within the known X/Y travel']
  ] as const)('reports the %s source fit without claiming machining readiness', (scenario, status, message) => {
    const source = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: scenario === 'limited' ? 240 : 20, y: 10 } }
    ]);
    const fixture = machineDefinitionFixture();
    const machine = scenario === 'none' ? null : scenario === 'fits'
      ? { ...fixture, limits: { ...fixture.limits, yTravel: { status: 'known' as const, millimeters: 120 } } }
      : fixture;
    const result = evaluatePhysicalMachineFit({ document: source, machine });
    const container = document.createElement('div');
    container.innerHTML = renderToStaticMarkup(<EditorPlanningMachineSummary machine={machine} result={result} />);

    expect(container.querySelector(`[data-editor-machine-fit="${status}"]`)?.textContent).toContain(message);
    expect(container.textContent).toContain('This compares source spans only');
    expect(container.textContent).toContain('Controller export checks planned cutting and positioning');
  });
});
