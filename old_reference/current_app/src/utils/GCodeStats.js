/**
 * Helpers for summarizing parsed G-code results for events/telemetry.
 */

/**
 * Build a payload for GCODE_PARSE_SUCCESS from a parser result.
 * @param {Object} parseResult - Result from GCodeParser.parse
 * @returns {Object|null} Payload matching EVENT_DATA_SCHEMAS.GCODE or null if invalid
 */
export function summarizeParseResult(parseResult) {
  if (!parseResult || !Array.isArray(parseResult.path)) return null;

  let rapidCount = 0;
  let cutCount = 0;
  let arcCount = 0;

  for (const segment of parseResult.path) {
    if (!segment || typeof segment !== 'object') continue;
    if (segment.type === 'rapid') rapidCount++;
    else if (segment.type === 'cut') cutCount++;
    else if (segment.type === 'arc') arcCount++;
  }

  return {
    path: parseResult.path,
    bounds: parseResult.bounds || null,
    moveCount: parseResult.path.length,
    rapidCount,
    cutCount,
    arcCount,
    stats: parseResult.stats
  };
}

export function createDisplayedLineMapping(displayedText, sourcePath, parser) {
  const fallback = () => (Array.isArray(sourcePath) ? sourcePath : []).map((point, index) => ({
    index,
    line: typeof point?.line === 'number' ? point.line : null,
    point
  }));

  if (typeof displayedText !== 'string' || !Array.isArray(sourcePath) || !parser || typeof parser.parse !== 'function') {
    return fallback();
  }

  try {
    const displayedResult = parser.parse(displayedText);
    if (!Array.isArray(displayedResult?.path) || displayedResult.path.length !== sourcePath.length) {
      return fallback();
    }

    return displayedResult.path.map((displayPoint, index) => ({
      index,
      line: typeof displayPoint?.line === 'number' ? displayPoint.line : null,
      point: sourcePath[index]
    }));
  } catch (_error) {
    return fallback();
  }
}

export default { summarizeParseResult, createDisplayedLineMapping };
