import { act, createRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Button } from './button';
import { Input } from './input';
import { Textarea } from './textarea';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});

it('keeps controlled field events, native constraints, labels and refs while describing focused help', async () => {
  const ref = createRef<HTMLInputElement>(), changed = vi.fn();
  function Field() {
    const [value, setValue] = useState('3');
    return <form><label htmlFor="module">Module</label><p id="module-unit">Millimetres</p><Input ref={ref} id="module" name="module" type="number" min="0.1" step="0.1" required value={value} aria-describedby="module-unit" title="Tooth pitch divided by pi" onChange={event => { changed(event.currentTarget.value); setValue(event.currentTarget.value); }} /></form>;
  }
  await act(async () => root.render(<Field />));
  const input = host.querySelector('input'); if (!input) throw new Error('Missing module');
  expect(ref.current).toBe(input); expect(input.labels?.[0]?.textContent).toBe('Module');
  expect(input.min).toBe('0.1'); expect(input.step).toBe('0.1'); expect(input.required).toBe(true);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => { setter?.call(input, '4.5'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(changed).toHaveBeenCalledExactlyOnceWith('4.5'); expect(input.value).toBe('4.5');
  await act(async () => input.focus());
  const tooltip = document.querySelector('[role="tooltip"]');
  expect(tooltip?.textContent).toBe('Tooth pitch divided by pi');
  expect(input.getAttribute('aria-describedby')?.split(' ')).toEqual(['module-unit', tooltip?.id]);
  expect(input.hasAttribute('title')).toBe(false);
});

it('preserves source text selection, keyboard commands, form values and reset through the textarea ref', async () => {
  const ref = createRef<HTMLTextAreaElement>(), key = vi.fn();
  await act(async () => root.render(<form><Textarea ref={ref} name="source" className="gcode-text-input" defaultValue={'G01 X3\nM30'} onKeyDown={key} /></form>));
  const field = host.querySelector('textarea'), form = host.querySelector('form'); if (!field || !form) throw new Error('Missing source form');
  expect(ref.current).toBe(field); expect(new FormData(form).get('source')).toBe('G01 X3\nM30');
  await act(async () => { field.focus(); field.setSelectionRange(4, 6); field.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })); });
  expect(document.activeElement).toBe(field); expect(field.selectionStart).toBe(4); expect(field.selectionEnd).toBe(6); expect(key).toHaveBeenCalledOnce();
  field.value = 'M02'; form.reset(); expect(field.value).toBe('G01 X3\nM30');
});

it('describes disabled commands without changing their native focus or action semantics', async () => {
  const ref = createRef<HTMLButtonElement>(), clicked = vi.fn();
  await act(async () => root.render(<Button ref={ref} disabled aria-label="Export STEP" title="Save the current draft before exporting" onClick={clicked}>STEP</Button>));
  const button = host.querySelector('button');
  if (!button) throw new Error('Missing disabled command');
  expect(button.disabled).toBe(true); expect(ref.current).toBe(button); expect(button.getAttribute('aria-label')).toBe('Export STEP');
  expect(host.firstElementChild).toBe(button);
  expect(button.getAttribute('aria-description')).toBe('Save the current draft before exporting');
  await act(async () => { button.focus(); button.click(); });
  expect(document.activeElement).not.toBe(button); expect(clicked).not.toHaveBeenCalled();
  await act(async () => { button.dispatchEvent(new Event('pointermove', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 420)); });
  const tooltip = document.querySelector('[role="tooltip"]');
  expect(tooltip?.textContent).toBe('Save the current draft before exporting');
  expect(button.getAttribute('aria-describedby')).toBe(tooltip?.id);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
});

it('retains native nodes, edited values, file selection and focus when help and disabled state change', async () => {
  const textRef = createRef<HTMLInputElement>(), fileRef = createRef<HTMLInputElement>(), sourceRef = createRef<HTMLTextAreaElement>(), commandRef = createRef<HTMLButtonElement>();
  function Controls({ help, disabled = false }: { help?: string; disabled?: boolean }) {
    return <><Input ref={textRef} defaultValue="3" title={help} disabled={disabled} /><Input ref={fileRef} type="file" title={help} disabled={disabled} /><Textarea ref={sourceRef} defaultValue="G01 X3" title={help} disabled={disabled} /><Button ref={commandRef} title={help} disabled={disabled}>Apply</Button></>;
  }
  await act(async () => root.render(<Controls />));
  const text = textRef.current, file = fileRef.current, source = sourceRef.current, command = commandRef.current;
  if (!text || !file || !source || !command) throw new Error('Missing native controls');
  text.value = '4.5'; source.value = 'G01 X4.5'; source.setSelectionRange(4, 8);
  const selected = new File(['geometry'], 'gear.dxf'); Object.defineProperty(file, 'files', { configurable: true, value: [selected] });
  await act(async () => text.focus());
  await act(async () => root.render(<Controls help="Apply the current draft" />));
  expect(textRef.current).toBe(text); expect(fileRef.current).toBe(file); expect(sourceRef.current).toBe(source); expect(commandRef.current).toBe(command);
  expect(document.activeElement).toBe(text); expect(text.value).toBe('4.5'); expect(file.files?.[0]).toBe(selected); expect(source.selectionStart).toBe(4); expect(source.selectionEnd).toBe(8);
  await act(async () => root.render(<Controls help="Finish the current operation first" disabled />));
  expect(textRef.current).toBe(text); expect(fileRef.current).toBe(file); expect(sourceRef.current).toBe(source); expect(commandRef.current).toBe(command);
  await act(async () => root.render(<Controls />));
  expect(textRef.current).toBe(text); expect(text.value).toBe('4.5'); expect(file.files?.[0]).toBe(selected); expect(source.value).toBe('G01 X4.5');
});

