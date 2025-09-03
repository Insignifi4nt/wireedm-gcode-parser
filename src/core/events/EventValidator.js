/**
 * Event Validator Utility
 * Validates event data against schemas
 */
import { EVENT_TYPES } from './EventTypes.js';
import { EVENT_DATA_SCHEMAS } from './EventSchemas.js';

export class EventValidator {
  /**
   * Validate event data against schema
   * @param {string} eventType - Event type
   * @param {*} eventData - Event data to validate
   * @returns {Object} Validation result {valid: boolean, errors: Array}
   */
  static validate(eventType, eventData) {
    const schema = EventValidator.getSchema(eventType);
    
    if (!schema) {
      // No schema defined, consider valid
      return { valid: true, errors: [] };
    }
    
    const errors = [];
    
    // Null/undefined check
    if (eventData === null || eventData === undefined) {
      if (schema.required !== false) {
        errors.push(`Event data is required for ${eventType}`);
      }
      return { valid: errors.length === 0, errors };
    }
    
    // Type validation
    for (const [field, expectedType] of Object.entries(schema)) {
      if (field === 'required') continue;
      
      const value = eventData[field];
      const actualType = typeof value;
      
      // Skip validation for undefined optional fields
      if (value === undefined) continue;
      
      // Special type checks
      if (expectedType === 'Array' && !Array.isArray(value)) {
        errors.push(`Field '${field}' must be an array, got ${actualType}`);
      } else if (expectedType === 'Object' && (typeof value !== 'object' || value === null || Array.isArray(value))) {
        // Debug logging for bounds validation issue
        if (field === 'bounds') {
          console.debug(`Bounds validation failed:`, {
            field: field,
            expectedType: expectedType,
            actualType: typeof value,
            isNull: value === null,
            isArray: Array.isArray(value),
            value: value
          });
        }
        errors.push(`Field '${field}' must be an object, got ${Array.isArray(value) ? 'array' : typeof value}`);
      } else if (expectedType === 'Event') {
        // For Event validation, accept both native Event instances and event-like objects
        // This handles cases where events are wrapped, transformed, or synthetic
        if (!(value instanceof Event) && 
            !(typeof value === 'object' && value !== null && 
              (value.type !== undefined || value.target !== undefined || value.currentTarget !== undefined ||
               value.clientX !== undefined || value.clientY !== undefined || value.button !== undefined ||
               typeof value.preventDefault === 'function' || typeof value.stopPropagation === 'function'))) {
          errors.push(`Field '${field}' must be of type Event, got ${typeof value}`);
        }
      } else if (expectedType === 'KeyboardEvent') {
        // For KeyboardEvent validation, accept both native KeyboardEvent instances and event-like objects
        // This handles cases where events are wrapped, transformed, or synthetic
        if (!(value instanceof KeyboardEvent) && 
            !(typeof value === 'object' && value !== null && 
              (value.type !== undefined || value.target !== undefined || value.currentTarget !== undefined ||
               value.key !== undefined || value.code !== undefined || value.keyCode !== undefined ||
               typeof value.preventDefault === 'function' || typeof value.stopPropagation === 'function'))) {
          errors.push(`Field '${field}' must be a KeyboardEvent object`);
        }
      } else if (expectedType === 'Error' && !(value instanceof Error)) {
        errors.push(`Field '${field}' must be an Error object`);
      } else if (typeof expectedType === 'string' && actualType !== expectedType) {
        errors.push(`Field '${field}' must be of type ${expectedType}, got ${actualType}`);
      }
      
      // Number validation
      if (expectedType === 'number' && !isFinite(value)) {
        errors.push(`Field '${field}' must be a finite number`);
      }
    }
    
    return { valid: errors.length === 0, errors };
  }

