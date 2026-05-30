# MathUtils PR0: Scaffold Geometry Module Structure

## Overview
Create the foundational directory structure and stub files for the three geometry modules, establishing the architectural pattern before moving code.

## Scope
Set up the geometry module structure:
```
src/utils/geometry/
├── CoordinateTransforms.js    - Coordinate system operations
├── ArcCalculations.js         - Arc geometry mathematics  
└── BoundsCalculations.js      - Bounds and viewport math
```

## Files to Create

### 1. src/utils/geometry/ Directory
Create the geometry subdirectory under utils/

### 2. CoordinateTransforms.js Stub
```javascript
/**
 * Coordinate Transformations and Grid Utilities
 * Screen/world conversions, measurements, grid operations, precision utilities
 */

import { COORDINATES, VIEWPORT } from '../Constants.js';

// TODO: Move CoordinateTransform class here (lines 11-89)
// TODO: Move MeasurementUtils class here (lines 94-147)  
// TODO: Move GridUtils class here (lines 152-208)
// TODO: Move PrecisionUtils class here (lines 464-496)
// TODO: Move ValidationUtils class here (lines 501-532)

// Temporary stub exports
export class CoordinateTransform {}
export class MeasurementUtils {}
export class GridUtils {}
export class PrecisionUtils {}
export class ValidationUtils {}
```

### 3. ArcCalculations.js Stub
```javascript
/**
 * Arc Geometry Calculations
 * Mathematical operations for G2/G3 arc commands
 */

// TODO: Move ArcUtils class here (lines 290-404)
// Will need imports from BoundsCalculations and CoordinateTransforms

// Temporary stub exports
export class ArcUtils {}
```

### 4. BoundsCalculations.js Stub
```javascript  
/**
 * Bounds and Viewport Calculations
 * Bounds operations, zoom calculations, viewport mathematics
 */

import { VIEWPORT } from '../Constants.js';

// TODO: Move BoundsUtils class here (lines 213-285)
// TODO: Move ZoomUtils class here (lines 409-459)

// Temporary stub exports  
export class BoundsUtils {}
export class ZoomUtils {}
```

## Import Analysis

### Dependencies Between New Modules
- **ArcCalculations** will need:
  - `BoundsUtils` from BoundsCalculations
  - `MeasurementUtils` from CoordinateTransforms
- **ZoomUtils** will need:
  - `BoundsUtils` from BoundsCalculations  
- **No circular dependencies** - Clean dependency tree

### External Dependencies
All modules will import from:
- `../Constants.js` (COORDINATES, VIEWPORT constants)

## Build Verification
After creating stubs:
- [ ] `npm run build` passes without errors
- [ ] No import/export errors 
- [ ] Directory structure created correctly
- [ ] All stub files have basic class exports

## Files Modified
- **New**: `src/utils/geometry/CoordinateTransforms.js` 
- **New**: `src/utils/geometry/ArcCalculations.js`
- **New**: `src/utils/geometry/BoundsCalculations.js`

## Success Criteria
- [ ] Clean directory structure established
- [ ] All stub files created with proper imports
- [ ] Build passes with stub exports
- [ ] Ready for incremental code migration in PR1-PR3

## Next Steps
- PR1: Migrate CoordinateTransforms classes
- PR2: Migrate ArcCalculations classes  
- PR3: Migrate BoundsCalculations classes
- PR4: Update MathUtils.js to re-export orchestrator