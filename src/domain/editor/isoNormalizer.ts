const DEFAULT_PRECISION = 3;

export interface NormalizeToISOOptions {
  startN?: number;
  step?: number;
  addPercent?: boolean;
  ensureM02?: boolean;
  crlf?: boolean;
  stripSemicolon?: boolean;
}

export interface BuildISOFromPointsOptions {
  startN?: number;
  step?: number;
  crlf?: boolean;
  precision?: number;
  feed?: number | null;
  headerCodes?: string[];
}

export interface XYPoint {
  x: number;
  y: number;
}

export function normalizeToISO(inputText: string, options: NormalizeToISOOptions = {}) {
  const {
    startN = 10,
    step = 10,
    addPercent = true,
    ensureM02 = true,
    crlf = true,
    stripSemicolon = true
  } = options;

  const srcLines = String(inputText ?? '').split(/\r?\n/);
  const outLines: string[] = [];

  if (addPercent) {
    if (!srcLines.length || srcLines[0].trim() !== '%') {
      outLines.push('%');
    } else {
      outLines.push('%');
      srcLines.shift();
    }
  }

  let n = startN;
  for (const line of srcLines) {
    if (!line) continue;

    let s = line.trim();
    if (!s || s.startsWith('%')) continue;

    if (stripSemicolon) {
      const semicolonIndex = s.indexOf(';');
      if (semicolonIndex >= 0) {
        s = s.slice(0, semicolonIndex).trimEnd();
        if (!s) continue;
      }

      s = s.replace(/\([^)]*\)/g, '').trim();
      if (!s) continue;
    }

    s = canonicalizeMotionCodes(stripLeadingBlockNumber(s).replace(/\s+/g, ' ').trim());

    if (ensureM02 && /\bM0?2\b/i.test(s)) continue;

    outLines.push(`N${n} ${s}`);
    n += step;
  }

  if (ensureM02) {
    const withoutEndCommands = outLines.filter((line) => !/\bM0?2\b/i.test(line));
    outLines.length = 0;
    outLines.push(...withoutEndCommands, `N${n} M02`);
  }

  const eol = crlf ? '\r\n' : '\n';
  return `${outLines.join(eol)}${eol}`;
}

export function buildISOFromPoints(points: XYPoint[], options: BuildISOFromPointsOptions = {}) {
  const {
    startN = 10,
    step = 10,
    crlf = true,
    precision = DEFAULT_PRECISION,
    feed = null,
    headerCodes = ['G92', 'G60', 'G38', 'G42 D0', 'G90']
  } = options;

  const out = ['%'];
  let n = startN;

  for (const code of headerCodes) {
    out.push(`N${n} ${code}`);
    n += step;
  }

  if (!points.length) {
    out.push(`N${n} M02`);
    const eol = crlf ? '\r\n' : '\n';
    return `${out.join(eol)}${eol}`;
  }

  const format = (value: number) => Number(value).toFixed(precision);
  const [firstPoint, ...cutPoints] = points;
  out.push(`N${n} G0 X${format(firstPoint.x)} Y${format(firstPoint.y)}`);
  n += step;

  cutPoints.forEach((point, index) => {
    const line =
      index === 0 && typeof feed === 'number'
        ? `N${n} G1 X${format(point.x)} Y${format(point.y)} F${feed}`
        : `N${n} G1 X${format(point.x)} Y${format(point.y)}`;
    out.push(line);
    n += step;
  });

  out.push(`N${n} M02`);
  const eol = crlf ? '\r\n' : '\n';
  return `${out.join(eol)}${eol}`;
}

export function stripForEditing(inputText: string) {
  if (typeof inputText !== 'string') return '';

  const lines = inputText.split(/\r?\n/);
  const out: string[] = [];
  let startIndex = 0;

  if (lines.length && lines[0].trim() === '%') {
    startIndex = 1;
  }

  for (let index = startIndex; index < lines.length; index++) {
    const line = lines[index];
    if (!line) {
      out.push('');
      continue;
    }

    let text = line.trim();
    if (text === '%') continue;

    text = canonicalizeMotionCodes(stripLeadingBlockNumber(text));
    if (/^G92(?=\D|$)/i.test(text) && !hasAxis(text, 'X') && !hasAxis(text, 'Y')) {
      const zero = (0).toFixed(DEFAULT_PRECISION);
      text = `${text} X${zero} Y${zero}`.trim();
    }

    out.push(text);
  }

  for (let index = out.length - 1; index >= 0; index--) {
    if (out[index].trim() === '') continue;

    if (/\bM0?2\b/i.test(out[index]) && out.slice(index + 1).every((item) => item.trim() === '')) {
      out.splice(index, 1);
    }
    break;
  }

  return out.join('\n');
}

export function canonicalizeMotionCodes(text: string) {
  if (typeof text !== 'string') return String(text);
  return text.replace(/\bG0+([0-3])(?!\d)/gi, 'G$1');
}

function stripLeadingBlockNumber(text: string) {
  return String(text || '').replace(/^N\d+(?:\s+|(?=[A-Z%]))/i, '');
}

function hasAxis(text: string, axis: 'X' | 'Y') {
  const num = '[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[Ee][-+]?\\d+)?';
  return new RegExp(`${axis}\\s*${num}`, 'i').test(text);
}