  /**
   * Get schema for event type
   * @param {string} eventType - Event type
   * @returns {Object|null} Schema object or null if not found
   */
  static getSchema(eventType) {
    // Map event types to their schemas
    const schemaMap = {
      // Mouse events
      [EVENT_TYPES.MOUSE_MOVE]: EVENT_DATA_SCHEMAS.MOUSE,
      [EVENT_TYPES.MOUSE_CLICK]: EVENT_DATA_SCHEMAS.MOUSE,
      [EVENT_TYPES.MOUSE_DOWN]: EVENT_DATA_SCHEMAS.MOUSE,
      [EVENT_TYPES.MOUSE_UP]: EVENT_DATA_SCHEMAS.MOUSE,
      [EVENT_TYPES.MOUSE_WHEEL]: EVENT_DATA_SCHEMAS.MOUSE,
      [EVENT_TYPES.MOUSE_ENTER_CANVAS]: EVENT_DATA_SCHEMAS.MOUSE,
      [EVENT_TYPES.MOUSE_LEAVE_CANVAS]: EVENT_DATA_SCHEMAS.MOUSE,
      
      // Viewport events
      [EVENT_TYPES.VIEWPORT_ZOOM_CHANGE]: EVENT_DATA_SCHEMAS.VIEWPORT,
      [EVENT_TYPES.VIEWPORT_PAN_CHANGE]: EVENT_DATA_SCHEMAS.VIEWPORT,
      [EVENT_TYPES.VIEWPORT_RESET]: EVENT_DATA_SCHEMAS.VIEWPORT,
      [EVENT_TYPES.VIEWPORT_FIT_TO_SCREEN]: EVENT_DATA_SCHEMAS.VIEWPORT,
      
      // Point events
      [EVENT_TYPES.POINT_ADD]: EVENT_DATA_SCHEMAS.POINT,
      [EVENT_TYPES.POINT_DELETE]: EVENT_DATA_SCHEMAS.POINT,
      [EVENT_TYPES.POINT_UPDATE]: EVENT_DATA_SCHEMAS.POINT,
      [EVENT_TYPES.POINT_SELECT]: EVENT_DATA_SCHEMAS.POINT,
      [EVENT_TYPES.POINT_DESELECT]: EVENT_DATA_SCHEMAS.POINT,
      
      // File events
      [EVENT_TYPES.FILE_LOAD_START]: EVENT_DATA_SCHEMAS.FILE,
      [EVENT_TYPES.FILE_LOAD_SUCCESS]: EVENT_DATA_SCHEMAS.FILE,
      [EVENT_TYPES.FILE_LOAD_ERROR]: EVENT_DATA_SCHEMAS.ERROR,
      [EVENT_TYPES.FILE_LOAD_PROGRESS]: EVENT_DATA_SCHEMAS.FILE,
      
      // G-Code events
      [EVENT_TYPES.GCODE_PARSE_START]: { required: false },
      [EVENT_TYPES.GCODE_PARSE_SUCCESS]: EVENT_DATA_SCHEMAS.GCODE,
      [EVENT_TYPES.GCODE_PARSE_ERROR]: EVENT_DATA_SCHEMAS.ERROR,
      [EVENT_TYPES.GCODE_PARSE_PROGRESS]: { progress: 'number' },
      
      // Keyboard events
      [EVENT_TYPES.KEY_DOWN]: EVENT_DATA_SCHEMAS.KEYBOARD,
      [EVENT_TYPES.KEY_UP]: EVENT_DATA_SCHEMAS.KEYBOARD,
      [EVENT_TYPES.KEY_SHORTCUT]: EVENT_DATA_SCHEMAS.KEYBOARD,
      
      // Status events
      [EVENT_TYPES.STATUS_SHOW]: EVENT_DATA_SCHEMAS.STATUS,
      [EVENT_TYPES.STATUS_HIDE]: { required: false },
      [EVENT_TYPES.STATUS_UPDATE]: EVENT_DATA_SCHEMAS.STATUS,
      
      // Canvas events
      [EVENT_TYPES.CANVAS_REDRAW]: { required: false },
      [EVENT_TYPES.CANVAS_CLEAR]: { required: false },
      [EVENT_TYPES.CANVAS_RESIZE]: { width: 'number', height: 'number' }
    };
    
    return schemaMap[eventType] || null;
  }
}

