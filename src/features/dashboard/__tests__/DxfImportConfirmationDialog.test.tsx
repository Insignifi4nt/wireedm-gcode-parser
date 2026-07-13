import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeMachineProfile } from '@/domain/machine/machineProfiles';
import {
  prepareDxfProjectImport,
  previewDxfProjectImport,
  unitCandidatesForDxfImport
} from '@/domain/dxf/prepareDxfProjectImport';
import type { ConnectedWorkbench, WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorage';
import { createDefaultMachineProfile } from '@/domain/workbench/defaultProject';
import type { MachineProfile } from '@/domain/workbench/types';

import { DxfImportConfirmationDialog } from '../DxfImportConfirmationDialog';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('DxfImportConfirmationDialog', () => {
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

  it('shows the reviewed unit, millimeter bounds, counts, fit, and live selectors', async () => {
    const selected = machine('inch-machine', 'inches', { widthMm: 250, lengthMm: 130 });
    const other = machine('other-machine', null, { widthMm: 500, lengthMm: 500 });
    const preparation = prepareDxfProjectImport(workbench([selected, other], selected.id), {
      fileName: 'unitless-part.dxf',
      text: lineDxf({ endX: 10, endY: 5 })
    });
    const selection = preparation.defaultSelection;
    const preview = previewDxfProjectImport(preparation, selection);
    const onMachineProfileChange = vi.fn();
    const onUnitCandidateChange = vi.fn();

    await renderDialog({
      preparation,
      preview,
      selection,
      unitCandidates: preview.unitCandidates,
      onMachineProfileChange,
      onUnitCandidateChange
    });

    expect(dialog()?.textContent).toContain('unitless-part.dxf');
    expect(dialog()?.textContent).toContain('Machine suggestion');
    expect(dialog()?.textContent).toContain('1 supported');
    expect(dialog()?.textContent).toContain('0 unsupported');
    expect(dialog()?.textContent).toContain('0 warnings');
    expect(container.querySelector('[data-testid="dxf-import-size"]')?.textContent).toContain(
      '254.000 × 127.000 mm'
    );
    expect(container.querySelector('[data-dxf-import-machine-fit="too-large"]')?.textContent).toContain(
      'width 254.000 > 250.000 mm'
    );
    expect(select('DXF units')?.value).toBe('inches');
    expect(select('Machine profile')?.value).toBe(selected.id);

    await act(async () => {
      setSelectValue(select('DXF units')!, 'millimeters');
      setSelectValue(select('Machine profile')!, other.id);
    });

    expect(onUnitCandidateChange).toHaveBeenCalledWith('millimeters');
    expect(onMachineProfileChange).toHaveBeenCalledWith(other.id);
  });

  it('blocks a declared-unit override until it is explicitly acknowledged', async () => {
    const selected = machine('selected-machine', null);
    const preparation = prepareDxfProjectImport(workbench([selected], selected.id), {
      fileName: 'declared-inch.dxf',
      text: lineDxf({ unitsCode: 1, endX: 1 })
    });
    const selection = {
      machineProfileId: selected.id,
      unitCandidateId: 'millimeters'
    };
    const preview = previewDxfProjectImport(preparation, selection);
    const onOverrideAcknowledgedChange = vi.fn();

    await renderDialog({
      preparation,
      preview,
      selection,
      unitCandidates: unitCandidatesForDxfImport(preparation, selected.id),
      onOverrideAcknowledgedChange
    });

    expect(dialog()?.textContent).toContain('User override');
    expect(button('Import and open')?.disabled).toBe(true);
    const acknowledgement = container.querySelector(
      'input[aria-label="Override declared DXF units"]'
    ) as HTMLInputElement | null;
    expect(acknowledgement).not.toBeNull();

    await act(async () => acknowledgement?.click());

    expect(onOverrideAcknowledgedChange).toHaveBeenCalledWith(true);
  });

  it('reports preview errors and keeps confirmation disabled', async () => {
    const selected = machine('selected-machine', null);
    const preparation = prepareDxfProjectImport(workbench([selected], selected.id), {
      fileName: 'bad-preview.dxf',
      text: lineDxf({})
    });

    await renderDialog({
      preparation,
      preview: null,
      previewErrorMessage: 'DXF unit preview produced invalid millimeter bounds.',
      selection: preparation.defaultSelection,
      unitCandidates: preparation.unitCandidates
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'invalid millimeter bounds'
    );
    expect(button('Import and open')?.disabled).toBe(true);
  });

  it('focuses and traps the modal, cancels on Escape while idle, and restores focus', async () => {
    const opener = document.createElement('button');
    opener.textContent = 'Import DXF';
    document.body.insertBefore(opener, container);
    opener.focus();
    const selected = machine('selected-machine', null);
    const preparation = prepareDxfProjectImport(workbench([selected], selected.id), {
      fileName: 'focus.dxf',
      text: lineDxf({})
    });
    const preview = previewDxfProjectImport(preparation, preparation.defaultSelection);
    const onCancel = vi.fn();

    await renderDialog({
      preparation,
      preview,
      selection: preparation.defaultSelection,
      unitCandidates: preview.unitCandidates,
      onCancel
    });

    const background = container.querySelector('[data-dialog-background]') as HTMLElement;
    expect(background.inert).toBe(true);
    expect(background.getAttribute('aria-hidden')).toBe('true');
    expect(opener.inert).toBe(true);
    expect(opener.getAttribute('aria-hidden')).toBe('true');
    expect(document.activeElement).toBe(select('DXF units'));
    const last = button('Import and open')!;
    last.focus();
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Tab', bubbles: true, cancelable: true
    })));
    expect(document.activeElement).toBe(
      container.querySelector('button[aria-label="Close DXF import review"]')
    );

    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', bubbles: true, cancelable: true
    })));
    expect(onCancel).toHaveBeenCalledTimes(1);

    await act(async () => root.render(<main aria-hidden="false" data-dialog-background />));
    const restoredBackground = container.querySelector('[data-dialog-background]') as HTMLElement;
    expect(restoredBackground.inert).toBeUndefined();
    expect(restoredBackground.getAttribute('aria-hidden')).toBe('false');
    expect(opener.inert).toBeUndefined();
    expect(opener.getAttribute('aria-hidden')).toBeNull();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('cannot be dismissed while a confirmed import is being committed', async () => {
    const selected = machine('selected-machine', null);
    const preparation = prepareDxfProjectImport(workbench([selected], selected.id), {
      fileName: 'busy.dxf',
      text: lineDxf({})
    });
    const preview = previewDxfProjectImport(preparation, preparation.defaultSelection);
    const onCancel = vi.fn();

    await renderDialog({
      preparation,
      preview,
      selection: preparation.defaultSelection,
      unitCandidates: preview.unitCandidates,
      submitting: true,
      onCancel
    });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      container.querySelector('[data-dxf-import-overlay]')?.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true })
      );
    });

    expect(onCancel).not.toHaveBeenCalled();
    expect(button('Cancel')?.disabled).toBe(true);
    expect(button('Importing...')?.disabled).toBe(true);
  });

  it('locks the project machine and requires destructive acknowledgement in reimport mode', async () => {
    const selected = machine('project-machine', null);
    const preparation = prepareDxfProjectImport(workbench([selected], selected.id), {
      fileName: 'persisted-raw.dxf',
      text: lineDxf({ unitsCode: 1 })
    });
    const selection = {
      machineProfileId: selected.id,
      unitCandidateId: 'millimeters'
    };
    const preview = previewDxfProjectImport(preparation, selection);
    const onRebuildAcknowledgedChange = vi.fn();

    await renderDialog({
      mode: 'reimport',
      machineProfileLocked: true,
      rebuildRequired: true,
      rebuildAcknowledged: false,
      preparation,
      preview,
      selection,
      unitCandidates: preview.unitCandidates,
      declaredUnitOverrideAcknowledged: true,
      onRebuildAcknowledgedChange
    });

    expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(
      'Review DXF unit re-import'
    );
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
      'Re-import DXF with Different Units'
    );
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
      'saved geometry-derived edits'
    );
    expect(select('Machine profile')?.disabled).toBe(true);
    expect(button('Re-import and open')?.disabled).toBe(true);
    const acknowledgement = container.querySelector(
      'input[aria-label="Rebuild path geometry from raw DXF"]'
    ) as HTMLInputElement;

    await act(async () => acknowledgement.click());

    expect(onRebuildAcknowledgedChange).toHaveBeenCalledWith(true);
  });

  async function renderDialog(overrides: Partial<ComponentProps<typeof DxfImportConfirmationDialog>> & Pick<ComponentProps<typeof DxfImportConfirmationDialog>, 'preparation' | 'preview' | 'selection' | 'unitCandidates'>) {
    await act(async () => {
      root.render(
        <>
          <main aria-hidden="false" data-dialog-background />
          <DxfImportConfirmationDialog
            declaredUnitOverrideAcknowledged={false}
            errorMessage={null}
            onCancel={vi.fn()}
            onConfirm={vi.fn()}
            onMachineProfileChange={vi.fn()}
            onOverrideAcknowledgedChange={vi.fn()}
            onRebuildAcknowledgedChange={vi.fn()}
            onUnitCandidateChange={vi.fn()}
            previewErrorMessage={null}
            submitting={false}
            {...overrides}
          />
        </>
      );
    });
  }

  function dialog() {
    return container.querySelector('[role="dialog"][aria-label="Review DXF import"]');
  }

  function select(label: string) {
    return container.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement | null;
  }

  function button(label: string) {
    return [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === label
    ) as HTMLButtonElement | undefined;
  }
});

