import { afterEach, expect, it, vi } from 'vitest';
import { formatCadQuantity } from './cadDisplayQuantity';

afterEach(() => vi.restoreAllMocks());

it.each([
  [0, '0'], [-0, '0'], [20, '20'], [1 / 3, '0.333333'],
  [19.844262327110005, '19.844262'], [-19.844262327110005, '-19.844262'],
  [4e-7, '4e-7'], [-4e-7, '-4e-7'], [-6.9813170079773175e-9, '-6.98132e-9'], [1e6, '1000000'],
] as const)('formats the human quantity %s as %s while retaining nonzero sign and ordinary compact decimals', (value, label) => {
  expect(formatCadQuantity(value)).toBe(label);
});

it.each(['en-US', 'de-DE', 'ar-EG'])('retains native %s grouping, fraction and sign policies while exposing only erased nonzero values scientifically', async locale => {
  vi.resetModules();
  const NativeNumberFormat = Intl.NumberFormat;
  vi.spyOn(Intl, 'NumberFormat').mockImplementation(function(locales, options) { return new NativeNumberFormat(locales ?? locale, options); });
  const { formatCadLocalizedQuantity } = await import('./cadDisplayQuantity');
  for (const digits of [3, 4, 5, 8]) {
    for (const grouping of [undefined, false] as const) {
      const options = { maximumFractionDigits: digits, ...(grouping === undefined ? {} : { useGrouping: grouping }) };
      const ordinary = new NativeNumberFormat(locale, options);
      for (const value of [0, -0, 1000, 1234567.891234567, -1234567.891234567, 0.5 * 10 ** -digits]) {
        expect(formatCadLocalizedQuantity(value, digits, grouping)).toBe(ordinary.format(value));
      }
      const tiny = 4 * 10 ** (-digits - 1), scientific = new NativeNumberFormat(locale, { notation: 'scientific', maximumSignificantDigits: 6, useGrouping: false });
      expect(formatCadLocalizedQuantity(tiny, digits, grouping)).toBe(scientific.format(tiny));
      expect(formatCadLocalizedQuantity(-tiny, digits, grouping)).toBe(scientific.format(-tiny));
    }
  }
});
