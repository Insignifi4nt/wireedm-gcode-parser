import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { reversePathRefs, segmentMap, signedAreaOfPath } from '@/domain/path-intel/segments';

import {
  EditorContourSetupPanel,
  EditorSetStartPanel
} from '../EditorWorkflowSetupPanels';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('canonical workflow target fallbacks', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('passes the displayed fallback operation to every Contour Setup mutation', async () => {
    const document = twoCircleDocument();
    document.geometryBasis = 'finished-contour';
    const fallbackOperation = document.plan.operations[0];
    const onReverse = vi.fn();
    const onSetClassification = vi.fn();
    const onSetCompensation = vi.fn();

    await act(async () => {
      root.render(
        <EditorContourSetupPanel
          disabled={false}
          document={document}
          onReverse={onReverse}
          onSelectOperation={vi.fn()}
          onSetClassification={onSetClassification}
          onSetCompensation={onSetCompensation}
          selectedOperationId={null}
        />
      );
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Reverse path operation"]')?.click();
      setSelect(container.querySelector<HTMLSelectElement>('[aria-label="Contour role"]')!, 'hole');
      setSelect(
        container.querySelector<HTMLSelectElement>('[aria-label="Compensation kept material"]')!,
        'inside'
      );
    });

    expect(onReverse).toHaveBeenCalledWith(fallbackOperation.id);
    expect(onSetClassification).toHaveBeenCalledWith(fallbackOperation.id, 'hole');
    expect(onSetCompensation).toHaveBeenCalledWith(fallbackOperation.id, 'inside');
  });

  it('offers Automatic after a manual compensation choice', async () => {
    const document = twoCircleDocument();
    document.geometryBasis = 'finished-contour';
    const operation = document.plan.operations[0];
    operation.classification = 'hole';
    operation.compensationIntent = { mode: 'controller', keptMaterial: 'inside', source: 'manual' };
    const onSetCompensation = vi.fn();
    await act(async () => root.render(<EditorContourSetupPanel
      disabled={false} document={document} onReverse={vi.fn()} onSelectOperation={vi.fn()}
      onSetClassification={vi.fn()} onSetCompensation={onSetCompensation}
      selectedOperationId={operation.id}
    />));

    const select = container.querySelector<HTMLSelectElement>('[aria-label="Compensation kept material"]')!;
    expect(select.value).toBe('inside');
    expect(select.querySelector<HTMLOptionElement>('option[value="automatic"]')?.disabled).toBe(false);
    expect(select.querySelector('option[value="automatic"]')?.textContent)
      .toBe('Automatic · keep outside (hole)');
    await act(async () => setSelect(select, 'automatic'));
    expect(onSetCompensation).toHaveBeenCalledWith(operation.id, 'automatic');
  });

  it.each(['wire-centre', 'centerline'] as const)(
    'explains %s as uncompensated output without an error', async (mode) => {
      const document = twoCircleDocument();
      document.geometryBasis = mode === 'wire-centre' ? 'wire-centre' : 'finished-contour';
      document.plan.operations[0].compensationIntent = { mode: 'centerline', source: 'manual' };
      await act(async () => {
        root.render(<EditorContourSetupPanel
          disabled={false} document={document} onReverse={vi.fn()} onSelectOperation={vi.fn()}
          onSetClassification={vi.fn()} onSetCompensation={vi.fn()} selectedOperationId={null}
        />);
      });

      expect(container.querySelector('[data-testid="compensation-blocker"]')).toBeNull();
      expect(container.querySelector<HTMLSelectElement>('[aria-label="Compensation kept material"]')?.disabled)
        .toBe(mode === 'wire-centre');
      expect(container.textContent).toContain(mode === 'wire-centre'
        ? 'Controller compensation is off for wire-centre geometry'
        : 'The wire follows the drawn contour without controller compensation');
      expect(container.querySelector('[data-testid="compensation-kept-material"]')?.textContent)
        .toBe('—');
      expect(container.querySelector('[data-testid="compensation-wire-side"]')?.textContent)
        .toBe('None · follows drawn path');
    }
  );

  it.each([
    ['outside', 'ccw', 'left', 'Inside', 'Counterclockwise (CCW)'],
    ['outside', 'cw', 'right', 'Inside', 'Clockwise (CW)'],
    ['inside', 'ccw', 'right', 'Outside', 'Counterclockwise (CCW)'],
    ['inside', 'cw', 'left', 'Outside', 'Clockwise (CW)']
  ] as const)(
    'distinguishes kept material %s from wire offset for %s travel',
    async (keptMaterial, winding, wireSide, wirePosition, direction) => {
      const document = twoCircleDocument();
      document.geometryBasis = 'finished-contour';
      const operation = document.plan.operations[0];
      operation.classification = keptMaterial === 'outside' ? 'hole' : 'exterior';
      operation.compensationIntent = { mode: 'controller', keptMaterial, source: 'automatic' };
      const ccw = signedAreaOfPath(operation.segmentRefs, segmentMap(document.segments)) > 0;
      if (ccw !== (winding === 'ccw')) operation.segmentRefs = reversePathRefs(operation.segmentRefs);
      await act(async () => root.render(<EditorContourSetupPanel
        disabled={false} document={document} onReverse={vi.fn()} onSelectOperation={vi.fn()}
        onSetClassification={vi.fn()} onSetCompensation={vi.fn()} selectedOperationId={operation.id}
      />));

      expect(container.querySelector('[data-upid-compensation-details] summary')?.textContent)
        .toBe(`Keep ${keptMaterial} · Wire ${wirePosition.toLowerCase()}`);
      expect(container.querySelector('[data-testid="compensation-kept-material"]')?.textContent)
        .toBe(`${keptMaterial === 'inside' ? 'Inside' : 'Outside'} contour`);
      expect(container.querySelector('[data-testid="compensation-wire-side"]')?.textContent)
        .toBe(`${wirePosition} contour · ${wireSide} of travel`);
      expect(container.querySelector('[data-testid="compensation-winding"]')?.textContent)
        .toBe(direction);
      expect(container.textContent).toContain(`Automatic · ${operation.classification}`);
    }
  );

  it('describes an open partial cut by travel side without suggesting enclosed material', async () => {
    const document = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
    ]);
    document.geometryBasis = 'finished-contour';
    const operation = document.plan.operations[0];
    operation.machiningIntent = {
      kind: 'partial-contour', sourceOperationId: operation.id, spanIds: ['partial-span']
    };
    operation.compensationIntent = { mode: 'controller', wireSide: 'left', source: 'manual' };
    await act(async () => root.render(<EditorContourSetupPanel
      disabled={false} document={document} onReverse={vi.fn()} onSelectOperation={vi.fn()}
      onSetClassification={vi.fn()} onSetCompensation={vi.fn()} selectedOperationId={operation.id}
    />));

    expect(container.querySelector('[data-upid-compensation-details] summary')?.textContent)
      .toBe('Wire left of travel');
    expect(container.querySelector('[data-testid="compensation-wire-side"]')?.textContent)
      .toBe('left of travel');
    expect(container.querySelector('[data-testid="compensation-kept-material"]')).toBeNull();
    expect(container.querySelector('option[value="inside"]')).toBeNull();
    expect(container.querySelector('option[value="outside"]')).toBeNull();
  });

  it('shows open-path role and explains partial compensation prerequisites', async () => {
    const document = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
    ]);
    document.geometryBasis = 'finished-contour';
    document.plan.operations[0].compensationIntent = {
      mode: 'controller', keptMaterial: 'inside', source: 'manual'
    };
    await act(async () => {
      root.render(<EditorContourSetupPanel
        disabled={false} document={document} onReverse={vi.fn()} onSelectOperation={vi.fn()}
        onSetClassification={vi.fn()} onSetCompensation={vi.fn()} selectedOperationId={null}
      />);
    });
    const role = container.querySelector<HTMLSelectElement>('[aria-label="Contour role"]');
    expect(role?.disabled).toBe(true);
    expect(role?.selectedOptions[0].textContent).toBe('Open path');
    expect(container.querySelector('[data-testid="compensation-blocker"]')?.textContent)
      .toContain('Intentional partial cuts need an explicit wire side in Machining participation');
  });

  it('passes the displayed fallback contour when Set Start begins picking', async () => {
    const document = twoCircleDocument();
    const fallbackOperation = document.plan.operations[0];
    const onPickStart = vi.fn();
    const onInferenceModeChange = vi.fn();

    await act(async () => {
      root.render(
        <EditorSetStartPanel
          disabled={false}
          document={document}
          inferenceMode="endpoint"
          onInferenceModeChange={onInferenceModeChange}
          onPickStart={onPickStart}
          onSelectOperation={vi.fn()}
          selectedOperationId={null}
        />
      );
    });

    await act(async () => {
      setSelect(
        container.querySelector<HTMLSelectElement>(
          '[aria-label="Set start point inference"]'
        )!,
        'midpoint'
      );
      container.querySelector<HTMLButtonElement>('[aria-label="Pick explicit contour start"]')?.click();
    });

    expect(onInferenceModeChange).toHaveBeenCalledWith('midpoint');
    expect(onPickStart).toHaveBeenCalledWith(fallbackOperation.id);
    expect(container.textContent).toContain('automatic contour start');
    expect(
      Array.from(
        container.querySelectorAll<HTMLOptionElement>(
          'select[aria-label="Set start point inference"] option'
        )
      ).map((option) => [option.value, option.textContent])
    ).toEqual([
      ['endpoint', 'Nearest endpoint'],
      ['nearest', 'Nearest point to cursor'],
      ['midpoint', 'Hovered side midpoint'],
      ['perpendicular', 'Perpendicular from approach']
    ]);
  });

  it('renders Contour Setup in duplicate execution order while preserving selection identity', async () => {
    const document = twoCircleDocument();
    const [first, second] = document.plan.operations;
    first.orderIndex = 9;
    second.orderIndex = 9;
    document.plan.operations = [second, first];

    await act(async () => {
      root.render(
        <EditorContourSetupPanel
          disabled={false}
          document={document}
          onReverse={vi.fn()}
          onSelectOperation={vi.fn()}
          onSetClassification={vi.fn()}
          onSetCompensation={vi.fn()}
          selectedOperationId={second.id}
        />
      );
    });

    const select = container.querySelector<HTMLSelectElement>(
      '[aria-label="Contour setup operation"]'
    )!;
    const options = [...select.options];
    expect(options.map((option) => option.value)).toEqual([first.id, second.id]);
    expect(options.map((option) => option.textContent)).toEqual([
      `01. ${first.displayName}`,
      `02. ${second.displayName}`
    ]);
    expect(select.value).toBe(second.id);
  });

  it('renders Set Start in gapped execution order while preserving selection identity', async () => {
    const document = twoCircleDocument();
    const [first, second] = document.plan.operations;
    first.orderIndex = 5;
    second.orderIndex = 17;
    document.plan.operations = [second, first];

    await act(async () => {
      root.render(
        <EditorSetStartPanel
          disabled={false}
          document={document}
          inferenceMode="endpoint"
          onInferenceModeChange={vi.fn()}
          onPickStart={vi.fn()}
          onSelectOperation={vi.fn()}
          selectedOperationId={second.id}
        />
      );
    });

    const select = container.querySelector<HTMLSelectElement>(
      '[aria-label="Set start operation"]'
    )!;
    const options = [...select.options];
    expect(options.map((option) => option.value)).toEqual([first.id, second.id]);
    expect(options.map((option) => option.textContent)).toEqual([
      `01. ${first.displayName}`,
      `02. ${second.displayName}`
    ]);
    expect(select.value).toBe(second.id);
  });
});

function twoCircleDocument() {
  return createUpidFromDxfEntities([
    { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 },
    { type: 'circle', layer: 'CUT', center: { x: 20, y: 0 }, radius: 5 }
  ]);
}

function setSelect(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}
