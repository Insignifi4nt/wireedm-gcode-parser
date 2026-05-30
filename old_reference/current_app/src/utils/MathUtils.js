/**
 * Mathematical Utilities for Wire EDM G-Code Viewer
 * Coordinate transformations, distance calculations, and geometric utilities
 * 
 * This module provides a unified interface to geometry utilities.
 * Individual modules can also be imported directly for focused usage.
 */

// Coordinate system operations and transformations
export { 
  CoordinateTransform,
  MeasurementUtils, 
  GridUtils,
  PrecisionUtils,
  ValidationUtils 
} from './geometry/CoordinateTransforms.js';

// Arc geometry mathematics for G2/G3 commands
export { 
  ArcUtils 
} from './geometry/ArcCalculations.js';

// Bounds and viewport calculations
export { 
  BoundsUtils,
  ZoomUtils 
} from './geometry/BoundsCalculations.js';







