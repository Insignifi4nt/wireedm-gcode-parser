import { act, createRef, forwardRef, useState, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Tooltip } from './tooltip';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });

const help = () => [...document.querySelectorAll('[role="tooltip"]')].map(tooltip => tooltip.textContent);
const pointer = (target: EventTarget, type: string, init: PointerEventInit = {}) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'mouse', ...init }));
/** React reports a pointer leaving through pointerout. */
const leave = (target: Element) => pointer(target, 'pointerout', { relatedTarget: document.body });
const wait = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });
const run = (step: () => unknown) => act(async () => { step(); });
const button = (name: string) => {
  const found = [...host.querySelectorAll('button')].find(candidate => candidate.textContent === name);
  if (!found) throw new Error(`Missing ${name}`);
  return found;
};

it('opens hover help after a delay, at once within a moment of closing, and not for touch', async () => {
  await run(() => root.render(<Tooltip content="Export the solid as STEP"><button type="button">STEP</button></Tooltip>));
  const step = button('STEP');
  await run(() => pointer(step, 'pointermove', { pointerType: 'touch' })); await wait(1000);
  expect(help()).toEqual([]);
  await run(() => pointer(step, 'pointermove')); await wait(399);
  expect(help()).toEqual([]);
  await wait(1);
  expect(help()).toEqual(['Export the solid as STEP']);
  expect(step.getAttribute('aria-describedby')).toBe(document.querySelector('[role="tooltip"]')?.id);
  await run(() => leave(step));
  expect(help()).toEqual([]); expect(step.hasAttribute('aria-describedby')).toBe(false);
  await wait(299); await run(() => pointer(step, 'pointermove'));
  expect(help()).toEqual(['Export the solid as STEP']);
  await run(() => leave(step)); await wait(300); await run(() => pointer(step, 'pointermove'));
  expect(help()).toEqual([]);
  await wait(400);
  expect(help()).toEqual(['Export the solid as STEP']);
});

it('keeps one help open at a time, and a control without help still closes open help', async () => {
  await run(() => root.render(<>
    <Tooltip content="Sketch on a plane"><button type="button">Sketch</button></Tooltip>
    <Tooltip content="Extrude a profile"><button type="button">Extrude</button></Tooltip>
    <Tooltip content=""><button type="button">Fillet</button></Tooltip>
  </>));
  await run(() => button('Sketch').focus());
  expect(help()).toEqual(['Sketch on a plane']);
  await run(() => pointer(button('Extrude'), 'pointermove')); await wait(400);
  expect(help()).toEqual(['Extrude a profile']);
  expect(button('Sketch').hasAttribute('aria-describedby')).toBe(false);
  await run(() => button('Fillet').focus());
  expect(help()).toEqual([]);
  expect(button('Extrude').hasAttribute('aria-describedby')).toBe(false);
});

it('keeps its control node while help appears, changes and goes', async () => {
  const ref = createRef<HTMLButtonElement>();
  const render = (content: ReactNode) => run(() => root.render(<Tooltip content={content}><button ref={ref} type="button" aria-describedby="units">Apply</button></Tooltip>));
  await render(undefined);
  const apply = button('Apply');
  await run(() => apply.focus());
  expect(help()).toEqual([]); expect(apply.getAttribute('aria-describedby')).toBe('units'); expect(apply.hasAttribute('aria-description')).toBe(false);
  // Help that appears while the control keeps focus waits for the next focus or hover, as before. The focus without help still
  // counted as opening help, so hover opens it at once.
  await render('Apply the draft');
  expect(help()).toEqual([]); expect(apply.getAttribute('aria-description')).toBe('Apply the draft');
  await run(() => pointer(apply, 'pointermove'));
  expect(help()).toEqual(['Apply the draft']);
  const id = document.querySelector('[role="tooltip"]')?.id;
  expect(apply.getAttribute('aria-describedby')).toBe(`units ${id}`);
  await render('Finish the operation first');
  expect(help()).toEqual(['Finish the operation first']); expect(document.querySelector('[role="tooltip"]')?.id).toBe(id);
  await render(false);
  expect(help()).toEqual([]); expect(apply.getAttribute('aria-describedby')).toBe('units'); expect(apply.hasAttribute('aria-description')).toBe(false);
  await render('Apply again');
  expect(help()).toEqual(['Apply again']);
  await run(() => apply.blur());
  expect(help()).toEqual([]);
  expect(ref.current).toBe(apply); expect(host.firstElementChild).toBe(apply); expect(document.activeElement).not.toBe(apply);
});