it('shows help on pointer hover and preserves an enabled control as the direct layout child', async () => {
  await act(async () => root.render(<Button title="Restore the complete drawing">Fit</Button>));
  const button = host.querySelector('button'); if (!button) throw new Error('Missing fit command');
  expect(host.firstElementChild).toBe(button);
  await act(async () => { button.dispatchEvent(new Event('pointermove', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 420)); });
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('Restore the complete drawing');
});

it('dismisses help with Escape even inside a control that isolates keyboard events', async () => {
  const isolated = vi.fn();
  await act(async () => root.render(<Input title="Enter a finite coordinate" onKeyDown={event => { event.stopPropagation(); isolated(event.key); }} />));
  const input = host.querySelector('input'); if (!input) throw new Error('Missing coordinate');
  await act(async () => input.focus()); expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  await act(async () => input.dispatchEvent(escape));
  expect(isolated).toHaveBeenCalledExactlyOnceWith('Escape'); expect(escape.defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(input);
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
});

it('preserves uncontrolled checkbox, radio, range and disabled fieldset form semantics', async () => {
  const changed = vi.fn();
  await act(async () => root.render(<form>
    <label><Input name="stock" type="checkbox" defaultChecked onChange={changed} />Show stock</label>
    <Input name="view" type="radio" value="process" defaultChecked /><Input name="view" type="radio" value="part" />
    <Input name="timeline" type="range" min="0" max="100" step="0.5" defaultValue="20" />
    <fieldset disabled><Input name="blocked" defaultValue="retain" /><Button title="Wait for the current import to finish">Unavailable</Button></fieldset>
  </form>));
  const form = host.querySelector('form'), checkbox = host.querySelector<HTMLInputElement>('[name=stock]'), blocked = host.querySelector<HTMLInputElement>('[name=blocked]');
  if (!form || !checkbox || !blocked) throw new Error('Missing controls');
  expect(checkbox.labels?.[0]?.textContent).toBe('Show stock'); expect(blocked.matches(':disabled')).toBe(true);
  expect([...new FormData(form).entries()]).toEqual([['stock', 'on'], ['view', 'process'], ['timeline', '20']]);
  await act(async () => checkbox.click()); expect(changed).toHaveBeenCalledOnce(); expect(new FormData(form).has('stock')).toBe(false);
  await act(async () => form.reset()); expect(checkbox.checked).toBe(true);
  const command = host.querySelector('button'); if (!command) throw new Error('Missing inherited disabled command');
  expect(command.matches(':disabled')).toBe(true); expect(command.getAttribute('aria-description')).toBe('Wait for the current import to finish');
  await act(async () => { command.focus(); command.dispatchEvent(new Event('pointermove', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 420)); });
  expect(document.activeElement).not.toBe(command); expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('Wait for the current import to finish');
});

it('forwards native file selection events and preserves file picker constraints', async () => {
  const ref = createRef<HTMLInputElement>(), selected = vi.fn();
  await act(async () => root.render(<Input ref={ref} type="file" accept=".dxf,.cad.json" multiple onChange={event => selected(event.currentTarget.files?.[0])} />));
  const input = host.querySelector('input'); if (!input) throw new Error('Missing import picker');
  const file = new File(['0\nEOF'], 'part.dxf'); Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  expect(ref.current).toBe(input); expect(input.accept).toBe('.dxf,.cad.json'); expect(input.multiple).toBe(true); expect(selected).toHaveBeenCalledExactlyOnceWith(file);
});

it('preserves asChild anchor events and refs without an extra enabled wrapper', async () => {
  const ref = createRef<HTMLButtonElement>(), clicked = vi.fn(event => event.preventDefault());
  await act(async () => root.render(<Button asChild ref={ref} title="Read the authoring guide" onClick={clicked}><a href="/guide">Guide</a></Button>));
  const link = host.querySelector('a'); if (!link) throw new Error('Missing link');
  expect(host.firstElementChild).toBe(link); expect(ref.current).toBe(link);
  await act(async () => link.click()); expect(clicked).toHaveBeenCalledOnce(); expect(link.getAttribute('href')).toBe('/guide');
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('explains a command on keyboard focus without replacing its visible name or native form behavior', async () => {
  const ref = createRef<HTMLButtonElement>(), submitted = vi.fn();
  await act(async () => root.render(<form onSubmit={event => { event.preventDefault(); submitted(); }}><Button ref={ref} title="Write this saved revision to the active machine">Export</Button></form>));
  const button = host.querySelector('button'); if (!button) throw new Error('Missing command');
  expect(ref.current).toBe(button); expect(button.textContent).toBe('Export'); expect(button.getAttribute('aria-label')).toBeNull();
  await act(async () => button.focus());
  const tooltip = document.querySelector('[role="tooltip"]');
  expect(tooltip?.textContent).toBe('Write this saved revision to the active machine');
  expect(button.getAttribute('aria-describedby')).toBe(tooltip?.id);
  expect(button.hasAttribute('title')).toBe(false);
  await act(async () => button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  await act(async () => button.click()); expect(submitted).toHaveBeenCalledOnce();
});
