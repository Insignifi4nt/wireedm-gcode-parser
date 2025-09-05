/**
 * IsoNormalizer Utility
 * Normalizes free-form G-code/ISO text into Fanuc-style ISO with:
 * - Leading % line
 * - Monotonic N-numbers (configurable start/step)
 * - Optional stripping of semicolon comments
 * - Single trailing M02 at end
 * - CRLF line endings by default
 */

/**
 * Normalize plain text content to ISO-style program text
 * @param {string} inputText - Source text (G-code/ISO/TXT)
 * @param {Object} options
 * @param {number} [options.startN=10] - Starting block number
 * @param {number} [options.step=10] - Increment between block numbers
 * @param {boolean} [options.addPercent=true] - Ensure leading %
 * @param {boolean} [options.ensureM02=true] - Ensure trailing M02
 * @param {boolean} [options.crlf=true] - Use CRLF line endings
 * @param {boolean} [options.stripSemicolon=true] - Remove ';' comments
 * @returns {string} - Normalized ISO content
 */
export function normalizeToISO(inputText, options = {}) {
  const {
    startN = 10,
    step = 10,
    addPercent = true,
    ensureM02 = true,
    crlf = true,
    stripSemicolon = true
  } = options;

  if (typeof inputText !== 'string') {
    inputText = String(inputText ?? '');
  }

  const srcLines = inputText.split(/\r?\n/);
  const outLines = [];

  if (addPercent) {
    if (!srcLines.length || srcLines[0].trim() !== '%') {
      outLines.push('%');
    } else {
      outLines.push('%');
      srcLines.shift();
    }
  }

  let n = startN;
  for (let i = 0; i < srcLines.length; i++) {
    let line = srcLines[i];
    if (!line) continue;
    let s = line.trim();
    if (!s) continue;

    // Drop bare % lines appearing mid-file
    if (s === '%') continue;

    // Strip semicolon comments (retain anything before first ';')
    if (stripSemicolon) {
      const idx = s.indexOf(';');
      if (idx >= 0) {
        s = s.slice(0, idx).trimEnd();
        if (!s) continue;
      }
    }

    // Collapse internal whitespace
    s = s.replace(/\s+/g, ' ').trim();

    // Canonicalize motion codes (e.g., G01 -> G1)
    s = canonicalizeMotionCodes(s);

    // If already has an N-number at start, keep as-is; otherwise prepend one
    if (/^N\d+\b/i.test(s)) {
      outLines.push(s);
    } else {
      outLines.push(`N${n} ${s}`);
      n += step;
    }
  }

  if (ensureM02) {
    const cleaned = [];
    for (const l of outLines) {
      if (/\bM0?2\b/i.test(l)) continue; // drop all previous M02/M2
      cleaned.push(l);
    }
    outLines.length = 0;
    outLines.push(...cleaned);
    outLines.push(`N${n} M02`);
  }

  const eol = crlf ? '\r\n' : '\n';
  return outLines.join(eol) + eol;
}

/**
 * Build an ISO program from a list of points using a header template
 * resembling PinZ15New structure.
 * @param {Array<{x:number,y:number}>} points - Ordered list of XY points
 * @param {Object} options
 * @param {number} [options.startN=10]
 * @param {number} [options.step=10]
 * @param {boolean} [options.crlf=true]
 * @param {number} [options.precision=3]
 * @param {number|null} [options.feed=1000] - Feed for first cutting move (null to skip)
 * @param {Array<string>} [options.headerCodes] - G-codes to emit before motion
 * @returns {string}
 */
export function buildISOFromPoints(points, options = {}) {
  const {
    startN = 10,
    step = 10,
    crlf = true,
    precision = 3,
    feed = 1000,
    headerCodes = ['G92', 'G60', 'G38', 'G42 D0', 'G90']
  } = options;

  const out = ['%'];
  let n = startN;

  // Header block codes
  for (const code of headerCodes) {
    out.push(`N${n} ${code}`);
    n += step;
  }

  if (!points || points.length === 0) {
    out.push(`N${n} M02`);
    const eol = crlf ? '\r\n' : '\n';
    return out.join(eol) + eol;
  }

  const fmt = (v) => Number(v).toFixed(precision);

  // Rapid to first point
  const first = points[0];
  out.push(`N${n} G0 X${fmt(first.x)} Y${fmt(first.y)}`); n += step;

  // Cut moves through remaining points
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (i === 1 && typeof feed === 'number') {
      out.push(`N${n} G1 X${fmt(p.x)} Y${fmt(p.y)} F${feed}`);
    } else {
      out.push(`N${n} G1 X${fmt(p.x)} Y${fmt(p.y)}`);
    }
    n += step;
  }

  // Program end
  out.push(`N${n} M02`);

  const eol = crlf ? '\r\n' : '\n';
  return out.join(eol) + eol;
}

/**
 * Strip ISO/G-code text for editing in drawer:
 * - Remove leading % (header)
 * - Remove leading N-numbers from lines
 * - Remove any lines that contain bare M02 (end) if at end, keep other lines
 * @param {string} inputText
 * @returns {string}
 */
import { GCODE } from './Constants.js';

export function stripForEditing(inputText) {
  if (typeof inputText !== 'string') return '';
  const lines = inputText.split(/\r?\n/);
  const out = [];
  // Remove top-level % if present
  let i = 0;
  if (lines.length && lines[0].trim() === '%') {
    i = 1;
  }
  for (; i < lines.length; i++) {
    let s = lines[i];
    if (!s) { out.push(''); continue; }
    let t = s.trim();
    // Skip pure % lines anywhere
    if (t === '%') continue;
    // Remove leading block numbers
    t = t.replace(/^N\d+\s+/i, '');
    // Canonicalize motion codes (e.g., G01 -> G1)
    t = canonicalizeMotionCodes(t);
    // If a bare G92 appears (without X or Y), make it explicit as G92 X0 Y0
    // so the drawer shows concrete start coordinates matching parser semantics.
    if (/\bG92\b/i.test(t)) {
      const hasX = /\bX-?\d+(?:\.\d+)?\b/i.test(t);
      const hasY = /\bY-?\d+(?:\.\d+)?\b/i.test(t);
      if (!hasX && !hasY) {
        const zero = (0).toFixed(GCODE.DEFAULT_PRECISION);
        // Append with a single space to preserve minimal formatting impact
        t = `${t} X${zero} Y${zero}`.trim();
      }
    }
    // Skip trailing M02 only if it's the last non-empty content
    // We'll collect now; a later pass will drop final sole M02.
    out.push(t);
  }
  // Drop final M02 if last non-empty line is M02
  for (let j = out.length - 1; j >= 0; j--) {
    if (out[j].trim() === '') { continue; }
    if (/\bM0?2\b/i.test(out[j]) && out.slice(j+1).every(x => x.trim() === '')) {
      out.splice(j, 1);
    }
    break;
  }
  return out.join('\n');
}

/**
 * Canonicalize motion codes by removing leading zeros from G0..G3
 * Examples: G00 -> G0, G01 -> G1, G02 -> G2, G03 -> G3
 * Case-insensitive, word-boundary safe, and avoids touching numbers that continue with digits
 * @param {string} text
 * @returns {string}
 */
export function canonicalizeMotionCodes(text) {
  if (typeof text !== 'string') return '' + text;
  return text.replace(/\bG0+([0-3])(?!\d)/gi, 'G$1');
}

export default {
  normalizeToISO,
  buildISOFromPoints,
  stripForEditing,
  canonicalizeMotionCodes
};

