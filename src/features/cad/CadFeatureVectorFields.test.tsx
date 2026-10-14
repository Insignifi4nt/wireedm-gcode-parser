import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CadFeature } from '@/domain/cad/cadDocument';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { CadFeatureEditor } from './CadFeatureEditor';

let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const move = { id: 'move', name: 'Move 1', kind: 'transform', suppressed: false, sourceId: 'stock', translation: [1.123456789, 'step', -4], rotation: [0, 'turn', 5] } satisfies CadFeature;
const linear = { id: 'linear', name: 'Linear pattern 1', kind: 'linear-pattern', suppressed: false, sourceId: 'stock', count: 3, spacing: [30, 'step', 0] } satisfies CadFeature;
const circular = { id: 'circular', name: 'Circular pattern 1', kind: 'circular-pattern', suppressed: false, sourceId: 'stock', count: 4, axis: 'z', angle: 'turn', center: ['step', 0, 0] } satisfies CadFeature;

it.each([
  { feature: move, group: 'Translation', label: 'Translation X mm', value: 'step / 2', expected: { ...move, translation: ['step / 2', 'step', -4] } },
  { feature: move, group: 'Rotation about world origin', label: 'Around Y deg', value: '-turn / 2', expected: { ...move, rotation: [0, '-turn / 2', 5] } },
  { feature: linear, group: 'Spacing between instances', label: 'Spacing Z mm', value: 'step * 2', expected: { ...linear, spacing: [30, 'step', 'step * 2'] } },
  { feature: circular, group: 'Axis center', label: 'Center Z mm', value: '0.123456789', expected: { ...circular, center: ['step', 0, 0.123456789] } }
] satisfies { feature: CadFeature; group: string; label: string; value: string; expected: CadFeature }[])('edits $group as one vector while preserving its other values, name and expression definitions', async ({ feature, group, label, value, expected }) => {
  const document = parseCadDocument({ ...createCadDocument(), parameters: { step: 10, turn: 180 }, features: [
    { id: 'outline', name: 'Outline', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [{ id: 'rectangle', name: 'Rectangle', construction: false, geometry: { kind: 'rectangle', x: 20, y: 0, width: 5, height: 5, cornerRadius: 0 } }] },
    { id: 'stock', name: 'Stock', kind: 'extrude', suppressed: false, sketchId: 'outline', distance: 5, symmetric: false, operation: 'new', targetId: null }, feature
  ] }), before = JSON.stringify(document), onApply = vi.fn();
  await act(async () => root.render(<CadFeatureEditor feature={feature} document={document} isNew={false} onApply={onApply} onCancel={vi.fn()} onPendingChange={vi.fn()} />));
  const vector = container.querySelector(`[role="group"][aria-label="${group}"]`);
  expect(vector?.querySelectorAll('input')).toHaveLength(3);
  const input = vector?.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`), setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!input || !setter) throw new Error('Vector field missing');
  if (Number.isFinite(Number(value))) {
    await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
  } else {
    const name = label.replace(/ (mm|deg)$/, '').replace(/^(Translation|Spacing) /, ''), trigger = vector?.querySelector<HTMLButtonElement>(`button[aria-label="Edit ${name} relation"]`);
    if (!trigger) throw new Error('Missing relation action'); await act(async () => trigger.click());
    const expression = window.document.querySelector<HTMLInputElement>(`input[aria-label="${name} expression"]`); if (!expression) throw new Error('Missing expression field');
    await act(async () => { setter.call(expression, value); expression.dispatchEvent(new Event('input', { bubbles: true })); });
    const keep = [...window.document.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Keep relation'), close = window.document.querySelector<HTMLButtonElement>(`button[aria-label="Close ${name} relation help"]`);
    if (!keep || !close) throw new Error('Missing relation actions'); await act(async () => keep.click()); await act(async () => close.click());
  }
  expect(onApply).not.toHaveBeenCalled();
  const apply = container.querySelector<HTMLButtonElement>('button[type="submit"]'); if (!apply) throw new Error('Missing Apply');
  await act(async () => apply.click());
  expect(onApply).toHaveBeenCalledExactlyOnceWith(expected, {});
  expect(JSON.stringify(document)).toBe(before);
});
