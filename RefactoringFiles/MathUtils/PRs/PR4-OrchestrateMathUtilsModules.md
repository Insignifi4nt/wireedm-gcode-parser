# MathUtils PR4: Orchestrate Geometry Modules

## Overview
Transform MathUtils.js from a monolithic utility file into a clean re-export orchestrator that provides the same public API while delegating to the three focused geometry modules.

## Scope
Update MathUtils.js to:
- Re-export all classes from the three geometry modules
- Maintain identical public API for all consumers
- Provide clean import facade while modules can also be imported directly
- Reduce from ~44 remaining lines to ~30 orchestration lines

## Current State After PR1-PR3
After extracting classes in PR1-PR3, MathUtils.js should have only:
- Import statements
- JSDoc comments  
- Any remaining utility code not extracted

**Expected current size**: ~44 lines (after 487 lines extracted)

## Target Orchestrator Structure

### MathUtils.js Final Structure (~30 lines)
```javascript
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

// Optional: Namespace exports for organized access
export * as Coordinate from './geometry/CoordinateTransforms.js';
export * as Arc from './geometry/ArcCalculations.js';
export * as Bounds from './geometry/BoundsCalculations.js';
```

## Import Compatibility Strategy

### Current Consumer Imports (unchanged)
```javascript
// All existing imports continue to work
import { CoordinateTransform, BoundsUtils, ArcUtils } from 'src/utils/MathUtils.js';
```

### Optional Direct Module Imports (new capability)
```javascript
// Consumers can now import directly for focused usage
import { ArcUtils } from 'src/utils/geometry/ArcCalculations.js';
import { CoordinateTransform } from 'src/utils/geometry/CoordinateTransforms.js';
```

### Namespace Import Options (new capability)
```javascript
// Organized namespace access
import { Arc, Bounds, Coordinate } from 'src/utils/MathUtils.js';
const arcBounds = Arc.ArcUtils.calculateArcBounds(...);
```

## Public API Preservation

### All Classes Available Through MathUtils.js
- ✅ `CoordinateTransform` - Screen/world coordinate conversions
- ✅ `MeasurementUtils` - Distance, angle, midpoint calculations
- ✅ `GridUtils` - Grid snapping and line calculations  
- ✅ `BoundsUtils` - Bounds creation, validation, operations
- ✅ `ArcUtils` - Arc geometry for G2/G3 commands
- ✅ `ZoomUtils` - Viewport zoom and fit-to-screen calculations
- ✅ `PrecisionUtils` - Numerical precision utilities
- ✅ `ValidationUtils` - Coordinate validation

### Method-Level Compatibility
Every static method on every class remains available through the same import path and calling convention.

## Benefits of Orchestrator Pattern

### 1. Backward Compatibility
- Zero breaking changes for existing consumers
- All import statements continue to work unchanged
- Same method signatures and behavior

### 2. Forward Flexibility  
- Consumers can gradually migrate to direct module imports
- Focused imports reduce bundle size for tree-shaking
- Clear module boundaries for better code organization

### 3. Development Benefits
- Easier testing of focused modules in isolation
- Clear separation of mathematical concerns
- Better code organization and maintainability

## File Size Reduction Summary

### Before Refactoring
- **MathUtils.js**: 531 lines (monolithic)

### After Refactoring  
- **MathUtils.js**: ~30 lines (orchestrator)
- **CoordinateTransforms.js**: ~250 lines
- **ArcCalculations.js**: ~115 lines  
- **BoundsCalculations.js**: ~122 lines
- **Total**: 517 lines across 4 files

**Size reduction**: 531 → 30 lines (94% reduction in main file)
**Organization improvement**: 3 focused modules + clean orchestrator

## Files Modified
- **Update**: `src/utils/MathUtils.js` - Convert to re-export orchestrator
- **Verify**: All geometry modules work correctly through orchestrator

## Consumer Verification

### Critical Usage Patterns to Test
```javascript
// Canvas coordinate conversions
import { CoordinateTransform } from 'src/utils/MathUtils.js';
const worldPoint = CoordinateTransform.screenToWorld(...);

// G-code arc rendering  
import { ArcUtils } from 'src/utils/MathUtils.js';
const arcBounds = ArcUtils.calculateArcBounds(...);

// Viewport fit-to-screen
import { ZoomUtils, BoundsUtils } from 'src/utils/MathUtils.js';
const zoom = ZoomUtils.calculateFitToScreenZoom(...);

// Grid snapping
import { GridUtils } from 'src/utils/MathUtils.js'; 
const snapped = GridUtils.snapPointToGrid(...);
```

## Build Verification Steps
1. **Import resolution**: All re-exports resolve correctly
2. **Consumer compatibility**: All existing usage patterns work
3. **Bundle analysis**: Verify tree-shaking works with new structure
4. **Module isolation**: Each geometry module can be imported independently

## Success Criteria
- [ ] MathUtils.js reduced to ~30 line orchestrator
- [ ] All existing import patterns work unchanged
- [ ] All mathematical operations produce identical results
- [ ] Build passes without import/export errors  
- [ ] New direct module imports work correctly
- [ ] No behavioral changes in any mathematical operations
- [ ] Bundle size impact is minimal or positive (tree-shaking)

## Cleanup Tasks
- [ ] Remove any unused imports from previous extraction PRs
- [ ] Verify JSDoc comments are complete and accurate
- [ ] Ensure consistent code style across all modules
- [ ] Update any internal references between geometry modules

## Documentation Updates After PR4
- Update README or docs to mention new module structure
- Document the new direct import capabilities
- Note the orchestrator pattern for future refactoring reference

This completes the MathUtils refactoring: 531-line monolith → 3 focused modules + 30-line orchestrator.