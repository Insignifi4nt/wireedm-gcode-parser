import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CadToolbarMenu, type CadToolbarMenuItem } from './CadToolbarMenu';

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

/** The menu beside an editor that a command can open, which takes focus as it mounts. */
function Harness({ items }: { readonly items: (openEditor: () => void) => readonly CadToolbarMenuItem[] }) {
  const [editor, setEditor] = useState(false);
  return <div className="cad-toolbar">
    <CadToolbarMenu label="Constrain" menuLabel="Sketch constraints" icon={null} disabled={false} items={items(() => setEditor(true))} />
    {editor && <input aria-label="Editor field" autoFocus />}
  </div>;
}
const trigger = () => container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
const item = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].find(button => button.textContent?.includes(label))!;

it('returns focus to its button after a command, unless the command opened an editor that took focus', async () => {
  const command = vi.fn();
  await act(async () => root.render(<Harness items={openEditor => [{ key: 'level', label: 'Horizontal', onSelect: command }, { key: 'edit', label: 'Edit value', onSelect: openEditor }]} />));
  await act(async () => trigger().click());
  expect(document.activeElement).toBe(item('Horizontal'));
  // The command closes the menu, which held focus: focus goes back to the button rather than to the page.
  await act(async () => item('Horizontal').click());
  expect(command).toHaveBeenCalledOnce(); expect(document.querySelector('[role="menu"]')).toBeNull(); expect(document.activeElement).toBe(trigger());
  await act(async () => trigger().click()); await act(async () => item('Edit value').click());
  expect(document.activeElement).toBe(container.querySelector('input[aria-label="Editor field"]'));
});
