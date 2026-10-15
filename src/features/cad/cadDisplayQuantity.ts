/** Compact human readouts retain a nonzero quantity when decimal rounding erases it. */
export function formatCadQuantity(value: number): string {
  const rounded = Number(value.toFixed(6));
  return String(rounded === 0 && value !== 0 ? Number(value.toPrecision(6)) : rounded);
}

const localizedFormats = new Map<string, { formatter: Intl.NumberFormat; zero: string; negativeZero: string }>();
let scientificFormat: Intl.NumberFormat | undefined;

/** Keep each readout's locale policy; only a displayed zero needs scientific fallback. */
export function formatCadLocalizedQuantity(value: number, maximumFractionDigits: number, useGrouping?: boolean): string {
  const key = `${maximumFractionDigits}/${useGrouping}`;
  let format = localizedFormats.get(key);
  if (!format) {
    const formatter = new Intl.NumberFormat(undefined, { maximumFractionDigits, ...(useGrouping === undefined ? {} : { useGrouping }) });
    format = { formatter, zero: formatter.format(0), negativeZero: formatter.format(-0) };
    localizedFormats.set(key, format);
  }
  const label = format.formatter.format(value);
  if (value === 0 || label !== format.zero && label !== format.negativeZero) return label;
  scientificFormat ??= new Intl.NumberFormat(undefined, { notation: 'scientific', maximumSignificantDigits: 6, useGrouping: false });
  return scientificFormat.format(value);
}
