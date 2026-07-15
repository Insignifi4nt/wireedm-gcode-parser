import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EditorWorkflowTransitionDialog } from '../EditorWorkflowTransitionDialog';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('EditorWorkflowTransitionDialog', () => {
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

  it('renders Save and Discard as its only decision actions', async () => {
    await act(async () => root.render(
      <EditorWorkflowTransitionDialog
        nextWorkflowLabel="Entry/Exit"
        onDiscard={vi.fn()}
        onDismiss={vi.fn()}
        onSave={vi.fn()}
        open
        saveAvailability={{ enabled: true }}
        workflowLabel="Transform"
      />
    ));

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain('Transform');
    expect(dialog?.textContent).toContain('Entry/Exit');

    const allButtons = Array.from(dialog?.querySelectorAll('button') ?? []);
    const dismiss = allButtons.find(
      (button) => button.getAttribute('aria-label') === 'Dismiss workflow transition'
    );
    expect(dismiss).toBeTruthy();
    expect(allButtons.filter((button) => button !== dismiss).map((button) => button.textContent))
      .toEqual(['Discard', 'Save']);
  });

  it('disables Save and exposes its reason', async () => {
    const reason = 'Choose an entry point before saving.';
    await act(async () => root.render(
      <EditorWorkflowTransitionDialog
        nextWorkflowLabel={null}
        onDiscard={vi.fn()}
        onDismiss={vi.fn()}
        onSave={vi.fn()}
        open
        saveAvailability={{ enabled: false, reason }}
        workflowLabel="Entry/Exit"
      />
    ));

    const save = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Save');
    expect(save?.disabled).toBe(true);
    const reasonId = save?.getAttribute('aria-describedby');
    const reasonElement = reasonId ? container.querySelector<HTMLElement>(`#${reasonId}`) : null;
    expect(reasonElement?.textContent).toBe(reason);
    expect(reasonElement?.hidden).toBe(false);
  });

  it('calls only onDismiss from the X button', async () => {
    const onDiscard = vi.fn();
    const onDismiss = vi.fn();
    const onSave = vi.fn();
    await act(async () => root.render(
      <EditorWorkflowTransitionDialog
        nextWorkflowLabel="Entry/Exit"
        onDiscard={onDiscard}
        onDismiss={onDismiss}
        onSave={onSave}
        open
        saveAvailability={{ enabled: true }}
        workflowLabel="Transform"
      />
    ));

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Dismiss workflow transition"]')?.click();
    });

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('moves focus into the dialog and restores it when closed', async () => {
    const previousFocus = document.createElement('button');
    previousFocus.textContent = 'Previous focus';
    document.body.appendChild(previousFocus);
    previousFocus.focus();

    const props = {
      nextWorkflowLabel: 'Entry/Exit',
      onDiscard: vi.fn(),
      onDismiss: vi.fn(),
      onSave: vi.fn(),
      saveAvailability: { enabled: true } as const,
      workflowLabel: 'Transform'
    };
    await act(async () => root.render(
      <EditorWorkflowTransitionDialog {...props} open />
    ));

    expect(document.activeElement?.textContent).toBe('Discard');

    await act(async () => root.render(
      <EditorWorkflowTransitionDialog {...props} open={false} />
    ));
    expect(document.activeElement).toBe(previousFocus);
    previousFocus.remove();
  });

  it('traps Tab navigation within the dialog', async () => {
    await act(async () => root.render(
      <EditorWorkflowTransitionDialog
        nextWorkflowLabel="Entry/Exit"
        onDiscard={vi.fn()}
        onDismiss={vi.fn()}
        onSave={vi.fn()}
        open
        saveAvailability={{ enabled: true }}
        workflowLabel="Transform"
      />
    ));

    const dismiss = container.querySelector<HTMLButtonElement>(
      '[aria-label="Dismiss workflow transition"]'
    );
    const save = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Save');
    dismiss?.focus();
    dismiss?.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Tab',
      shiftKey: true
    }));
    expect(document.activeElement).toBe(save);

    save?.focus();
    save?.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Tab'
    }));
    expect(document.activeElement).toBe(dismiss);
  });
});
