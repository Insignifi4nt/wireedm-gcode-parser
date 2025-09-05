# MathUtils PR2: Extract Arc Calculation Classes

## Overview
Move the complete ArcUtils class from MathUtils.js to ArcCalculations.js, creating a focused module for all G2/G3 arc mathematical operations.

## Scope
Extract the ArcUtils class (lines 290-404) - 115 lines of complex arc geometry mathematics used specifically for G-code arc rendering and bounds calculations.

## Class to Extract

### ArcUtils Class (lines 290-404)
**Methods:**
- `calculateArcParameters()` - Calculate radius, start/end angles, angle span
- `pointOnArc()` - Calculate point coordinates at given angle on arc
- `calculateArcBounds()` - Calculate tight bounds for arc segments
- `angleInArcSpan()` - Check if angle falls within arc sweep

**Mathematical Operations:**
- Arc parameter calculation from start/end/center points
- Angle normalization and span calculations
- Clockwise vs counterclockwise arc direction handling
- Arc bounds calculation including axis extremes (0°, 90°, 180°, 270°)

## Dependencies Analysis

### Internal Dependencies (within new module)
- All methods within ArcUtils are interdependent
- Complex mathematical relationships for arc geometry

### External Dependencies (imports needed)
```javascript
// From CoordinateTransforms.js (PR1)
import { MeasurementUtils } from './CoordinateTransforms.js';

// From BoundsCalculations.js (PR3 - will need to handle carefully)  
import { BoundsUtils } from './BoundsCalculations.js';
```

**Note**: This creates a dependency on BoundsUtils which hasn't been extracted yet in PR3. We'll need to handle this dependency carefully.

## Dependency Resolution Strategy

### Option 1: Temporary BoundsUtils Import (Recommended)
```javascript
// Temporarily import from main MathUtils until PR3
import { BoundsUtils } from '../MathUtils.js';
import { MeasurementUtils } from './CoordinateTransforms.js';
```

### Option 2: Extract BoundsUtils First
Adjust PR order: PR2 extracts BoundsCalculations, PR3 extracts ArcCalculations

**Recommendation**: Use Option 1 to maintain logical grouping - arc math should be its own focused module.

## File Structure After Extraction

### ArcCalculations.js (~115 lines)
```javascript
/**
 * Arc Geometry Calculations
 * Mathematical operations for G2/G3 arc commands in G-code
 */

import { MeasurementUtils } from './CoordinateTransforms.js';
import { BoundsUtils } from '../MathUtils.js'; // Temporary until PR3

export class ArcUtils {
  /**
   * Calculate arc parameters from start/end/center points
   */
  static calculateArcParameters(startX, startY, endX, endY, centerX, centerY, clockwise) {
    // 35 lines of complex arc parameter math
  }
  
  /**
   * Calculate point coordinates at given angle on arc
   */
  static pointOnArc(centerX, centerY, radius, angle) {
    // 10 lines of coordinate calculation
  }
  
  /**
   * Calculate precise bounds for arc segments
   */
  static calculateArcBounds(startX, startY, endX, endY, centerX, centerY, clockwise) {
    // 45 lines of bounds calculation including axis extremes
  }
  
  /**
   * Check if angle falls within arc sweep
   */
  static angleInArcSpan(angle, startAngle, endAngle, clockwise) {
    // 25 lines of angle normalization and span checking
  }
}
```

## Arc Mathematics Precision Requirements

### Critical Accuracy Needs
- **G-code compatibility**: Arc calculations must match CNC machine precision
- **Visual accuracy**: Arc rendering must be visually smooth and accurate
- **Bounds precision**: Arc bounds must be mathematically tight for viewport fitting
- **Angle calculations**: Direction (clockwise/counterclockwise) must be preserved exactly

### Mathematical Edge Cases
- **Zero-radius arcs**: Handle degenerate cases gracefully
- **Full circle arcs**: 360° arc handling
- **Cross-quadrant arcs**: Arcs spanning multiple quadrants
- **Small angle arcs**: High precision for very small arc segments

## Consumer Impact Analysis

### Current ArcUtils Usage
- **GCodeParser**: Arc command parsing (G2/G3)
- **Canvas/PathRenderer**: Arc path rendering
- **Bounds calculations**: Fitting arcs to screen
- **Path highlighting**: Arc segment identification

### Migration Strategy
All consumers will temporarily import from MathUtils.js until complete refactor is done, then update imports to new location.

## Files Modified
- **Update**: `src/utils/geometry/ArcCalculations.js` - Add ArcUtils class
- **Update**: `src/utils/MathUtils.js` - Remove ArcUtils class (lines 290-404)

## Lines Removed from MathUtils.js
- Remove lines 290-404 (ArcUtils class)
- Update any imports if needed

**Expected reduction**: 281 → ~166 lines (115 lines extracted)

## Success Criteria
- [ ] ArcUtils class fully moved to ArcCalculations.js
- [ ] All G2/G3 arc rendering works identically
- [ ] Arc bounds calculations produce exact same results
- [ ] Arc parameter calculations maintain precision
- [ ] Build passes without import/export errors
- [ ] No visual differences in arc rendering

## Behavioral Validation Requirements
- **Arc rendering**: All G2/G3 commands render identically
- **Arc bounds**: Fit-to-screen behavior unchanged for files with arcs
- **Arc precision**: No degradation in arc mathematical accuracy
- **Performance**: Arc calculations perform at same speed

## Dependencies for Next PR
- PR3 (BoundsCalculations) will need to update ArcCalculations import to use local BoundsUtils

## Risk Mitigation
- **High complexity**: Arc mathematics is complex - thorough testing required
- **Precision critical**: CNC applications require exact mathematical accuracy
- **Circular import potential**: Careful dependency management during transition