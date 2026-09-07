import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { EditorMeasurePanel } from '../EditorMeasurePanel';
import { useEditorMeasurement } from '../useEditorMeasurement';

describe('source feature measurement panel', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  it('distinguishes picked points, center distance, and boundary gap without changing the document', async () => {
    const source = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 },
      { type: 'circle', layer: 'CUT', center: { x: 12, y: 0 }, radius: 3 }
    ]);
    const saved = JSON.stringify(source);
    function Harness() {
      const measurement = useEditorMeasurement(source.segments);
      return <>
        <button onClick={() => measurement.onPick({ x: 0, y: 0 }, 0.01)}>First center</button>
        <button onClick={() => measurement.onPick({ x: 9, y: 0 }, 0.01)}>Second edge</button>
        <EditorMeasurePanel measurement={measurement} document={source} />
      </>;
    }
    await act(async () => root.render(<Harness />));
    const click = async (label: string) => {
      const button = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === label);
      if (!button) throw new Error(`Missing ${label}`);
      await act(async () => button.click());
    };
    await click('First center');
    expect(container.querySelector('[aria-label="Feature measurements"]')).toBeNull();
    await click('Second edge');
    expect(container.querySelector('[aria-label="Point measurements"]')?.textContent).toContain('Point distance9.000 mm');
    expect(container.querySelector('[aria-label="Feature measurements"]')?.textContent).toContain('Minimum feature gap4.000 mm');
    expect(container.querySelector('[aria-label="Feature measurements"]')?.textContent).toContain('Center distance12.000 mm');
    await click('Clear measurement');
    expect(container.querySelector('[aria-label="Feature measurements"]')).toBeNull();
    expect(JSON.stringify(source)).toBe(saved);
  });
});
