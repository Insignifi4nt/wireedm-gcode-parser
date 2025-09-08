/**
 * GCodeRewriter
 * Small utilities to transform/reshape G-code text for simple workflows.
 *
 * Current features:
 * - rotateStartAtLine: rotate the G-code body so a chosen motion line becomes the first
 *   body line, preserving header. Ensures a closed loop by removing the old closer to the
 *   original start, converting intermediate G0 to G1, and appending a minimal G1 close
 *   to the new start if needed.
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

// Extract XY (and their original string tokens) from a line
function extractXY(raw) {
  if (typeof raw !== 'string') return { x: null, y: null, xText: null, yText: null };
  const noComment = stripInlineComments(raw);
  // Accept integers, leading/trailing decimals, and optional scientific notation
  const num = '[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[Ee][-+]?\\d+)?';
  const mX = noComment.match(new RegExp('\\bX\\s*(' + num + ')', 'i'));
  const mY = noComment.match(new RegExp('\\bY\\s*(' + num + ')', 'i'));
  const xText = mX ? mX[1] : null;
  const yText = mY ? mY[1] : null;
  const x = xText != null ? parseFloat(xText) : null;
  const y = yText != null ? parseFloat(yText) : null;
  return { x, y, xText, yText };
}

// Compare two XY pairs with tolerance
function xyEqual(a, b, eps = 1e-6) {
  if (a == null || b == null) return false;
  if (a.x == null || a.y == null || b.x == null || b.y == null) return false;
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
}

// Convert a G0 line to G1, preserving other content (comments handled separately)
function convertG0ToG1(raw) {
  if (typeof raw !== 'string') return raw;
  // Separate inline comment to avoid replacing inside comments
  const commentMatch = raw.match(/[;(].*$/);
  const comment = commentMatch ? raw.slice(commentMatch.index) : '';
  const head = commentMatch ? raw.slice(0, commentMatch.index) : raw;
  // Canonicalize then replace leading G0 token (after optional N-number)
  const canon = canonicalizeMotionCodes(head);
  const replaced = canon.replace(/^(\s*(?:N\d+\s+)?)(G0)\b/i, (_, p1) => `${p1}G1`);
  return replaced + comment;
}

// Generate minimal close move to XY (XY only, linear cut)
function generateMinimalClose(xText, yText) {
  const parts = ['G1'];
  if (xText != null) parts.push(`X${xText}`);
  if (yText != null) parts.push(`Y${yText}`);
  return parts.join(' ');
}

// (No nearest motion fallback; selection must already be a motion line in body)

/**
 * Rotate the G-code body so that the given 1-based line number becomes the first
 * body line after the header. Header is defined as all lines before the first
 * motion (G0/G1/G2/G3).
 * If ensureClosure is true, ensures the final motion returns to the new start by
 * removing the old closer to the original start, converting any intermediate G0 to G1,
 * and appending a minimal G1 close (XY only) if needed.
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

  // Drawer text should not contain trailing M02; treat entire input as core
  let core = [...lines];

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
    // Strict behavior: selection must be a motion line within the body
    return { text, newStartLine: header.length + 1 };
  }

  const chosenLineText = body[bodyStartIdx];
  const chosenXY = extractXY(chosenLineText);
  const originalFirstLine = body[0];
  const originalStartXY = extractXY(originalFirstLine);

  // Rotate body so chosen line becomes first
  const rotatedBody = body.slice(bodyStartIdx).concat(body.slice(0, bodyStartIdx));

  // After rotation, the old closer (which ended at original start) is immediately
  // before the original first line. Remove that closer to avoid duplicate segment.
  const idxOfOriginalFirst = (bodyStartIdx === 0) ? 0 : (body.length - bodyStartIdx);
  if (idxOfOriginalFirst > 0 && idxOfOriginalFirst < rotatedBody.length) {
    const prevIdx = idxOfOriginalFirst - 1;
    const prevLine = rotatedBody[prevIdx];
    // Remove only if it truly ends at the original start XY
    const prevXY = extractXY(prevLine);
    if (xyEqual(prevXY, originalStartXY)) {
      rotatedBody.splice(prevIdx, 1);
    }
  }

  // If the original first line is no longer at index 0, it became an intermediate move.
  // If it was a G0, convert it to G1 to maintain continuous cutting.
  const newIdxOfOriginalFirst = (bodyStartIdx === 0) ? 0 : (body.length - bodyStartIdx);
  if (newIdxOfOriginalFirst > 0) {
    const line = rotatedBody[newIdxOfOriginalFirst] || '';
    const cleaned = canonicalizeMotionCodes(dropLeadingBlockNumber(stripInlineComments(line))).toUpperCase();
    if (/^G0\b/.test(cleaned)) {
      rotatedBody[newIdxOfOriginalFirst] = convertG0ToG1(line);
    }
  }

  // Ensure closure to the new start: if the last motion XY != chosen XY, append minimal close
  if (ensureClosure) {
    // Find last non-empty line index
    let lastIdx = rotatedBody.length - 1;
    while (lastIdx >= 0 && (rotatedBody[lastIdx] || '').trim() === '') lastIdx--;
    const lastLine = lastIdx >= 0 ? rotatedBody[lastIdx] : '';
    const lastXY = extractXY(lastLine);
    if (!xyEqual(lastXY, chosenXY)) {
      rotatedBody.push(generateMinimalClose(chosenXY.xText, chosenXY.yText));
    }
  }

  // Compose
  const out = [...header, ...rotatedBody];
  // New start line index in the final text is header length + 1
  const newStartLine = header.length + 1;
  return { text: out.join('\n'), newStartLine };
}

export default {
  rotateStartAtLine
};
