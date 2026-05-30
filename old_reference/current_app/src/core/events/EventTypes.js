/**
 * EventTypes - Centralized definition of all application events
 */
export const EVENT_TYPES = {
  // File Operations
  FILE_LOAD_START: 'file:load:start',
  FILE_LOAD_SUCCESS: 'file:load:success',
  FILE_LOAD_ERROR: 'file:load:error',
  FILE_LOAD_PROGRESS: 'file:load:progress',
  FILE_CLEARED: 'file:cleared',

  // G-Code Parsing
  GCODE_PARSE_START: 'gcode:parse:start',
  GCODE_PARSE_SUCCESS: 'gcode:parse:success',
  GCODE_PARSE_ERROR: 'gcode:parse:error',
  GCODE_PARSE_PROGRESS: 'gcode:parse:progress',

  // Viewport Changes
  VIEWPORT_ZOOM_CHANGE: 'viewport:zoom:change',
  VIEWPORT_PAN_CHANGE: 'viewport:pan:change',
  VIEWPORT_RESET: 'viewport:reset',
  VIEWPORT_FIT_TO_SCREEN: 'viewport:fit:screen',

  // Mouse Events
  MOUSE_MOVE: 'mouse:move',
  MOUSE_CLICK: 'mouse:click',
  MOUSE_DOWN: 'mouse:down',
  MOUSE_UP: 'mouse:up',
  MOUSE_WHEEL: 'mouse:wheel',
  MOUSE_ENTER_CANVAS: 'mouse:enter:canvas',
  MOUSE_LEAVE_CANVAS: 'mouse:leave:canvas',

  // Point Management
  POINT_ADD: 'point:add',
  POINT_DELETE: 'point:delete',
  POINT_UPDATE: 'point:update',
  POINT_CLEAR_ALL: 'point:clear:all',
  POINT_SELECT: 'point:select',
  POINT_DESELECT: 'point:deselect',
  POINT_GET_CLICKED: 'point:get:clicked',
  POINT_CLICKED_RESPONSE: 'point:clicked:response',

  // Grid System
  GRID_SNAP_TOGGLE: 'grid:snap:toggle',
  GRID_SIZE_CHANGE: 'grid:size:change',
  GRID_VISIBILITY_TOGGLE: 'grid:visibility:toggle',

  // UI State Changes
  UI_TOOLBAR_TOGGLE: 'ui:toolbar:toggle',
  UI_SIDEBAR_TOGGLE: 'ui:sidebar:toggle',
  UI_THEME_CHANGE: 'ui:theme:change',
  UI_RESIZE: 'ui:resize',

  // Keyboard Events
  KEY_DOWN: 'key:down',
  KEY_UP: 'key:up',
  KEY_SHORTCUT: 'key:shortcut',

  // Export Operations
  EXPORT_START: 'export:start',
  EXPORT_SUCCESS: 'export:success',
  EXPORT_ERROR: 'export:error',

  // Status Messages
  STATUS_SHOW: 'status:show',
  STATUS_HIDE: 'status:hide',
  STATUS_UPDATE: 'status:update',

  // Canvas Rendering
  CANVAS_REDRAW: 'canvas:redraw',
  CANVAS_CLEAR: 'canvas:clear',
  CANVAS_RESIZE: 'canvas:resize',

  // Application Lifecycle
  APP_INIT: 'app:init',
  APP_READY: 'app:ready',
  APP_DESTROY: 'app:destroy'
};