it('follows a control replaced while help is open', async () => {
  const ref = createRef<HTMLButtonElement>(), cleaned = vi.fn(), attached: (HTMLElement | null)[] = [], labelled: (HTMLElement | null)[] = [];
  const track = (node: HTMLElement | null) => { attached.push(node); return cleaned; };
  const label = (node: HTMLElement | null) => { labelled.push(node); };
  const render = (control: 'button' | 'link' | 'label') => run(() => root.render(<div className="scroller"><Tooltip content="Open the guide">
    {control === 'link' ? <a ref={track} href="#guide">Guide</a> : control === 'label' ? <span ref={label}>Guide</span> : <button ref={ref} type="button">Guide</button>}
  </Tooltip></div>));
  await render('button');
  const scroller = host.querySelector('.scroller'), guide = button('Guide');
  if (!scroller) throw new Error('Missing layout');
  await run(() => pointer(guide, 'pointermove')); await wait(400);
  expect(help()).toEqual(['Open the guide']);
  await render('link');
  const link = host.querySelector('a');
  expect(ref.current).toBeNull(); expect(attached).toEqual([link]);
  expect(help()).toEqual(['Open the guide']);
  await run(() => scroller.dispatchEvent(new Event('scroll')));
  expect(help()).toEqual([]);
  await render('label');
  expect(cleaned).toHaveBeenCalledOnce(); expect(attached).toEqual([link]);
  const span = host.querySelector('span');
  await act(async () => root.unmount());
  expect(labelled).toEqual([span, null]);
});

it('clears the control ref when a control forwards it through its own callback', async () => {
  // Such a control drops the ref cleanup and reports each removal as null, here on every render of its inline callback.
  const Forwarding = forwardRef<HTMLButtonElement, HTMLAttributes<HTMLButtonElement>>(function Forwarding(props, ref) {
    return <button type="button" ref={node => { if (typeof ref === 'function') ref(node); else if (ref) ref.current = node; }} {...props}>Forward</button>;
  });
  const ref = createRef<HTMLButtonElement>();
  const render = (content: string) => run(() => root.render(<div className="scroller"><Tooltip content={content}><Forwarding ref={ref} /></Tooltip></div>));
  await render('Move to the next profile');
  const forward = button('Forward');
  expect(ref.current).toBe(forward);
  await run(() => forward.focus());
  await render('Move to the next profile again');
  expect(ref.current).toBe(forward); expect(help()).toEqual(['Move to the next profile again']);
  // The anchor still follows the control after each null report, so a scroll that moves it closes help.
  await run(() => host.querySelector('.scroller')?.dispatchEvent(new Event('scroll')));
  expect(help()).toEqual([]);
  await act(async () => root.unmount());
  expect(ref.current).toBeNull();
});

it('positions help beside a node its control renders in place of another while help is open', async () => {
  let showLink = (_link: boolean) => {};
  const Guide = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(function Guide(props, ref) {
    const [link, setLink] = useState(false); showLink = setLink;
    return link ? <a ref={ref as Ref<HTMLAnchorElement>} href="#guide" {...props}>Guide</a> : <button ref={ref as Ref<HTMLButtonElement>} type="button" {...props}>Guide</button>;
  });
  await run(() => root.render(<Tooltip content="Open the guide"><Guide /></Tooltip>));
  await run(() => pointer(button('Guide'), 'pointermove')); await wait(400);
  expect(help()).toEqual(['Open the guide']);
  // Only the control renders again; Popper must still measure the new node.
  const measured = vi.spyOn(HTMLAnchorElement.prototype, 'getBoundingClientRect');
  await run(() => showLink(true));
  expect(help()).toEqual(['Open the guide']); expect(measured).toHaveBeenCalled();
});

