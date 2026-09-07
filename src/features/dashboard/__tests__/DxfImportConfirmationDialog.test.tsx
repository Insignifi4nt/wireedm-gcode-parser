import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmptyMachineLibrary } from '@/domain/machine-definition/machineLibrary';
import { createEmptyPostLibrary } from '@/domain/post-processor/postLibrary';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import {
  prepareDxfProjectImport,
  previewDxfProjectImport,
  type DxfImportPreparationResult
} from '@/domain/dxf/prepareDxfProjectImport';
import type { ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';

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

  it('shows skipped entities, retained source layers, and cleanup warnings before confirmation', async () => {
    const entity = ['0', 'LINE', '8', 'CUT 日本', '10', '0', '20', '0', '11', '10', '21', '0'];
    const preparationResult = prepare(['0', 'SECTION', '2', 'ENTITIES', ...entity, ...entity,
      '0', 'TEXT', '8', 'NOTES', '1', 'note', '0', 'ENDSEC', '0', 'EOF'].join('\n'));
    const previewResult = previewDxfProjectImport(preparationResult.preparation, { unitCandidateId: 'millimeters' });
    if (!previewResult.ok) throw new Error(previewResult.error.message);
    const onConfirm = vi.fn();
    await renderDialog({ preparationResult, previewResult, selectedUnitCandidateId: 'millimeters', onConfirm });
    const review = container.querySelector('[aria-label="DXF source review"]');
    expect(review?.textContent).toContain('CUT 日本 · 2 source entities');
    expect(review?.textContent).toContain(preparationResult.preparation.parseResult.warnings[0]);
    expect(review?.textContent).toContain(previewResult.preview.geometryWarnings[0]);
    expect(onConfirm).not.toHaveBeenCalled();
    await act(async () => button('Import and open')?.click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('requires an explicit unit candidate and exposes no machine selector or default', async () => {
    const preparationResult = prepare(lineDxf({ endX: 10, endY: 5 }));
    const onUnitCandidateChange = vi.fn();

    await renderDialog({ preparationResult, onUnitCandidateChange });

    expect(select('DXF units')?.value).toBe('');
    expect(button('Import and open')?.disabled).toBe(true);
    expect(select('Machine profile')).toBeNull();
    expect(container.textContent).not.toContain('Machine work-area limits');

    await act(async () => setSelectValue(select('DXF units')!, 'inches'));

    expect(onUnitCandidateChange).toHaveBeenCalledWith('inches');
  });

  it('shows the exact preview and gates a declared-unit conflict on acknowledgement', async () => {
    const preparationResult = prepare(lineDxf({ unitsCode: 1, endX: 2, endY: 1 }));
    const previewResult = previewDxfProjectImport(preparationResult.preparation, {
      unitCandidateId: 'millimeters'
    });
    const onConfirm = vi.fn();
    const onOverrideAcknowledgedChange = vi.fn();
    const common = {
      preparationResult,
      previewResult,
      selectedUnitCandidateId: 'millimeters',
      onConfirm,
      onOverrideAcknowledgedChange
    };

    await renderDialog(common);

    expect(container.textContent).toContain('Declared unit override');
    expect(container.querySelector('[data-testid="dxf-import-size"]')?.textContent).toContain(
      '2.000 × 1.000 mm'
    );
    expect(button('Import and open')?.disabled).toBe(true);

    const acknowledgement = container.querySelector(
      'input[aria-label="Override declared DXF units"]'
    ) as HTMLInputElement;
    await act(async () => acknowledgement.click());
    expect(onOverrideAcknowledgedChange).toHaveBeenCalledWith(true);

    await renderDialog({ ...common, declaredUnitOverrideAcknowledged: true });
    await act(async () => button('Import and open')?.click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('renders typed preparation and preview errors and never enables confirmation', async () => {
    const preparationError: DxfImportPreparationResult = {
      ok: false,
      error: {
        code: 'DXF_IMPORT_GEOMETRY_REQUIRED',
        message: 'DXF did not contain supported cut geometry.'
      }
    };
    await renderDialog({ preparationResult: preparationError });

    expect(alertMessages()).toContain('DXF did not contain supported cut geometry.');
    expect(button('Import and open')?.disabled).toBe(true);

    const preparationResult = prepare(lineDxf({}));
    await renderDialog({
      preparationResult,
      selectedUnitCandidateId: 'missing-candidate',
      previewResult: previewDxfProjectImport(preparationResult.preparation, {
        unitCandidateId: 'missing-candidate'
      })
    });

    expect(alertMessages()).toContain('DXF unit candidate was not reviewed: missing-candidate.');
    expect(button('Import and open')?.disabled).toBe(true);
  });

  it('shows physical fit only for an explicitly resolved planning machine', async () => {
    const preparationResult = prepare(lineDxf({ unitsCode: 4 }));
    const previewResult = previewDxfProjectImport(preparationResult.preparation, {
      unitCandidateId: 'millimeters'
    });
    const common = {
      preparationResult,
      previewResult,
      selectedUnitCandidateId: 'millimeters'
    };

    await renderDialog(common);
    expect(container.querySelector('[data-dxf-import-machine-fit]')).toBeNull();

    await renderDialog({
      ...common,
      planningMachineFit: {
        machine: { id: 'robofil-100', name: 'Robofil 100' },
        result: {
          ok: true,
          fit: {
            status: 'too-large',
            bounds: { xSpanMm: 10, ySpanMm: 0 },
            issues: [{ axis: 'x', actualMm: 10, limitMm: 8 }]
          }
        }
      }
    });

    expect(container.querySelector('[data-dxf-import-machine-fit="too-large"]')?.textContent)
      .toContain('Robofil 100 does not fit: X 10.000 > 8.000 mm');
  });

  async function renderDialog(
    overrides: Partial<ComponentProps<typeof DxfImportConfirmationDialog>> &
      Pick<ComponentProps<typeof DxfImportConfirmationDialog>, 'preparationResult'>
  ) {
    await act(async () => {
      root.render(
        <DxfImportConfirmationDialog
          declaredUnitOverrideAcknowledged={false}
          errorMessage={null}
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
          onOverrideAcknowledgedChange={vi.fn()}
          onUnitCandidateChange={vi.fn()}
          planningMachineFit={null}
          previewResult={null}
          selectedUnitCandidateId={null}
          submitting={false}
          {...overrides}
        />
      );
    });
  }

  function select(label: string) {
    return container.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement | null;
  }

  function button(label: string) {
    return [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === label
    ) as HTMLButtonElement | undefined;
  }

  function alertMessages() {
    return [...container.querySelectorAll('[role="alert"]')].map(({ textContent }) => textContent);
  }
});

function prepare(text: string) {
  const result = prepareDxfProjectImport(workbench(), {
    fileName: 'part.dxf',
    text,
    now: new Date('2026-08-28T10:00:00.000Z')
  });
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

function workbench(): ConnectedWorkbenchCatalog {
  const adapter: WorkbenchStorageAdapter = {
    kind: 'memory',
    name: 'Dashboard tests',
    deleteText: async () => undefined,
    ensureDirectory: async () => undefined,
    readText: async () => null,
    writeText: async () => undefined
  };
  return {
    adapter,
    machines: createEmptyMachineLibrary(),
    posts: createEmptyPostLibrary(),
    manifest: {
      format: 'wire-edm-workbench',
      schemaVersion: 3,
      name: 'Dashboard tests',
      createdAt: '2026-08-28T10:00:00.000Z',
      updatedAt: '2026-08-28T10:00:00.000Z',
      preferences: {
        importUnits: { mode: 'ask' },
        recentPlanningMachineId: null
      },
      projects: []
    }
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
