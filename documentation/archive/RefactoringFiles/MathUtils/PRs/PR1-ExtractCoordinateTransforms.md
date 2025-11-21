# MathUtils PR1: Extract Coordinate Transform Classes

## Overview
Move all coordinate system operations, measurements, grid utilities, and precision/validation classes from MathUtils.js to CoordinateTransforms.js.

## Scope
Extract and move the following classes from MathUtils.js:
- `CoordinateTransform` (lines 11-89) - 78 lines
- `MeasurementUtils` (lines 94-147) - 53 lines  
- `GridUtils` (lines 152-208) - 56 lines
- `PrecisionUtils` (lines 464-496) - 32 lines
- `ValidationUtils` (lines 501-532) - 31 lines

**Total extraction**: ~250 lines → CoordinateTransforms.js

## Classes to Extract

### 1. CoordinateTransform Class (lines 11-89)
**Methods:**
- `screenToWorld()` - Convert screen to world coordinates
- `worldToScreen()` - Convert world to screen coordinates  
- `applyTransform()` - Apply canvas transformation

**Dependencies**: PrecisionUtils.round() (internal to new module)

### 2. MeasurementUtils Class (lines 94-147)
**Methods:**
- `distance()` - Euclidean distance between points
- `angleRadians()` - Angle in radians  
- `angleDegrees()` - Angle in degrees
- `midpoint()` - Calculate midpoint between points

**Dependencies**: None (pure mathematical functions)

### 3. GridUtils Class (lines 152-208)
**Methods:**
- `snapToGrid()` - Snap coordinate to grid
- `snapPointToGrid()` - Snap point to grid
- `calculateGridLines()` - Calculate grid lines for rendering

**Dependencies**: None (pure mathematical functions)

### 4. PrecisionUtils Class (lines 464-496)  
**Methods:**
- `round()` - Round to decimal places
- `format()` - Format number for display
- `approximately()` - Check approximate equality

**Dependencies**: COORDINATES.PRECISION constant

### 5. ValidationUtils Class (lines 501-532)
**Methods:**
- `isValidCoordinate()` - Validate single coordinate
- `isValidPoint()` - Validate point object
- `sanitizeCoordinate()` - Clean coordinate value

**Dependencies**: None (pure validation functions)

## Import Updates

### CoordinateTransforms.js Imports
```javascript
import { COORDINATES, VIEWPORT } from '../Constants.js';
```

### Internal Dependencies
- `CoordinateTransform.screenToWorld()` uses `PrecisionUtils.round()`
- All other classes are independent within this module

## File Structure After Extraction

### CoordinateTransforms.js (~250 lines)
```javascript
/**
 * Coordinate Transformations and Grid Utilities  
 * Screen/world conversions, measurements, grid operations, precision utilities
 */

import { COORDINATES, VIEWPORT } from '../Constants.js';

export class CoordinateTransform {
  // 78 lines of coordinate transformation logic
}

export class MeasurementUtils {
  // 53 lines of distance/angle calculations
}

export class GridUtils {
  // 56 lines of grid snapping logic  
}

export class PrecisionUtils {
  // 32 lines of numerical precision utilities
}

export class ValidationUtils {
  // 31 lines of coordinate validation
}
```

## Behavioral Preservation Requirements

### Critical Functions
- **Coordinate precision**: Must maintain exact floating-point behavior
- **Grid snapping**: Exact same snapping behavior for UI consistency
- **Measurement accuracy**: Distance/angle calculations must be identical
- **Canvas transforms**: Screen/world conversions must be pixel-perfect

### Validation Requirements
- All coordinate transformations produce identical results
- Grid calculations work identically for canvas rendering
- Measurement tools show same values
- No precision drift in repeated calculations

## Files Modified
- **Update**: `src/utils/geometry/CoordinateTransforms.js` - Add extracted classes
- **Update**: `src/utils/MathUtils.js` - Remove extracted classes

## Lines Removed from MathUtils.js
- Remove lines 11-89 (CoordinateTransform)
- Remove lines 94-147 (MeasurementUtils)  
- Remove lines 152-208 (GridUtils)
- Remove lines 464-496 (PrecisionUtils)
- Remove lines 501-532 (ValidationUtils)

**Expected reduction**: 531 → ~281 lines (250 lines extracted)

## Success Criteria
- [ ] All 5 classes moved to CoordinateTransforms.js
- [ ] All coordinate transformations work identically
- [ ] Grid rendering behavior unchanged
- [ ] Measurement calculations identical
- [ ] Build passes without errors
- [ ] No precision or accuracy regressions

## Dependencies for Next PRs
- PR2 (ArcCalculations) will import `MeasurementUtils` from this module
- PR3 (BoundsCalculations) - no dependencies on this module

## Validation Steps
1. **Coordinate accuracy** - Screen/world conversions identical
2. **Grid behavior** - Grid snapping works exactly the same
3. **Measurement tools** - Distance/angle measurements unchanged  
4. **Canvas rendering** - No visual differences in coordinate display
5. **Build stability** - No import/export errors