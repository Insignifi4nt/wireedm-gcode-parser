/**
 * Application Constants for Wire EDM G-Code Viewer
 * Centralized configuration for app-wide settings and values
 */

// Grid System Configuration
export const GRID = {
  SIZE: 5, // Larger grid size to reduce crowding (5mm instead of 1mm)
  MAJOR_LINES_INTERVAL: 20, // Major grid lines every 20 units for less crowding
  SNAP_ENABLED: false, // Default grid snap state
  COLORS: {
    MINOR: '#2a2a2a', // Darker minor grid lines (less visible)
    MAJOR: '#555', // Slightly lighter axes but still subtle
    LABELS: '#666' // Darker labels, less prominent
  },
  LINE_WIDTH: {
    MINOR: 0.25, // Much thinner minor lines
    MAJOR: 1 // Thinner major lines
  }
};

// Viewport and Zoom Configuration
export const VIEWPORT = {
  DEFAULT_ZOOM: 1,
  // Fallback absolute limits (instance will use dynamic limits once bounds are known)
  MIN_ZOOM: 1e-6,
  MAX_ZOOM: 1e6,
  ZOOM_STEP: 1.2, // Multiplier for zoom in/out
  WHEEL_ZOOM_STEP: 0.1, // Smaller step for wheel zoom
  FIT_PADDING: 50, // Padding in pixels when fitting to screen
  PAN_STEP: 50, // Pixels to pan with arrow keys
  DEFAULT_OFFSET: {
    X: 0, // Will be set to canvas.width / 2
    Y: 0  // Will be set to canvas.height / 2
  },
  // Dynamic zoom range around the fit-to-screen scale
  // Effective per-file limits will be computed as:
  //   minZoom = fitScale * MIN_FACTOR, maxZoom = fitScale * MAX_FACTOR
  DYNAMIC_RANGE: {
    MIN_FACTOR: 1 / 1000, // allow zooming out 1000x smaller than fit
    MAX_FACTOR: 1000      // and zooming in 1000x larger than fit
  }
};

// Canvas Rendering Configuration
export const CANVAS = {
  CURSOR_DEFAULT: 'crosshair',
  CURSOR_DRAG: 'move',
  HIGH_DPI_SCALE: 2, // For high-DPI displays
  REDRAW_THROTTLE: 16 // Milliseconds between redraws (60fps)
};

// G-Code Path Rendering Styles
export const PATH_STYLES = {
  RAPID: {
    COLOR: '#ffff00', // Yellow for rapid moves (G0)
    // Screen-space stroke in CSS pixels
    LINE_WIDTH_PX: 1.0,
    // Screen-space dash pattern in CSS pixels
    LINE_DASH_PX: [4, 3]
  },
  CUT: {
    COLOR: '#00ff00', // Green for cutting moves (G1)
    LINE_WIDTH_PX: 1.6,
    LINE_DASH_PX: []
  },
  ARC: {
    COLOR: '#00ff00', // Green for arc moves (G2/G3)
    LINE_WIDTH_PX: 1.6,
    LINE_DASH_PX: []
  }
};

// Point Markers Configuration
export const MARKERS = {
  START_POINT: {
    COLOR: '#ff0000', // Red for start point
    // Screen-space radius in CSS pixels
    RADIUS_PX: 4,
    LABEL: 'START',
    FONT: 'bold 10px Arial', // Smaller font
    OFFSET: { X: 6, Y: -6 }
  },
  END_POINT: {
    COLOR: '#0000ff', // Blue for end point
    RADIUS_PX: 3,
    LABEL: 'END',
    FONT: 'bold 4px Arial', // Even smaller font
    OFFSET: { X: 5, Y: -5 }
  },
  CLICKED_POINT: {
    COLOR: '#ff00ff', // Magenta for user-clicked points
    RADIUS_PX: 3,
    FONT: '4px Arial', // Smaller font
    OFFSET: { X: 4, Y: -4 }
  }
};

// File Handling Configuration
export const FILE = {
  SUPPORTED_EXTENSIONS: ['.gcode', '.nc', '.txt', '.iso'],
  MIME_TYPES: ['text/plain', 'application/octet-stream'],
  MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB limit
  ENCODING: 'utf-8'
};

// Status Messages Configuration
export const STATUS = {
  DURATION: 3000, // Default display duration in milliseconds
  COLORS: {
    SUCCESS: '#4CAF50',
    ERROR: '#f44336',
    WARNING: '#ff9800',
    INFO: '#2196F3'
  },
  POSITION: {
    TOP: '20px',
    RIGHT: '20px',
    LEFT: '20px',
    BOTTOM: '20px'
  }
};