function machine(
  id: string,
  preferredDxfImportUnit: MachineProfile['preferredDxfImportUnit'],
  workArea: MachineProfile['workArea'] = { widthMm: null, lengthMm: null }
) {
  return normalizeMachineProfile({
    ...createDefaultMachineProfile(),
    id,
    name: id,
    preferredDxfImportUnit,
    workArea
  });
}

function workbench(profiles: MachineProfile[], activeMachineProfileId: string): ConnectedWorkbench {
  const adapter: WorkbenchStorageAdapter = {
    kind: 'memory',
    name: 'Dialog test',
    deleteText: async () => undefined,
    ensureDirectory: async () => undefined,
    readText: async () => null,
    writeText: async () => undefined
  };
  const activeMachineProfile = profiles.find(({ id }) => id === activeMachineProfileId)!;
  return {
    adapter,
    manifest: {
      schemaVersion: 1,
      name: 'Dialog test',
      createdAt: '2026-07-13T10:00:00.000Z',
      updatedAt: '2026-07-13T10:00:00.000Z',
      templates: { headerPath: 'templates/header.gcode', footerPath: 'templates/footer.gcode' },
      output: activeMachineProfile.output,
      activeMachineProfileId,
      machineProfiles: profiles,
      projects: []
    },
    activeMachineProfile,
    header: activeMachineProfile.templates.header,
    footer: activeMachineProfile.templates.footer
  };
}

function lineDxf({
  endX = 10,
  endY = 0,
  unitsCode
}: { endX?: number; endY?: number; unitsCode?: number }) {
  return [
    '0', 'SECTION', '2', 'HEADER',
    ...(unitsCode === undefined ? [] : ['9', '$INSUNITS', '70', String(unitsCode)]),
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LINE', '10', '0', '20', '0', '11', String(endX), '21', String(endY),
    '0', 'ENDSEC', '0', 'EOF'
  ].join('\n');
}

function setSelectValue(element: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set?.call(
    element,
    value
  );
  element.dispatchEvent(new Event('change', { bubbles: true }));
}
