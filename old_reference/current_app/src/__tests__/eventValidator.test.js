import { describe, it, expect } from 'vitest';
import { EventValidator } from '../core/events/EventValidator.js';
import { EVENT_TYPES } from '../core/events/EventTypes.js';

describe('EventValidator', () => {
  it('accepts G-code parse payloads with array paths and object bounds', () => {
    const result = EventValidator.validate(EVENT_TYPES.GCODE_PARSE_SUCCESS, {
      path: [{ type: 'cut', x: 1, y: 0 }],
      bounds: { minX: 0, maxX: 1, minY: 0, maxY: 0 },
      moveCount: 1,
      rapidCount: 0,
      cutCount: 1,
      arcCount: 0
    });

    expect(result).toEqual({ valid: true, errors: [] });
  });
});
