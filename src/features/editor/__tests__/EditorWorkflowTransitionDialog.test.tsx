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

    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('Transform');
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('Entry/Exit');
    expect(Array.from(
      container.querySelectorAll<HTMLButtonElement>('[data-editor-workflow-transition-action]')
    ).map((button) => button.textContent)).toEqual(['Discard', 'Save']);
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
    expect(save?.getAttribute('aria-describedby')).toBeTruthy();
    expect(container.textContent).toContain(reason);
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
});
