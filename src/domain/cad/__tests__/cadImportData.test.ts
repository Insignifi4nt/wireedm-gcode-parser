import { describe, expect, it, vi } from 'vitest';
import { isCadImportData } from '../cadImportData';

describe('CAD plain-data integrity without guessed input-size policies', () => {
  it('accepts complete large coordinate data and finite values beyond the former traversal threshold', () => {
    const coordinates = Array.from({ length: 200_005 }, (_, index) => index / 10);
    expect(isCadImportData({ coordinates, label: 'Piesă Ω 名称', flags: [true, false, null] })).toBe(true);
  });
  it('walks deep plain data iteratively and distinguishes shared subtrees from cycles', () => {
    let data: object = { leaf: 2.123456789012345 };
    for (let index = 0; index < 10_000; index++) data = { child: data };
    expect(isCadImportData(data)).toBe(true);
    const shared = { center: [1, 2, 3] };
    expect(isCadImportData([shared, shared])).toBe(true);
    const cyclic: { child?: object } = {}; cyclic.child = cyclic;
    expect(isCadImportData(cyclic)).toBe(false);
    const array: unknown[] = []; array.push({ back: array });
    expect(isCadImportData(array)).toBe(false);
  });
  it('rejects executable or incomplete own data without invoking its getters', () => {
    const getter = vi.fn(() => 10);
    const accessor = Object.defineProperty({ label: 'Original' }, 'coordinate', { enumerable: true, get: getter });
    const hidden = Object.defineProperty({ x: 1 }, 'y', { enumerable: false, value: 2 });
    const inherited = Object.create({ x: 1 });
    const symbol = { x: 1, [Symbol('secret')]: 2 };
    const sparse = new Array(2); sparse[1] = 4;
    const arrayMetadata = Object.assign([1, 2], { extra: 3 });
    for (const data of [accessor, hidden, inherited, symbol, sparse, arrayMetadata, { n: Infinity }, { n: NaN },
      { n: undefined }, { n: BigInt(1) }, { n: () => 1 }, new Date()]) {
      expect(isCadImportData(data)).toBe(false);
    }
    expect(getter).not.toHaveBeenCalled();
  });
  it('accepts detached null-prototype records and frozen tuples while rejecting dishonest array keys', () => {
    expect(isCadImportData(Object.assign(Object.create(null), { x: 1, y: Object.freeze([2, 3]) }))).toBe(true);
    const disguised = [1, 2]; delete disguised[0]; Object.defineProperty(disguised, 'extra', { enumerable: true, value: 3 });
    expect(isCadImportData(disguised)).toBe(false);
  });
});
