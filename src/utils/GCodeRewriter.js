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

// Check if a line is a header/setup command that should stay in header
function isHeaderCommand(raw) {
  if (!raw) return false;
  const cleaned = canonicalizeMotionCodes(dropLeadingBlockNumber(stripInlineComments(raw))).toUpperCase();
  
  // Empty lines and comments should follow context (handled separately)
  if (cleaned.trim() === '') return false;
  
  // Program control and setup commands that should stay in header
  if (/^%/.test(cleaned)) return true; // Program start/end
  if (/^[GM]\d+/.test(cleaned)) {
    // G-codes that are typically setup/modal commands
    if (/^(G92|G60|G38|G50|G51|G52|G53|G54|G55|G56|G57|G58|G59)/.test(cleaned)) return true;
    if (/^(G90|G91|G90\.1|G91\.1)/.test(cleaned)) return true; // Coordinate modes
    if (/^(G40|G41|G42|G43|G44|G45|G46|G47|G48|G49)/.test(cleaned)) return true; // Tool compensation
    if (/^(G17|G18|G19)/.test(cleaned)) return true; // Plane selection
    if (/^(G20|G21)/.test(cleaned)) return true; // Units (inch/mm)
    if (/^(G94|G95)/.test(cleaned)) return true; // Feed rate modes
    if (/^(G96|G97)/.test(cleaned)) return true; // Spindle control modes
    if (/^(G98|G99)/.test(cleaned)) return true; // Canned cycle modes
    
    // M-codes that are setup commands
    if (/^(M[0-9]|M1[0-9]|M2[0-9]|M3[0-9]|M[4-9][0-9]|M28|M30)/.test(cleaned)) {
      // Exclude M02 as it's typically a program end
      if (!/^M02\b/.test(cleaned)) return true;
    }
  }
  
  return false;
}

