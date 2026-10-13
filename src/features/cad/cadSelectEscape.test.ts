import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCadSelectEscapeGuard } from './cadSelectEscape';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('native select Escape state', () => {
  it('allows a verified closed picker and preserves an open picker', () => {
    vi.stubGlobal('CSS', { supports: () => true });
    const select = document.createElement('select'); const guard = createCadSelectEscapeGuard(document);
    expect(guard(select)).toBe(true);
    vi.spyOn(select, 'matches').mockReturnValue(true); expect(guard(select)).toBe(false);
  });
  it('caches a functional semantic probe rather than creating DOM on every key', () => {
    const supports = vi.fn(() => true); vi.stubGlobal('CSS', { supports });
    const create = vi.spyOn(document, 'createElement'); const select = document.createElement('select');
    const guard = createCadSelectEscapeGuard(document); const count = create.mock.calls.length;
    expect(guard(select)).toBe(true); expect(guard(select)).toBe(true);
    expect(supports).toHaveBeenCalledExactlyOnceWith('selector(select:open)'); expect(create.mock.calls).toHaveLength(count + 1);
  });
  it('does not mistake inert syntax support for popup state support', () => {
    vi.stubGlobal('CSS', { supports: () => true }); const original = Element.prototype.matches;
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector) {
      return this.tagName === 'DETAILS' && selector === ':open' ? false : original.call(this, selector);
    });
    expect(createCadSelectEscapeGuard(document)(document.createElement('select'))).toBe(false);
  });
  it('keeps native behavior when CSS support or the selector implementation is unavailable', () => {
    const select = document.createElement('select');
    vi.stubGlobal('CSS', undefined); expect(createCadSelectEscapeGuard(document)(select)).toBe(false);
    vi.stubGlobal('CSS', { supports: () => false }); expect(createCadSelectEscapeGuard(document)(select)).toBe(false);
    vi.stubGlobal('CSS', { supports: () => true }); vi.spyOn(select, 'matches').mockImplementation(() => { throw new DOMException('Unsupported', 'SyntaxError'); });
    expect(createCadSelectEscapeGuard(document)(select)).toBe(false);
  });
  it('preserves native multiple and listbox select behavior', () => {
    const supports = vi.fn(() => true); vi.stubGlobal('CSS', { supports }); const guard = createCadSelectEscapeGuard(document);
    const select = document.createElement('select'); select.multiple = true; expect(guard(select)).toBe(false);
    select.multiple = false; select.size = 3; expect(guard(select)).toBe(false); expect(supports).not.toHaveBeenCalled();
  });
});
