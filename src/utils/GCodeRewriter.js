/**
 * GCodeRewriter
 * Small utilities to transform/reshape G-code text for simple workflows.
 *
 * Current features:
 * - rotateStartAtLine: rotate the G-code body so a chosen motion line becomes the first
 *   body line, preserving header and (optional) trailing M02/footer. Optionally ensure
 *   the last motion before footer duplicates the chosen start line to keep a closed loop.
 */

import { canonicalizeMotionCodes } from './IsoNormalizer.js';

function stripInlineComments(line) {
  if (typeof line !== 'string') return '';
  // Remove anything after ';' or '(' comment start (minimal handling)
  return line.replace(/[;(].*$/g, '').trim();
}

function dropLeadingBlockNumber(line) {
  return (line || '').replace(/^N\d+\s+/i, '');
}

function isMotionLine(raw) {
  if (!raw) return false;
  // Normalize for robust detection (G00->G0, etc.)
  const cleaned = canonicalizeMotionCodes(dropLeadingBlockNumber(stripInlineComments(raw))).toUpperCase();
  return /^(G0|G1|G2|G3)\b/.test(cleaned);
}

function isM02Line(raw) {
  if (!raw) return false;
  return /\bM0?2\b/i.test(raw);
}

/**
 * Rotate the G-code body so that the given 1-based line number becomes the first
 * body line after the header. Header is defined as all lines before the first
 * motion (G0/G1/G2/G3). Optionally keeps program end (M02) as footer if present.
 * If ensureClosure is true, the selected start line text is also appended right
 * before the footer when needed to keep the last motion equal to the chosen start.
 *
 * @param {string} text - Drawer/editor G-code text
 * @param {number} selectedLineNumber - 1-based line number from the drawer UI
 * @param {Object} options
 * @param {boolean} [options.ensureClosure=true] - Append selected line at end if needed
 * @returns {{ text: string, newStartLine: number }}
 */
export function rotateStartAtLine(text, selectedLineNumber, options = {}) {
  const { ensureClosure = true } = options;
  if (typeof text !== 'string' || !text.length) {
    return { text: text || '', newStartLine: 1 };
  }

  const lines = text.split(/\r?\n/);
  if (!Array.isArray(lines) || lines.length === 0) {
    return { text, newStartLine: 1 };
  }

  // Extract footer M02 if present (last non-empty line)
  let footer = [];
  let core = [...lines];
  for (let i = core.length - 1; i >= 0; i--) {
    const s = (core[i] || '').trim();
    if (s === '') continue;
    if (isM02Line(s)) {
      footer = core.slice(i);
      core = core.slice(0, i);
    }
    break;
  }

  // Identify header (before first motion)
  let firstMotionIdx = -1; // 0-based index in core
  for (let i = 0; i < core.length; i++) {
    if (isMotionLine(core[i])) { firstMotionIdx = i; break; }
  }
  if (firstMotionIdx === -1) {
    // No motion detected; nothing to rotate
    return { text, newStartLine: 1 };
  }

  const header = core.slice(0, firstMotionIdx);
  const body = core.slice(firstMotionIdx);

  // Resolve selected line into body index
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const selectedIdx0 = clamp((selectedLineNumber | 0) - 1, 0, core.length - 1);

  // If selection is in header or not a motion, choose nearest motion line
  let bodyStartIdx = Math.max(0, selectedIdx0 - firstMotionIdx);
  const selectedIsMotion = isMotionLine(core[selectedIdx0]);
  if (selectedIdx0 < firstMotionIdx || !selectedIsMotion) {
    // find next motion in body
    let found = -1;
    for (let i = bodyStartIdx; i < body.length; i++) {
      if (isMotionLine(body[i])) { found = i; break; }
    }
    if (found === -1) {
      for (let i = bodyStartIdx; i >= 0; i--) {
        if (isMotionLine(body[i])) { found = i; break; }
      }
    }
    if (found === -1) {
      // No motion in body (shouldn't happen due to firstMotionIdx), bail out
      return { text, newStartLine: 1 };
    }
    bodyStartIdx = found;
  }

  const chosenLineText = body[bodyStartIdx];

  // Rotate body so chosen line becomes first
  const rotatedBody = body.slice(bodyStartIdx).concat(body.slice(0, bodyStartIdx));

  // Ensure closure: last non-empty (before footer) must match chosen
  if (ensureClosure) {
    let lastNonEmptyIdx = rotatedBody.length - 1;
    while (lastNonEmptyIdx >= 0 && (rotatedBody[lastNonEmptyIdx] || '').trim() === '') lastNonEmptyIdx--;
    const lastLine = lastNonEmptyIdx >= 0 ? rotatedBody[lastNonEmptyIdx] : '';
    const norm = (s) => canonicalizeMotionCodes((s || '').trim()).toUpperCase();
    if (norm(lastLine) !== norm(chosenLineText)) {
      rotatedBody.push(chosenLineText);
    }
  }

  // Compose
  const out = [...header, ...rotatedBody, ...footer];
  // New start line index in the final text is header length + 1
  const newStartLine = header.length + 1;
  return { text: out.join('\n'), newStartLine };
}

export default {
  rotateStartAtLine
};