// Check if a line is a footer/end command
function isFooterCommand(raw) {
  if (!raw) return false;
  const cleaned = canonicalizeMotionCodes(dropLeadingBlockNumber(stripInlineComments(raw))).toUpperCase();
  
  // Program end commands
  if (/^M02\b/.test(cleaned)) return true; // Program end
  if (/^M30\b/.test(cleaned)) return true; // Program end with rewind
  if (/^%$/.test(cleaned)) return true; // Program end marker
  
  return false;
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

// Extract IJ arc center offsets (and their original string tokens) from a line
function extractIJ(raw) {
  if (typeof raw !== 'string') return { i: null, j: null, iText: null, jText: null };
  const noComment = stripInlineComments(raw);
  // Accept integers, leading/trailing decimals, and optional scientific notation
  const num = '[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[Ee][-+]?\\d+)?';
  const mI = noComment.match(new RegExp('\\bI\\s*(' + num + ')', 'i'));
  const mJ = noComment.match(new RegExp('\\bJ\\s*(' + num + ')', 'i'));
  const iText = mI ? mI[1] : null;
  const jText = mJ ? mJ[1] : null;
  const i = iText != null ? parseFloat(iText) : null;
  const j = jText != null ? parseFloat(jText) : null;
  return { i, j, iText, jText };
}

// Check if a line is an arc command (G2 or G3)
function isArcLine(raw) {
  if (!raw) return false;
  const cleaned = canonicalizeMotionCodes(dropLeadingBlockNumber(stripInlineComments(raw))).toUpperCase();
  return /^(G2|G3)\b/.test(cleaned);
}

// Get the G-code command (G0, G1, G2, G3) from a line
function getGCommand(raw) {
  if (!raw) return null;
  const cleaned = canonicalizeMotionCodes(dropLeadingBlockNumber(stripInlineComments(raw))).toUpperCase();
  const match = cleaned.match(/^(G[0-3])\b/);
  return match ? match[1] : null;
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

// Calculate absolute arc center coordinates from start position and I,J offsets
function calculateAbsoluteArcCenter(startX, startY, i, j) {
  if (startX == null || startY == null || i == null || j == null) return null;
  return {
    centerX: startX + i,
    centerY: startY + j
  };
}

// Calculate I,J offsets from absolute center coordinates and start position
function calculateIJOffsets(startX, startY, centerX, centerY) {
  if (startX == null || startY == null || centerX == null || centerY == null) return null;
  return {
    i: centerX - startX,
    j: centerY - startY
  };
}

// Format number for G-code output (remove unnecessary decimals)
function formatNumber(num) {
  if (num == null) return null;
  // Round to 6 decimal places and remove trailing zeros
  const rounded = parseFloat(num.toFixed(6));
  return rounded.toString();
}

// Reconstruct arc command line with new I,J values
function updateArcCommand(originalLine, newI, newJ) {
  if (!originalLine || newI == null || newJ == null) return originalLine;
  
  // Separate comment from the command
  const commentMatch = originalLine.match(/[;(].*$/);
  const comment = commentMatch ? originalLine.slice(commentMatch.index) : '';
  const commandPart = commentMatch ? originalLine.slice(0, commentMatch.index) : originalLine;
  
  // Replace I and J values in the command part
  let updatedCommand = commandPart;
  
  // Replace I value
  const iPattern = /\bI\s*[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][-+]?\d+)?/i;
  if (iPattern.test(updatedCommand)) {
    updatedCommand = updatedCommand.replace(iPattern, `I${formatNumber(newI)}`);
  } else {
    // If no I value exists, add it (shouldn't happen with valid arcs, but be safe)
    updatedCommand += ` I${formatNumber(newI)}`;
  }
  
  // Replace J value
  const jPattern = /\bJ\s*[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][-+]?\d+)?/i;
  if (jPattern.test(updatedCommand)) {
    updatedCommand = updatedCommand.replace(jPattern, `J${formatNumber(newJ)}`);
  } else {
    // If no J value exists, add it
    updatedCommand += ` J${formatNumber(newJ)}`;
  }
  
  return updatedCommand + comment;
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

  // Enhanced header/body/footer separation
  const header = [];
  const body = [];
  const footer = [];
  
  let inBody = false;
  let foundFirstMotion = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = (line || '').trim();
    
    // Skip empty lines and comments - they follow their context
    if (trimmedLine === '' || trimmedLine.startsWith(';') || trimmedLine.startsWith('(')) {
      if (inBody && foundFirstMotion) {
        body.push(line);
      } else if (footer.length > 0) {
        footer.push(line);
      } else {
        header.push(line);
      }
      continue;
    }
    
    // Check for footer commands first
    if (isFooterCommand(line)) {
      footer.push(line);
      continue;
    }
    
    // Check for motion commands
    if (isMotionLine(line)) {
      body.push(line);
      if (!foundFirstMotion) {
        foundFirstMotion = true;
        inBody = true;
      }
      continue;
    }
    
    // Check for explicit header commands
    if (isHeaderCommand(line)) {
      if (inBody && foundFirstMotion) {
        // This is unusual - a setup command in the middle of motion commands
        // Keep it in body to preserve the original structure
        body.push(line);
      } else {
        header.push(line);
      }
      continue;
    }
    
    // For other commands, use context
    if (inBody && foundFirstMotion) {
      body.push(line);
    } else if (footer.length > 0) {
      footer.push(line);
    } else {
      header.push(line);
    }
  }
  
  if (body.length === 0) {
    // No motion detected; nothing to rotate
    return { text, newStartLine: 1 };
  }

  // Find the selected line in the body
  // First, reconstruct the line numbering to match the original input
  const totalLines = header.length + body.length + footer.length;
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const selectedIdx0 = clamp((selectedLineNumber | 0) - 1, 0, totalLines - 1);
  
  // Determine which section the selected line is in
  let bodyStartIdx = -1;
  let selectedIsMotion = false;
  
  if (selectedIdx0 < header.length) {
    // Selection is in header - invalid
    return { text, newStartLine: header.length + 1 };
  } else if (selectedIdx0 < header.length + body.length) {
    // Selection is in body
    bodyStartIdx = selectedIdx0 - header.length;
    selectedIsMotion = isMotionLine(body[bodyStartIdx]);
  } else {
    // Selection is in footer - invalid
    return { text, newStartLine: header.length + 1 };
  }
  
  if (!selectedIsMotion) {
    // Strict behavior: selection must be a motion line within the body
    return { text, newStartLine: header.length + 1 };
  }

  const chosenLineText = body[bodyStartIdx];
  const chosenXY = extractXY(chosenLineText);
  const originalFirstLine = body[0];
  const originalStartXY = extractXY(originalFirstLine);

  // Before rotation: Process arc commands and store their absolute center coordinates
  const arcInfo = [];
  let currentPosition = { x: 0, y: 0 }; // Assume start at origin, will be updated by first move
  
  for (let i = 0; i < body.length; i++) {
    const line = body[i];
    const xy = extractXY(line);
    
    if (isArcLine(line)) {
      const ij = extractIJ(line);
      if (ij.i != null && ij.j != null) {
        const centerCoords = calculateAbsoluteArcCenter(currentPosition.x, currentPosition.y, ij.i, ij.j);
        if (centerCoords) {
          arcInfo.push({
            originalIndex: i,
            centerX: centerCoords.centerX,
            centerY: centerCoords.centerY,
            startX: currentPosition.x,
            startY: currentPosition.y
          });
        }
      }
    }
    
    // Update current position if this line has XY coordinates
    if (xy.x != null) currentPosition.x = xy.x;
    if (xy.y != null) currentPosition.y = xy.y;
  }

  // Rotate body so chosen line becomes first
  const rotatedBody = body.slice(bodyStartIdx).concat(body.slice(0, bodyStartIdx));

  // After rotation: Fix arc commands with recalculated I,J values
  if (arcInfo.length > 0) {
    // Reset current position for rotated body
    currentPosition = { x: 0, y: 0 };
    
    for (let i = 0; i < rotatedBody.length; i++) {
      const line = rotatedBody[i];
      const xy = extractXY(line);
      
      if (isArcLine(line)) {
        // Find the corresponding arc info
        // Map the rotated index back to the original index
        const originalIdx = i < (body.length - bodyStartIdx) ? 
          i + bodyStartIdx : 
          i - (body.length - bodyStartIdx);
          
        const info = arcInfo.find(arc => arc.originalIndex === originalIdx);
        if (info) {
          // Recalculate I,J offsets for the current position
          const newIJ = calculateIJOffsets(currentPosition.x, currentPosition.y, info.centerX, info.centerY);
          if (newIJ) {
            rotatedBody[i] = updateArcCommand(line, newIJ.i, newIJ.j);
          }
        }
      }
      
      // Update current position if this line has XY coordinates
      if (xy.x != null) currentPosition.x = xy.x;
      if (xy.y != null) currentPosition.y = xy.y;
    }
  }

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

  // Compose final output: header + rotated body + footer
  const out = [...header, ...rotatedBody, ...footer];
  // New start line index in the final text is header length + 1
  const newStartLine = header.length + 1;
  return { text: out.join('\n'), newStartLine };
}

export default {
  rotateStartAtLine
};
