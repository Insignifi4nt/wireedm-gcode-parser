import { createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkbenchIcon, makeIcon } from './WorkbenchIcon';

const hosts: HTMLDivElement[] = [];
afterEach(() => { hosts.forEach(host => host.remove()); hosts.length = 0; });
function mount(element: ReactNode) {
  const host = document.createElement('div'); document.body.append(host); hosts.push(host);
  const root = createRoot(host); act(() => root.render(element));
  return { host, unmount: () => act(() => root.unmount()) };
}

describe('WorkbenchIcon accessibility and integration', () => {
  it('keeps labeled buttons named once and decorative icons unfocusable', () => {
    const { host, unmount } = mount(<button aria-label="Add Pad"><WorkbenchIcon name="pad" size={15} /></button>);
    const svg = host.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('focusable')).toBe('false');
    expect(svg?.hasAttribute('role')).toBe(false);
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg?.getAttribute('width')).toBe('15');
    expect(host.querySelector('button')?.getAttribute('aria-label')).toBe('Add Pad');
    unmount();
  });
  it('exposes a standalone icon only with an accessible label', () => {
    const { host, unmount } = mount(<WorkbenchIcon name="warning" aria-label="Feature needs attention" />);
    expect(host.querySelector('svg')?.getAttribute('role')).toBe('img');
    expect(host.querySelector('svg')?.getAttribute('aria-label')).toBe('Feature needs attention');
    expect(host.querySelector('svg')?.hasAttribute('aria-hidden')).toBe(false);
    unmount();
  });
  it('forwards refs, colors, classes and real interaction handlers through named icons', () => {
    const Pad = makeIcon('pad'); const ref = createRef<SVGSVGElement>(); let clicks = 0;
    const { host, unmount } = mount(<Pad ref={ref} className="selected" color="cyan" onClick={() => clicks++} />);
    expect(ref.current).toBe(host.querySelector('svg'));
    expect(ref.current?.getAttribute('stroke')).toBe('currentColor');
    expect(ref.current?.getAttribute('class')).toBe('selected');
    act(() => ref.current?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(clicks).toBe(1);
    unmount();
  });
  it('uses an external accessible label without introducing global SVG IDs', () => {
    const { host, unmount } = mount(<><span id="caption">Round the selected edge</span><WorkbenchIcon name="fillet" aria-labelledby="caption" /><WorkbenchIcon name="chamfer" /></>);
    const icons = host.querySelectorAll('svg');
    expect(icons[0]?.getAttribute('role')).toBe('img');
    expect(icons[0]?.getAttribute('aria-labelledby')).toBe('caption');
    expect(host.querySelector('svg [id]')).toBeNull();
    expect(icons[1]?.getAttribute('aria-hidden')).toBe('true');
    unmount();
  });
});
