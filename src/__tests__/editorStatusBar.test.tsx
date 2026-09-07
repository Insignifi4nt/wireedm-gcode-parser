import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { PhysicalMachineFitResult } from '@/domain/machine-definition/machineFit';
import { EditorStatusBar } from '@/features/editor/EditorStatusBar';

describe('Editor status machine-fit warnings', () => {
  it.each([
    {
      result: { ok: true, fit: { status: 'too-large', bounds: { xSpanMm: 120, ySpanMm: 20 }, issues: [{ axis: 'x', actualMm: 120, limitMm: 100 }] } },
      message: 'Fit Too large'
    },
    {
      result: { ok: true, fit: { status: 'indeterminate', bounds: { xSpanMm: 120, ySpanMm: 20 }, unknownAxes: ['x'] } },
      message: 'Fit Indeterminate'
    },
    {
      result: { ok: false, error: { code: 'MACHINE_FIT_BOUNDS_INVALID', message: 'Machine fit cannot be evaluated because the geometry bounds are invalid.' } },
      message: 'Machine fit cannot be evaluated because the geometry bounds are invalid.'
    }
  ] satisfies { result: PhysicalMachineFitResult; message: string }[])(
    'keeps $message visible alongside cursor units and save state',
    ({ result, message }) => {
      const container = document.createElement('div');
      container.innerHTML = renderToStaticMarkup(
        <EditorStatusBar
          coordinateUnits="mm"
          diagnosticCount={0}
          hasUnsavedChanges
          isSaving={false}
          machineFit={result}
          onOpenDiagnostics={() => undefined}
          previewCursorPoint={{ x: 12.3456, y: 20 }}
          selectionSummary="None"
        />
      );
      expect(container.querySelector('[data-editor-status-machine-fit]')?.textContent).toBe(message);
      expect(container.querySelector('[data-editor-status-machine-fit]')?.getAttribute('role')).toBe('status');
      expect(container.querySelector('[data-editor-status-cursor]')?.textContent).toBe('Cursor X 12.346 Y 20 mm');
      expect(container.querySelector('[data-editor-document-state]')?.textContent).toBe('Modified · Unsaved');
    }
  );
});