// Keyboard Shortcuts
export const KEYBOARD = {
  GRID_SNAP_TOGGLE: ['g', 'G'],
  ZOOM_IN: ['+', '='],
  ZOOM_OUT: ['-', '_'],
  FIT_TO_SCREEN: ['f', 'F'],
  CLEAR_POINTS: ['c', 'C']
};

// Shortcuts Configuration
export const SHORTCUTS = {
  GRID_SNAP_TOGGLE: {
    keys: ['KeyG'],
    description: 'Toggle grid snapping'
  },
  ZOOM_IN: {
    keys: ['Equal'],
    modifiers: ['ctrl'],
    description: 'Zoom in'
  },
  ZOOM_OUT: {
    keys: ['Minus'],
    modifiers: ['ctrl'],
    description: 'Zoom out'
  },
  FIT_TO_SCREEN: {
    keys: ['KeyF'],
    description: 'Fit to screen'
  },
  CLEAR_POINTS: {
    keys: ['KeyC'],
    modifiers: ['ctrl'],
    description: 'Clear all points'
  }
};

// Mouse Button Constants
export const MOUSE = {
  LEFT: 0,
  MIDDLE: 1,
  RIGHT: 2
};

// Color Theme (Dark Theme)
export const THEME = {
  BACKGROUND: '#1a1a1a',
  SURFACE: '#2a2a2a',
  SURFACE_VARIANT: '#333',
  SURFACE_ELEVATED: '#404040',
  TEXT_PRIMARY: '#e0e0e0',
  TEXT_SECONDARY: '#888',
  ACCENT: '#4CAF50',
  ERROR: '#f44336',
  WARNING: '#ff9800',
  INFO: '#2196F3',
  SHADOW: 'rgba(0,0,0,0.3)'
};

// UI Component Dimensions
export const UI = {
  SIDEBAR_WIDTH: 300, // pixels
  HEADER_HEIGHT: 80, // approximate pixels
  BUTTON_HEIGHT: 40,
  INPUT_HEIGHT: 36,
  BORDER_RADIUS: 5,
  SPACING: {
    XS: 5,
    SM: 10,
    MD: 15,
    LG: 20,
    XL: 30
  }
};

// G-Code Parser Constants
export const GCODE = {
  COMMENT_PREFIXES: [';', '(', '%'],
  LINEAR_MOVES: ['G0', 'G1'],
  ARC_MOVES: ['G2', 'G3'],
  COORDINATE_PARAMS: ['X', 'Y', 'Z', 'I', 'J', 'K'],
  DEFAULT_PRECISION: 3 // Decimal places for coordinate display
};

// Export Formats
export const EXPORT = {
  GCODE: {
    EXTENSION: '.gcode',
    MIME_TYPE: 'text/plain',
    HEADER_COMMENT: '; Exported points from Wire EDM G-Code Viewer',
    DATE_FORMAT: 'YYYY-MM-DD HH:mm:ss'
  },
  ISO: {
    EXTENSION: '.iso',
    MIME_TYPE: 'text/plain'
  }
};

// Performance Configuration
export const PERFORMANCE = {
  MAX_PATH_POINTS: 100000, // Maximum path points before optimization
  RENDER_THROTTLE: 16, // Milliseconds between renders
  LARGE_FILE_THRESHOLD: 1024 * 1024, // 1MB
  CHUNK_SIZE: 1000 // Lines to process per chunk for large files
};

// Animation and Transitions
export const ANIMATION = {
  FAST: 150, // milliseconds
  NORMAL: 300,
  SLOW: 500,
  EASE: 'cubic-bezier(0.4, 0.0, 0.2, 1)'
};

// Coordinate System
export const COORDINATES = {
  ORIGIN: { X: 0, Y: 0 },
  UNITS: 'mm',
  PRECISION: 3,
  Y_AXIS_FLIPPED: true // Canvas Y-axis is flipped compared to CNC
};

// Development and Debug Configuration
export const DEBUG = {
  ENABLED: false, // Set to true for development
  LOG_LEVEL: 'info', // 'debug', 'info', 'warn', 'error'
  SHOW_PERFORMANCE_METRICS: false,
  SHOW_BOUNDS_DEBUG: true,
  // When true, overlays arc centers and radial lines for debugging
  SHOW_ARC_GEOMETRY: false
};
