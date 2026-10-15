import { act, createRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Select } from './select';

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
function select() { const value = container.querySelector('select'); if (!value) throw new Error('Missing select'); return value; }

it('preserves label association and controlled native change events', async () => {
  const changed = vi.fn();
  function Controlled() {
    const [value, setValue] = useState('top');
    return <><label htmlFor="view">View angle</label><Select id="view" name="view" value={value} onChange={event => {
      changed(event.currentTarget, event.currentTarget.value); setValue(event.currentTarget.value);
    }}><option value="top">Top</option><option value="front">Front</option></Select></>;
  }
  await act(async () => root.render(<Controlled />));
  expect(select().labels?.[0]?.textContent).toBe('View angle');
  await act(async () => { select().value = 'front'; select().dispatchEvent(new Event('change', { bubbles: true })); });
  expect(changed).toHaveBeenCalledExactlyOnceWith(select(), 'front'); expect(select().value).toBe('front');
});

it('preserves uncontrolled selection, native form submission and form reset', async () => {
  await act(async () => root.render(<form><Select name="retention" defaultValue="retain"><option value="fall">Fall</option><option value="retain">Retain</option></Select></form>));
  const form = container.querySelector('form'); if (!form) throw new Error('Missing form');
  expect(new FormData(form).get('retention')).toBe('retain');
  await act(async () => { select().value = 'fall'; select().dispatchEvent(new Event('change', { bubbles: true })); });
  expect(new FormData(form).get('retention')).toBe('fall');
  form.reset(); expect(select().value).toBe('retain');
});

it('supports native multi-select size, option groups and repeated form values', async () => {
  await act(async () => root.render(<form><Select name="parts" multiple size={3} defaultValue={['plate', 'gear']}><optgroup label="Parts"><option value="plate">Plate</option><option value="gear">Gear</option></optgroup><option value="shaft" disabled>Shaft</option></Select></form>));
  const form = container.querySelector('form'); if (!form) throw new Error('Missing form');
  expect(select().size).toBe(3); expect(select().multiple).toBe(true);
  expect(new FormData(form).getAll('parts')).toEqual(['plate', 'gear']); expect(select().options[2].disabled).toBe(true);
});

it('forwards refs, focus, blur and keyboard events to the same native element', async () => {
  const ref = createRef<HTMLSelectElement>(), focus = vi.fn(), blur = vi.fn(), key = vi.fn();
  await act(async () => root.render(<Select ref={ref} onFocus={focus} onBlur={blur} onKeyDown={key}><option>Top</option></Select>));
  expect(ref.current).toBe(select());
  await act(async () => ref.current?.focus()); expect(document.activeElement).toBe(select()); expect(focus).toHaveBeenCalledOnce();
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  await act(async () => select().dispatchEvent(event)); expect(key).toHaveBeenCalledOnce(); expect(event.defaultPrevented).toBe(false);
  await act(async () => ref.current?.blur()); expect(blur).toHaveBeenCalledOnce();
});

it('retains disabled fieldset semantics, accessibility state and layout classes', async () => {
  await act(async () => root.render(<form><fieldset disabled><Select className="custom-layout" name="view" defaultValue="top" required aria-invalid="true" aria-describedby="issue"><option value="top">Top</option></Select></fieldset><p id="issue">Choose an available view.</p></form>));
  const form = container.querySelector('form'); if (!form) throw new Error('Missing form');
  expect(select().matches(':disabled')).toBe(true); expect(new FormData(form).has('view')).toBe(false);
  expect(select().required).toBe(true); expect(select().getAttribute('aria-invalid')).toBe('true');
  expect(select().getAttribute('aria-describedby')).toBe('issue'); expect(select().classList.contains('custom-layout')).toBe(true);
});
