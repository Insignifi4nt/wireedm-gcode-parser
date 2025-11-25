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

export default { summarizeParseResult };
