import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWorkbenchProject } from '@/domain/workbench/defaultProject';
import { EditorProjectMachinePanel } from '@/features/editor/EditorProjectMachinePanel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('EditorProjectMachinePanel', () => {
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

  it('keeps invalid input pending and applies a reviewed project snapshot only after validation', async () => {
    const project = createWorkbenchProject({
      id: 'editable-machine-project',
      name: 'Editable machine project',
      sourceKind: 'dxf'
    });
    const onDraftChange = vi.fn();
    const onUpdateProject = vi.fn();

    await act(async () => {
      root.render(
        <EditorProjectMachinePanel
          disabled={false}
          onDraftChange={onDraftChange}
          onUpdateProject={onUpdateProject}
          project={project}
        />
      );
    });

    await changeInput('input[aria-label="Compensation validation lead length"]', '0');
    await click('button[aria-label="Review and verify project machine settings"]');

    expect(container.textContent).toContain('Lead length must be greater than 0 mm.');
    expect(onUpdateProject).not.toHaveBeenCalled();
    expect(onDraftChange).toHaveBeenCalled();

    await changeInput('input[aria-label="Compensation validation lead length"]', '0.0004');
    await changeInput('input[aria-label="Output coordinate precision"]', '4');
    await changeInput('input[aria-label="Work-area width"]', '');
    await changeInput('input[aria-label="Work-area length"]', '25');
    await click('button[aria-label="Review and verify project machine settings"]');

    expect(onUpdateProject).toHaveBeenCalledOnce();
    expect(onUpdateProject.mock.calls[0]?.[0]).toMatchObject({
      id: project.id,
      machine: {
        id: project.machine.id,
        compensation: { validationLeadLengthMm: 0.0004 },
        controller: { verification: { status: 'user-verified' } },
        output: { coordinatePrecision: 4 },
        workArea: { widthMm: null, lengthMm: 25 }
      }
    });
  });

  async function changeInput(selector: string, value: string) {
    const input = container.querySelector<HTMLInputElement>(selector);
    expect(input).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, value);
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  async function click(selector: string) {
    const button = container.querySelector<HTMLButtonElement>(selector);
    expect(button).not.toBeNull();
    await act(async () => button?.click());
  }
});