it('closes help on a press, click, blur, press elsewhere or scroll that moves its control, and not for focus from a press', async () => {
  await run(() => root.render(<div className="scroller">
    <Tooltip content="Add a length"><button type="button">Length</button></Tooltip>
    <div className="list" />
  </div>));
  const length = button('Length'), scroller = host.querySelector('.scroller'), list = host.querySelector('.list');
  if (!scroller || !list) throw new Error('Missing layout');
  const reopen = () => run(() => { length.blur(); length.focus(); });
  await reopen();
  expect(help()).toEqual(['Add a length']);
  await run(() => pointer(length, 'pointerdown'));
  expect(help()).toEqual([]);
  await reopen();
  expect(help()).toEqual([]);
  await run(() => pointer(document, 'pointerup')); await reopen();
  expect(help()).toEqual(['Add a length']);
  await run(() => length.click());
  expect(help()).toEqual([]);
  // A press in the task that opened help, such as one that focuses the control, leaves it open.
  await reopen(); await run(() => pointer(list, 'pointerdown')); await run(() => pointer(document, 'pointerup'));
  expect(help()).toEqual(['Add a length']);
  await wait(0); await run(() => pointer(list, 'pointerdown')); await run(() => pointer(document, 'pointerup'));
  expect(help()).toEqual([]);
  await reopen(); await run(() => list.dispatchEvent(new Event('scroll')));
  expect(help()).toEqual(['Add a length']);
  await run(() => scroller.dispatchEvent(new Event('scroll')));
  expect(help()).toEqual([]);
  await reopen(); await run(() => length.blur());
  expect(help()).toEqual([]);
});

it('runs the control handler first and leaves help to a control that prevents the default', async () => {
  const handled = (event: { preventDefault(): void }) => event.preventDefault();
  const focused = vi.fn(handled), pressed = vi.fn(handled);
  await run(() => root.render(<>
    <Tooltip content="Trim to the nearest crossing"><button type="button" onFocus={focused}>Trim</button></Tooltip>
    <Tooltip content="Extend to the nearest crossing"><button type="button" onPointerDown={pressed}>Extend</button></Tooltip>
  </>));
  await run(() => button('Trim').focus());
  expect(focused).toHaveBeenCalledOnce(); expect(help()).toEqual([]);
  // The press still closes help as a press outside it, but the control took it, so its focus opens help.
  await run(() => pointer(button('Extend'), 'pointermove')); await wait(400); await wait(0);
  expect(help()).toEqual(['Extend to the nearest crossing']);
  await run(() => pointer(button('Extend'), 'pointerdown'));
  expect(pressed).toHaveBeenCalledOnce(); expect(help()).toEqual([]);
  await run(() => button('Extend').focus());
  expect(help()).toEqual(['Extend to the nearest crossing']);
});

it('closes help on Escape without consuming it, so the focused field still handles it', async () => {
  const escaped = vi.fn<(prevented: boolean) => void>();
  await run(() => root.render(<Tooltip content="Radius in millimetres"><input aria-label="Radius" onKeyDown={event => escaped(event.defaultPrevented)} /></Tooltip>));
  const field = host.querySelector('input'); if (!field) throw new Error('Missing radius');
  await run(() => field.focus());
  expect(help()).toEqual(['Radius in millimetres']);
  await run(() => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(help()).toEqual([]); expect(escaped).toHaveBeenCalledExactlyOnceWith(false); expect(document.activeElement).toBe(field);
});

it('leaves no timer or listener behind once removed', async () => {
  const listening = new Set<EventListenerOrEventListenerObject>();
  const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => { if (type === 'pointerup' && listener) listening.add(listener); add(type, listener, options); });
  vi.spyOn(document, 'removeEventListener').mockImplementation((type, listener, options) => { if (type === 'pointerup' && listener) listening.delete(listener); remove(type, listener, options); });
  await run(() => root.render(<>
    <Tooltip content="Mirror across a line"><button type="button">Mirror</button></Tooltip>
    <Tooltip content="Offset the selection"><button type="button">Offset</button></Tooltip>
  </>));
  const mirror = button('Mirror'), offset = button('Offset');
  // One help waits out its reopen moment while the other waits to open under a held press.
  await run(() => pointer(mirror, 'pointermove')); await wait(400); await run(() => leave(mirror));
  await run(() => { pointer(offset, 'pointermove'); pointer(offset, 'pointerdown'); });
  expect(vi.getTimerCount()).toBe(2); expect(listening.size).toBe(1);
  await act(async () => root.unmount());
  expect(vi.getTimerCount()).toBe(0); expect(listening.size).toBe(0);
});
