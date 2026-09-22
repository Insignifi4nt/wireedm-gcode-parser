import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SlidingTabs } from './SlidingTabs';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('SlidingTabs keyboard selection', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  function Harness({ blocked = false }: { blocked?: boolean }) {
    const [value, setValue] = useState('editor');
    return <SlidingTabs label="Project workspace" value={value} onValueChange={setValue} tabs={[
      { value: 'editor', label: 'Editor', id: 'editor-tab', controls: 'editor-panel' },
      { value: 'simulation', label: 'Simulation', id: 'simulation-tab', controls: 'simulation-panel', disabled: blocked }
    ]} />;
  }
  function tab(id: string) { return container.querySelector<HTMLButtonElement>(`#${id}-tab`)!; }
  function press(key: string) {
    act(() => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
  }

  it('moves selection and focus with arrow keys, wraps, and supports Home/End', () => {
    act(() => root.render(<Harness />));
    tab('editor').focus();
    press('ArrowRight');
    expect(document.activeElement).toBe(tab('simulation'));
    expect(tab('simulation').getAttribute('aria-selected')).toBe('true');
    expect(tab('simulation').getAttribute('aria-controls')).toBe('simulation-panel');
    expect(tab('editor').tabIndex).toBe(-1);
    press('ArrowRight');
    expect(document.activeElement).toBe(tab('editor'));
    press('End');
    expect(document.activeElement).toBe(tab('simulation'));
    press('Home');
    expect(document.activeElement).toBe(tab('editor'));
    press('ArrowLeft');
    expect(document.activeElement).toBe(tab('simulation'));
  });

  it('keeps unavailable simulation out of keyboard and pointer activation', () => {
    act(() => root.render(<Harness blocked />));
    tab('editor').focus();
    press('End');
    press('ArrowRight');
    act(() => tab('simulation').click());
    expect(document.activeElement).toBe(tab('editor'));
    expect(tab('editor').getAttribute('aria-selected')).toBe('true');
    expect(tab('simulation').disabled).toBe(true);
  });
});
