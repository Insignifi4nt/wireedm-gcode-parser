import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';

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
      selectedOperationId={operation.id} selectedStopId="stop-2" onSetStops={onSetStops} />));
    const add = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Add program stop'))!;
    const apply = container.querySelector<HTMLButtonElement>('[aria-label="Apply stop-2"]')!;
    expect(add.disabled).toBe(true);
    expect(apply.disabled).toBe(true);
    expect(container.textContent).toContain('Enabled program stops cannot share an exact placement.');
    await act(async () => container.querySelector<HTMLInputElement>('[aria-label="Selected stop enabled"]')!.click());
    expect(apply.disabled).toBe(false);
    await act(async () => apply.click());
    expect(onSetStops).toHaveBeenCalledWith(operation.id,
      [operation.programStops[0], { ...operation.programStops[1], enabled: false }], true);
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
