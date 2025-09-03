/**
 * EventSchemas - Type definitions for event payloads
 */
export const EVENT_DATA_SCHEMAS = {
  // Mouse event data
  MOUSE: {
    screenX: 'number',     // Screen coordinates (pixels)
    screenY: 'number',
    worldX: 'number',      // World coordinates (mm)
    worldY: 'number',
    button: 'number',      // Mouse button (0=left, 1=middle, 2=right)
    ctrlKey: 'boolean',    // Modifier keys
    shiftKey: 'boolean',
    altKey: 'boolean',
    originalEvent: 'Event' // Original DOM event
  },

  // Viewport change data
  VIEWPORT: {
    zoom: 'number',        // Current zoom level
    offsetX: 'number',     // Viewport offset X
    offsetY: 'number',     // Viewport offset Y
    bounds: 'Object',      // Visible bounds {minX, maxX, minY, maxY}
    canvasWidth: 'number', // Canvas dimensions
    canvasHeight: 'number'
  },

  // Point data
  POINT: {
    id: 'string',          // Unique point identifier
    x: 'number',           // World coordinates
    y: 'number',
    index: 'number',       // Point index in array
    metadata: 'Object'     // Additional point data
  },

  // File operation data
  FILE: {
    name: 'string',        // File name
    size: 'number',        // File size in bytes
    type: 'string',        // MIME type
    content: 'string',     // File content (for small files)
    progress: 'number'     // Progress percentage (0-100)
  },

  // G-Code parse data
  GCODE: {
    path: 'Array',         // Parsed path data
    bounds: 'Object',      // Path bounds {minX, maxX, minY, maxY}
    moveCount: 'number',   // Number of moves
    rapidCount: 'number',  // Number of rapid moves
    cutCount: 'number',    // Number of cutting moves
    arcCount: 'number'     // Number of arc moves
  },

  // Keyboard event data
  KEYBOARD: {
    key: 'string',         // Key name
    code: 'string',        // Key code
    ctrlKey: 'boolean',    // Modifier keys
    shiftKey: 'boolean',
    altKey: 'boolean',
    metaKey: 'boolean',
    originalEvent: 'KeyboardEvent'
  },

  // Status message data
  STATUS: {
    message: 'string',     // Message text
    type: 'string',        // 'success', 'error', 'warning', 'info'
    duration: 'number',    // Display duration in ms
    persistent: 'boolean'  // Whether message stays until manually dismissed
  },

  // Error data
  ERROR: {
    message: 'string',     // Error message
    error: 'Error',        // Error object
    context: 'string',     // Context where error occurred
    stack: 'string'        // Stack trace
  }
};

