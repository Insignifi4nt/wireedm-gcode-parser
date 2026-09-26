import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { setPathOperationProgramStops } from '@/domain/path-editor/pathDocumentOperations';

import { EditorProgramStopsPanel } from '../EditorProgramStopsPanel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('EditorProgramStopsPanel', () => {
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

  it('keeps an invalid stop draft pending until its distance fits the contour', async () => {
    const source = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
    ]);
    const onSetStops = vi.fn();
    const onDraftChange = vi.fn();
    await act(async () => root.render(<EditorProgramStopsPanel disabled={false} document={source}
      selectedOperationId={source.plan.operations[0].id} onSetStops={onSetStops} onDraftChange={onDraftChange} />));
    const input = container.querySelector<HTMLInputElement>('[aria-label="Program stop remaining cut millimeters"]')!;
    const add = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Add program stop'))!;
    for (const value of ['10', '11', '0', 'invalid']) {
      await act(async () => setInput(input, value));
      expect(add.disabled).toBe(true);
      expect(container.textContent).toContain(value === '10' || value === '11'
        ? 'less than the contour length (10.000 mm)'
        : 'Remaining cut must be a finite number greater than 0.');
      await act(async () => add.click());
    }
    expect(onDraftChange).toHaveBeenCalledTimes(4);
    expect(onSetStops).not.toHaveBeenCalled();
    await act(async () => setInput(input, '9'));
    expect(add.disabled).toBe(false);
    await act(async () => add.click());
    expect(onSetStops).toHaveBeenCalledWith(source.plan.operations[0].id,
      [expect.objectContaining({ placement: { kind: 'before-operation-end', remainingCutLengthMm: 9 } })], true);
  });

  it('adds a stop after positioning without a cut-distance parameter', async () => {
    const source = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
    ]);
    const onSetStops = vi.fn();
    await act(async () => root.render(<EditorProgramStopsPanel disabled={false} document={source}
      selectedOperationId={source.plan.operations[0].id} onSetStops={onSetStops} />));
    await act(async () => setSelect(
      container.querySelector<HTMLSelectElement>('[aria-label="Program stop placement"]')!,
      'after-positioning'
    ));
    expect(container.querySelector('[aria-label="Program stop remaining cut millimeters"]')).toBeNull();
    await act(async () => [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Add program stop')!.click());
    expect(onSetStops).toHaveBeenCalledWith(source.plan.operations[0].id,
      [expect.objectContaining({ placement: { kind: 'after-positioning' } })], true);
  });

  it('explains the same boundary when no exit lead exists, and distinguishes a configured exit', async () => {
    const source = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
    ]);
    const operation = source.plan.operations[0];
    const onSetStops = vi.fn();
    const render = () => root.render(<EditorProgramStopsPanel disabled={false} document={source}
      selectedOperationId={operation.id} onSetStops={onSetStops} />);
    await act(async () => render());
    const select = container.querySelector<HTMLSelectElement>('[aria-label="Program stop placement"]')!;
    await act(async () => setSelect(select, 'after-exit'));
    expect(container.textContent).toContain('There is no exit lead');
    expect(select.title).toContain('No rapid travel occurs');
    operation.transitions = { exit: { strategy: 'manual-straight', move: 'cut', from: { x: 10, y: 0 },
      to: { x: 15, y: 0 }, review: 'reviewed' } };
    await act(async () => render());
    expect(container.textContent).toContain('Pause after cutting the exit lead');
    await act(async () => setSelect(select, 'after-contour'));
    expect(container.textContent).toContain('before cutting the exit lead');
    expect(container.querySelector(`#${select.getAttribute('aria-describedby')}`)?.textContent)
      .toContain('Compensation has not ended');
  });

  it('authors and edits travel-distance intent through the shared validated operation', async () => {
    let source = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { type: 'line', layer: 'CUT', start: { x: 30, y: 0 }, end: { x: 40, y: 0 } }
    ]);
    const operationId = source.plan.operations[0].id;
    let selectedStopId: string | null = null;
    const onSetStops = vi.fn((id, stops) => {
      source = setPathOperationProgramStops(source, id, stops)!;
      render();
    });
    const render = () => root.render(<EditorProgramStopsPanel disabled={false} document={source}
      selectedOperationId={operationId} selectedStopId={selectedStopId} onSetStops={onSetStops} />);
    await act(async () => render());
    await act(async () => setSelect(container.querySelector<HTMLSelectElement>('[aria-label="Program stop placement"]')!, 'after-contour-distance'));
    const input = container.querySelector<HTMLInputElement>('[aria-label="Program stop travel distance millimeters"]')!;
    const add = [...container.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Add program stop')!;
    expect(container.textContent).toContain('Available path: 20.000 mm');
    await act(async () => setInput(input, '20'));
    expect(add.disabled).toBe(true);
    await act(async () => setInput(input, '5'));
    await act(async () => add.click());
    expect(source.schemaVersion).toBe(3);
    expect(source.plan.operations[0].programStops![0].placement).toEqual({ kind: 'after-contour-distance', travelLengthMm: 5 });
    selectedStopId = 'stop-1';
    await act(async () => render());
    const selectedInput = container.querySelector<HTMLInputElement>('[aria-label="Selected stop travel distance millimeters"]')!;
    expect(selectedInput.value).toBe('5');
    await act(async () => setInput(selectedInput, '7.25'));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Apply stop-1"]')!.click());
    expect(source.plan.operations[0].programStops![0].placement).toEqual({ kind: 'after-contour-distance', travelLengthMm: 7.25 });
  });

  it('blocks duplicate add and apply, but permits disabling a stored duplicate', async () => {
    const source = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
    ]);
    const operation = source.plan.operations[0];
    operation.programStops = ['stop-1', 'stop-2'].map((id) => ({
      id, enabled: true, reason: 'manual', placement: { kind: 'before-operation-end', remainingCutLengthMm: 1 }
    }));
    const onSetStops = vi.fn();
    await act(async () => root.render(<EditorProgramStopsPanel disabled={false} document={source}
      selectedOperationId={operation.id} onSetStops={onSetStops} />));
    const add = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Add program stop'))!;
    expect(add.disabled).toBe(true);
    await act(async () => root.render(<EditorProgramStopsPanel disabled={false} document={source}
      selectedOperationId={operation.id} selectedStopId="stop-2" onSetStops={onSetStops} />));
    const apply = container.querySelector<HTMLButtonElement>('[aria-label="Apply stop-2"]')!;
    expect(apply.disabled).toBe(true);
    expect(container.textContent).toContain('Enabled program stops cannot share an exact placement.');
    await act(async () => container.querySelector<HTMLInputElement>('[aria-label="Selected stop enabled"]')!.click());
    expect(apply.disabled).toBe(false);
    await act(async () => apply.click());
    expect(onSetStops).toHaveBeenCalledWith(operation.id,
      [operation.programStops[0], { ...operation.programStops[1], enabled: false }], true);
  });

  it('protects an edit draft when switching to a new stop and leaves the saved stop intact', async () => {
    const source = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
    ]);
    const operation = source.plan.operations[0];
    operation.programStops = [{ id: 'stop-1', enabled: true, reason: 'manual', placement: { kind: 'after-exit' } }];
    const onSelectStop = vi.fn();
    const onSetStops = vi.fn();
    const render = (blocked: boolean, selectedStopId: string | null) => root.render(
      <EditorProgramStopsPanel disabled={false} document={source} selectedOperationId={operation.id}
        selectedStopId={selectedStopId} targetChangeBlocked={blocked}
        onSelectStop={onSelectStop} onSetStops={onSetStops} />
    );
    await act(async () => render(true, 'stop-1'));
    const newStop = [...container.querySelectorAll('button')].find((button) => button.textContent === 'New stop')!;
    await act(async () => newStop.click());
    expect(onSelectStop).not.toHaveBeenCalled();
    await act(async () => render(false, 'stop-1'));
    await act(async () => newStop.click());
    expect(onSelectStop).toHaveBeenCalledWith(operation.id, null);
    await act(async () => render(false, null));
    await act(async () => setInput(container.querySelector<HTMLInputElement>('[aria-label="Program stop remaining cut millimeters"]')!, '3'));
    await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Add program stop')!.click());
    expect(onSetStops).toHaveBeenCalledWith(operation.id, [operation.programStops[0], expect.objectContaining({
      id: 'stop-2', placement: { kind: 'before-operation-end', remainingCutLengthMm: 3 }
    })], true);
  });

  it('preserves the selected stop draft when another stop is toggled', async () => {
    let source = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
    ]);
    const operationId = source.plan.operations[0].id;
    source.plan.operations[0].programStops = [
      { id: 'stop-1', enabled: true, reason: 'manual',
        placement: { kind: 'before-operation-end', remainingCutLengthMm: 1 }, note: 'original' },
      { id: 'stop-2', enabled: true, reason: 'operator-check', placement: { kind: 'after-exit' } }
    ];
    const onSetStops = vi.fn((id, stops) => {
      source = setPathOperationProgramStops(source, id, stops)!;
      render();
    });
    const render = () => root.render(<EditorProgramStopsPanel disabled={false} document={source}
      selectedOperationId={operationId} selectedStopId="stop-1" targetChangeBlocked
      onSetStops={onSetStops} />);
    await act(async () => render());
    await act(async () => setInput(
      container.querySelector<HTMLInputElement>('[aria-label="Selected stop note"]')!, 'keep the part supported'));
    await act(async () => setInput(
      container.querySelector<HTMLInputElement>('[aria-label="Selected stop remaining cut millimeters"]')!, '2.75'));
    const otherStop = container.querySelector<HTMLInputElement>('[aria-label="Enable stop-2"]')!;
    otherStop.focus();
    await act(async () => otherStop.click());

    expect(source.plan.operations[0].programStops![1].enabled).toBe(false);
    expect(container.querySelector<HTMLInputElement>('[aria-label="Selected stop note"]')!.value)
      .toBe('keep the part supported');
    expect(container.querySelector<HTMLInputElement>('[aria-label="Selected stop remaining cut millimeters"]')!.value)
      .toBe('2.75');
    expect(document.activeElement).toBe(otherStop);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Apply stop-1"]')!.click());
    expect(source.plan.operations[0].programStops).toEqual([
      { id: 'stop-1', enabled: true, reason: 'manual',
        placement: { kind: 'before-operation-end', remainingCutLengthMm: 2.75 }, note: 'keep the part supported' },
      { id: 'stop-2', enabled: false, reason: 'operator-check', placement: { kind: 'after-exit' } }
    ]);
    source = structuredClone(source);
    source.plan.operations[0].programStops![0].note = 'updated saved stop';
    await act(async () => render());
    expect(container.querySelector<HTMLInputElement>('[aria-label="Selected stop note"]')!.value)
      .toBe('updated saved stop');
  });

  it('adds a distinct stop when an imported numeric stop id exceeds precise integer arithmetic', async () => {
    const source = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
    ]);
    const operation = source.plan.operations[0];
    operation.programStops = [{ id: 'stop-9007199254740992', enabled: true,
      reason: 'manual', placement: { kind: 'after-exit' } }];
    const onSetStops = vi.fn();
    await act(async () => root.render(<EditorProgramStopsPanel disabled={false} document={source}
      selectedOperationId={operation.id} onSetStops={onSetStops} />));
    await act(async () => [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Add program stop')!.click());
    const [operationId, stops] = onSetStops.mock.calls[0];
    expect(new Set(stops.map((stop: { id: string }) => stop.id)).size).toBe(2);
    expect(setPathOperationProgramStops(source, operationId, stops)?.plan.operations[0].programStops).toHaveLength(2);
  });

  it('explains an invalid enable action without committing it', async () => {
    const source = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
    ]);
    const operation = source.plan.operations[0];
    operation.programStops = [{ id: 'stop-1', enabled: false, reason: 'manual',
      placement: { kind: 'before-operation-end', remainingCutLengthMm: 100 } }];
    const onSetStops = vi.fn();
    await act(async () => root.render(<EditorProgramStopsPanel disabled={false} document={source}
      selectedOperationId={operation.id} onSetStops={onSetStops} />));
    await act(async () => container.querySelector<HTMLInputElement>('[aria-label="Enable stop-1"]')!.click());
    expect(onSetStops).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('less than the contour length');
  });

  it('keeps hook order stable when operations appear and disappear', async () => {
    const emptyDocument = createUpidFromDxfEntities([]);
    const document = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
    ]);
    const operation = document.plan.operations[0];
    operation.programStops = [
      {
        id: 'stop-1',
        enabled: false,
        placement: { kind: 'after-exit' },
        reason: 'operator-check',
        note: 'inspect'
      }
    ];
    const onSetStops = vi.fn();

    await act(async () => root.render(
      <EditorProgramStopsPanel
        disabled={false}
        document={emptyDocument}
        onSetStops={onSetStops}
        selectedOperationId={null}
      />
    ));
    expect(container.textContent).toContain('No operation selected.');

    await act(async () => root.render(
      <EditorProgramStopsPanel
        disabled={false}
        document={document}
        onSetStops={onSetStops}
        selectedOperationId={operation.id}
        selectedStopId="stop-1"
      />
    ));

    expect(container.textContent).toContain(operation.displayName);
    expect(container.querySelector('[data-program-stop="stop-1"]')?.getAttribute('data-selected'))
      .toBe('true');
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Selected stop placement"]')?.value)
      .toBe('after-exit');

    await act(async () => root.render(
      <EditorProgramStopsPanel
        disabled={false}
        document={emptyDocument}
        onSetStops={onSetStops}
        selectedOperationId={null}
      />
    ));
    expect(container.textContent).toContain('No operation selected.');
  });

  it('authors a part-retention stop with an exact remaining distance', async () => {
    const document = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
    ]);
    const onSetStops = vi.fn();
    await act(async () => root.render(
      <EditorProgramStopsPanel
        disabled={false}
        document={document}
        onSetStops={onSetStops}
        selectedOperationId={document.plan.operations[0].id}
      />
    ));
    await act(async () => {
      setInput(
        container.querySelector<HTMLInputElement>('[aria-label="Program stop remaining cut millimeters"]')!,
        '2.5'
      );
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent?.includes('Add program stop'))
        ?.click();
    });

    expect(onSetStops).toHaveBeenCalledWith(document.plan.operations[0].id, [
      expect.objectContaining({
        enabled: true,
        placement: { kind: 'before-operation-end', remainingCutLengthMm: 2.5 },
        reason: 'part-retention'
      })
    ], true);
  });

  it('edits only the selected stop in its inline form', async () => {
    const document = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
    ]);
    const operation = document.plan.operations[0];
    operation.programStops = [
      {
        id: 'stop-1',
        enabled: true,
        placement: { kind: 'before-entry' },
        reason: 'part-retention',
        note: 'keep'
      },
      {
        id: 'stop-2',
        enabled: false,
        placement: { kind: 'after-contour' },
        reason: 'operator-check',
        note: 'inspect'
      }
    ];
    const onSetStops = vi.fn();
    await act(async () => root.render(
      <EditorProgramStopsPanel
        disabled={false}
        document={document}
        onSetStops={onSetStops}
        selectedOperationId={operation.id}
        selectedStopId="stop-2"
      />
    ));

    const selectedRow = container.querySelector('[data-program-stop="stop-2"]') as HTMLElement;
    expect(selectedRow.dataset.selected).toBe('true');
    expect(globalThis.document.activeElement).toBe(
      container.querySelector('[aria-label="Selected stop placement"]')
    );

    await act(async () => {
      setSelect(
        container.querySelector<HTMLSelectElement>('[aria-label="Selected stop placement"]')!,
        'before-operation-end'
      );
      setInput(
        container.querySelector<HTMLInputElement>('[aria-label="Selected stop remaining cut millimeters"]')!,
        '1.25'
      );
      setSelect(
        container.querySelector<HTMLSelectElement>('[aria-label="Selected stop reason"]')!,
        'manual'
      );
      setInput(
        container.querySelector<HTMLInputElement>('[aria-label="Selected stop note"]')!,
        'turn over'
      );
      (container.querySelector('button[aria-label="Apply stop-2"]') as HTMLButtonElement).click();
    });

    expect(onSetStops).toHaveBeenCalledWith(operation.id, [
      operation.programStops![0],
      {
        id: 'stop-2',
        enabled: false,
        placement: { kind: 'before-operation-end', remainingCutLengthMm: 1.25 },
        reason: 'manual',
        note: 'turn over'
      }
    ], true);
  });

  it('removes only the selected stop from its inline form', async () => {
    const document = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
    ]);
    const operation = document.plan.operations[0];
    operation.programStops = [
      { id: 'stop-1', enabled: true, placement: { kind: 'before-entry' }, reason: 'manual' },
      { id: 'stop-2', enabled: true, placement: { kind: 'after-exit' }, reason: 'operator-check' }
    ];
    const onSetStops = vi.fn();
    await act(async () => root.render(
      <EditorProgramStopsPanel
        disabled={false}
        document={document}
        onSetStops={onSetStops}
        selectedOperationId={operation.id}
        selectedStopId="stop-2"
      />
    ));

    await act(async () => {
      (container.querySelector('button[aria-label="Remove stop-2"]') as HTMLButtonElement).click();
    });

    expect(onSetStops).toHaveBeenCalledWith(operation.id, [operation.programStops[0]], true);
  });
});

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function setSelect(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}
