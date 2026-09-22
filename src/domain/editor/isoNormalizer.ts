const DEFAULT_PRECISION = 3;

export interface NormalizeToISOOptions {
  startN?: number;
  step?: number;
  addPercent?: boolean;
  ensureM02?: boolean;
  crlf?: boolean;
  stripSemicolon?: boolean;
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
      s = transformCommandText(s, (code) => code, false).trim();
      if (!s) continue;
    }

    s = canonicalizeMotionCodes(stripLeadingBlockNumber(s).replace(/\s+/g, ' ').trim());

    if (ensureM02) {
      s = removeEndCommands(s).trim();
      if (!s) continue;
    }

    outLines.push(`N${n} ${s}`);
    n += step;
  }

  if (ensureM02) {
    outLines.push(`N${n} M02`);
  }

  const eol = crlf ? '\r\n' : '\n';
  return `${outLines.join(eol)}${eol}`;
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
    if (/^G92(?=[^\d.]|$)/i.test(text) && !hasAxis(text, 'X') && !hasAxis(text, 'Y')) {
      const zero = (0).toFixed(DEFAULT_PRECISION);
      text = `${text} X${zero} Y${zero}`.trim();
    }

    out.push(text);
  }

  for (let index = out.length - 1; index >= 0; index--) {
    if (out[index].trim() === '') continue;

    const withoutEndCommand = removeEndCommands(out[index]).trim();
    if (withoutEndCommand !== out[index].trim()) {
      if (transformCommandText(withoutEndCommand, (code) => code, false).trim()) {
        out[index] = withoutEndCommand;
      } else {
        out.splice(index, 1);
      }
    }
    break;
  }

  return out.join('\n');
}

export function canonicalizeMotionCodes(text: string) {
  if (typeof text !== 'string') return String(text);
  return text.replace(/\bG0+([0-3])(?!\d)/gi, 'G$1');
}

function removeEndCommands(text: string) {
  // Named parameters and subprogram identifiers can contain text such as "m2".
  return transformCommandText(text, (code) => code.replace(
    /<[^>]*>|([A-Z])\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][-+]?\d+)?)/gi,
    (word, letter: string | undefined, value: string | undefined) => letter?.toUpperCase() === 'M' && Number(value) === 2 ? '' : word
  ));
}

/** Apply command edits only outside nested parentheses and semicolon comments. */
function transformCommandText(text: string, transform: (code: string) => string, preserveComments = true) {
  let result = '';
  let code = '';
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (depth === 0 && (character === '(' || character === ';')) {
      result += transform(code);
      code = '';
      if (character === ';') return result + (preserveComments ? text.slice(index) : '');
      depth = 1;
      if (preserveComments) result += character;
    } else if (depth > 0) {
      if (preserveComments) result += character;
      if (character === '(') depth++;
      if (character === ')') depth--;
    } else {
      code += character;
    }
  }
  return result + transform(code);
}

function stripLeadingBlockNumber(text: string) {
  return String(text || '').replace(/^N\d+(?:\s+|(?=[A-Z%]))/i, '');
}

function hasAxis(text: string, axis: 'X' | 'Y') {
  const num = '[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[Ee][-+]?\\d+)?';
  return new RegExp(`${axis}\\s*${num}`, 'i').test(text);
}
