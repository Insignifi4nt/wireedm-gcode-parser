import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  cleanupAppTestContext,
  confirmPendingDxfImport,
  createAppTestContext,
  enableAutoOpenEditorWorkspacePanels,
  flushAsync,
  parseSvgViewBox,
  renderApp,
  setInputValue,
  type AppTestContext
} from './appTestHelpers';

describe('Editor construction regressions', () => {
  let context: AppTestContext;
  let container: HTMLDivElement;

  beforeEach(() => {
    enableAutoOpenEditorWorkspacePanels();
    context = createAppTestContext();
    container = context.container;
  });

  afterEach(() => {
    cleanupAppTestContext(context);
  });

  it('commits the preview operation without a preselected path operation', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const fileInput = container.querySelector(
      'input[aria-label="DXF file"]'
    ) as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([rectangleDxf()], 'construction-without-selection.dxf')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();
    await confirmPendingDxfImport(container);

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        '[data-editor-workflow-command="view.contours"]'
      )?.click();
    });
    await flushAsync();
    await act(async () => {
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Toggle canvas hover assist"]'
      )?.click();
      container.querySelector<HTMLButtonElement>(
        '[data-editor-workflow-command="construction.measurement"]'
      )?.click();
    });
    await flushAsync();

    expect(
      container.querySelector('[data-upid-cut-sequence-row][data-upid-selected="true"]')
    ).toBeNull();

    const pointXInput = container.querySelector(
      'input[aria-label="Measurement point X"]'
    ) as HTMLInputElement | null;
    const pointYInput = container.querySelector(
      'input[aria-label="Measurement point Y"]'
    ) as HTMLInputElement | null;
    const addPointButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Add Point')
    );

    await act(async () => {
      if (pointXInput) setInputValue(pointXInput, '5');
      if (pointYInput) setInputValue(pointYInput, '2');
      addPointButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('[data-measurement-point-row="1"]')).not.toBeNull();

    const preview = container.querySelector(
      'svg[aria-label="UPID path preview"]'
    ) as SVGSVGElement | null;
    expect(preview).not.toBeNull();
    Object.defineProperty(preview, 'getBoundingClientRect', {
      value: () => ({
        left: 10,
        top: 20,
        width: 120,
        height: 120,
        right: 130,
        bottom: 140,
        x: 10,
        y: 20,
        toJSON: () => ({})
      }),
      configurable: true
    });

    const snapToggle = container.querySelector(
      'input[aria-label="Toggle construction magnetic snap"]'
    ) as HTMLInputElement | null;
    const perpendicularButton = container.querySelector(
      'button[aria-label="Magnetize latest point perpendicular"]'
    ) as HTMLButtonElement | null;
    expect(snapToggle).not.toBeNull();
    expect(perpendicularButton).not.toBeNull();

    await act(async () => {
      snapToggle?.click();
    });
    await act(async () => {
      perpendicularButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      preview?.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          ...worldClientPoint(preview!, { x: 5, y: 5 })
        })
      );
    });
    await flushAsync();

    const constructionPreview = container.querySelector(
      '[data-upid-construction-preview]'
    );
    const previewOperationId = constructionPreview?.getAttribute(
      'data-upid-construction-operation'
    );
    expect(constructionPreview).not.toBeNull();
    expect(previewOperationId).toBeTruthy();

    await act(async () => {
      preview?.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          ...worldClientPoint(preview!, { x: 5, y: 5 })
        })
      );
    });
    await flushAsync();

    const savedPoint = container.querySelector('[data-measurement-point-row="2"]');
    expect(savedPoint).not.toBeNull();
    expect(savedPoint?.getAttribute('data-measurement-point-operation')).toBe(
      previewOperationId
    );
  });
});

function rectangleDxf() {
  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'LWPOLYLINE',
    '90',
    '4',
    '70',
    '1',
    '10',
    '0',
    '20',
    '0',
    '10',
    '10',
    '20',
    '0',
    '10',
    '10',
    '20',
    '5',
    '10',
    '0',
    '20',
    '5',
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}

function worldClientPoint(preview: SVGSVGElement, point: { x: number; y: number }) {
  const viewBox = parseSvgViewBox(preview.getAttribute('viewBox') || '0 0 1 1');
  const rect = preview.getBoundingClientRect();
  const scale = Math.min(rect.width / viewBox.width, rect.height / viewBox.height);
  const renderedWidth = viewBox.width * scale;
  const renderedHeight = viewBox.height * scale;
  const offsetX = (rect.width - renderedWidth) / 2;
  const offsetY = (rect.height - renderedHeight) / 2;
  const flipY = 5;

  return {
    clientX: rect.left + offsetX + (point.x - viewBox.minX) * scale,
    clientY: rect.top + offsetY + (flipY - point.y - viewBox.minY) * scale
  };
}
