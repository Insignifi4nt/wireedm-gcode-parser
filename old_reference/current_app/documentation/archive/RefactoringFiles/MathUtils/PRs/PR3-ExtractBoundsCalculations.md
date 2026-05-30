# MathUtils PR3: Extract Bounds and Zoom Calculation Classes

## Overview
Move BoundsUtils and ZoomUtils classes from MathUtils.js to BoundsCalculations.js, completing the extraction of viewport and bounds mathematics.

## Scope
Extract the following classes from MathUtils.js:
- `BoundsUtils` (lines 213-285) - 72 lines
- `ZoomUtils` (lines 409-459) - 50 lines

**Total extraction**: ~122 lines → BoundsCalculations.js

## Classes to Extract

### 1. BoundsUtils Class (lines 213-285)
**Methods:**
- `createEmptyBounds()` - Initialize bounds object
- `updateBounds()` - Update bounds with new point
- `isValidBounds()` - Validate bounds object
- `getBoundsDimensions()` - Calculate width/height/center
- `expandBounds()` - Add margin to bounds

**Mathematical Operations:**
- Bounds initialization and validation
- Point-by-point bounds expansion
- Bounds dimension calculations
- Bounds margin expansion

### 2. ZoomUtils Class (lines 409-459)
**Methods:**
- `calculateFitToScreenZoom()` - Calculate zoom for bounds fitting
- `calculateCenterOffset()` - Calculate viewport centering offset
- `clampZoom()` - Clamp zoom to valid range

**Viewport Operations:**
- Fit-to-screen zoom calculations
- Content centering mathematics
- Zoom level validation and clamping

## Dependencies Analysis

### Internal Dependencies
- `ZoomUtils.calculateFitToScreenZoom()` uses `BoundsUtils.getBoundsDimensions()`
- `ZoomUtils.calculateCenterOffset()` uses `BoundsUtils.getBoundsDimensions()`
- Clean internal relationship within the new module

### External Dependencies
```javascript
import { VIEWPORT } from '../Constants.js';
// ZoomUtils needs VIEWPORT constants for min/max zoom, default zoom, padding
```

### Dependency Resolution for ArcCalculations
After this PR, need to update ArcCalculations.js:
```javascript
// Update this import in ArcCalculations.js
import { BoundsUtils } from './BoundsCalculations.js'; // Instead of from MathUtils.js
```

## File Structure After Extraction

### BoundsCalculations.js (~122 lines)
```javascript
/**
 * Bounds and Viewport Calculations
 * Bounds operations, zoom calculations, viewport mathematics
 */

import { VIEWPORT } from '../Constants.js';

export class BoundsUtils {
  /**
   * Create empty bounds for incremental building
   */
  static createEmptyBounds() {
    // 10 lines - bounds initialization
  }
  
  /**
   * Update bounds with new point coordinates
   */
  static updateBounds(bounds, x, y) {
    // 8 lines - min/max calculations
  }
  
  /**
   * Validate bounds are finite and usable
   */
  static isValidBounds(bounds) {
    // 5 lines - finite number validation
  }
  
  /**
   * Calculate bounds dimensions and center point
   */
  static getBoundsDimensions(bounds) {
    // 15 lines - width/height/center calculations
  }
  
  /**
   * Expand bounds by uniform margin
   */
  static expandBounds(bounds, margin) {
    // 10 lines - margin expansion
  }
}

export class ZoomUtils {
  /**
   * Calculate zoom level to fit content bounds in viewport
   */
  static calculateFitToScreenZoom(bounds, canvasWidth, canvasHeight, padding) {
    // 20 lines - fit-to-screen zoom math
  }
  
  /**
   * Calculate viewport offset to center content
   */
  static calculateCenterOffset(bounds, zoom, canvasWidth, canvasHeight) {
    // 15 lines - centering calculations
  }
  
  /**
   * Clamp zoom to valid range
   */
  static clampZoom(zoom) {
    // 5 lines - min/max clamping
  }
}
```

## Viewport Mathematics Requirements

### Critical Viewport Operations
- **Fit-to-screen**: Must calculate identical zoom levels for content fitting
- **Content centering**: Viewport centering must position content identically
- **Bounds validation**: Empty/invalid bounds handling must be identical
- **Zoom clamping**: Min/max zoom enforcement must be exact

### Edge Cases
- **Empty bounds**: Handle content-less files gracefully
- **Single point bounds**: Zero-dimension bounds handling
- **Extreme content**: Very large or very small content bounds
- **Zoom limits**: Proper enforcement of min/max zoom constraints

## Consumer Impact Analysis

### Current BoundsUtils/ZoomUtils Usage
- **Viewport class**: Fit-to-screen operations, zoom management
- **Canvas component**: Bounds calculations for rendering optimization
- **GCodeParser**: Bounds calculation during file parsing
- **Toolbar**: Zoom controls and fit-to-screen buttons

### High-Impact Functions
- `calculateFitToScreenZoom()` - Critical for user experience
- `getBoundsDimensions()` - Used throughout bounds operations
- `updateBounds()` - Used in parsing and bounds building

## Files Modified
- **Update**: `src/utils/geometry/BoundsCalculations.js` - Add extracted classes
- **Update**: `src/utils/MathUtils.js` - Remove extracted classes
- **Update**: `src/utils/geometry/ArcCalculations.js` - Update BoundsUtils import

## Lines Removed from MathUtils.js
- Remove lines 213-285 (BoundsUtils)
- Remove lines 409-459 (ZoomUtils)

**Expected reduction**: 166 → ~44 lines (122 lines extracted)

## Success Criteria
- [ ] Both classes moved to BoundsCalculations.js
- [ ] All viewport operations work identically (fit-to-screen, centering)
- [ ] Bounds calculations produce identical results
- [ ] Zoom level calculations unchanged
- [ ] ArcCalculations.js import updated successfully
- [ ] Build passes without errors
- [ ] No behavioral changes in viewport operations

## Cross-Module Import Updates

### ArcCalculations.js Import Update
```javascript
// Change from:
import { BoundsUtils } from '../MathUtils.js';

// To:
import { BoundsUtils } from './BoundsCalculations.js';
```

## Behavioral Validation Requirements
- **Fit-to-screen button**: Must zoom to exact same level
- **Content centering**: Must position content identically 
- **Bounds building**: File parsing bounds must be identical
- **Zoom controls**: Min/max enforcement unchanged
- **Performance**: Bounds operations maintain speed

## Dependencies for Next PR
- PR4 (MathUtils orchestrator) - will import from all three new modules

## Risk Assessment
- **Medium risk**: Viewport operations are critical to user experience
- **High visibility**: Any regression immediately visible to users
- **Complex mathematics**: Zoom calculations involve precision requirements