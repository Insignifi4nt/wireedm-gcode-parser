# MathUtils.js Refactoring Scope

## Overview
Refactor MathUtils.js (531 lines) from a monolithic utility file into three focused geometry modules with clear separation of mathematical concerns.

## Current Analysis

### File Size: 531 lines
**Classes identified:**
- `CoordinateTransform` - 89 lines (lines 11-89)
- `MeasurementUtils` - 56 lines (lines 94-147)
- `GridUtils` - 57 lines (lines 152-208)
- `BoundsUtils` - 77 lines (lines 213-285)
- `ArcUtils` - 115 lines (lines 290-404)
- `ZoomUtils` - 49 lines (lines 409-459)
- `PrecisionUtils` - 36 lines (lines 464-496)
- `ValidationUtils` - 32 lines (lines 501-532)

## Target Module Structure

### 1. CoordinateTransforms.js (~200 lines)
**Purpose**: Coordinate system operations and transformations
- `CoordinateTransform` class - Screen/world coordinate conversions
- `MeasurementUtils` class - Distance, angle, midpoint calculations  
- `GridUtils` class - Grid snapping and line calculations
- `PrecisionUtils` class - Numerical precision utilities
- `ValidationUtils` class - Coordinate validation

**Rationale**: Groups all coordinate-related operations and transformations

### 2. ArcCalculations.js (~115 lines)
**Purpose**: Arc geometry mathematics for G2/G3 commands
- `ArcUtils` class - Complete arc geometry system
- Arc parameter calculations
- Arc bounds computations
- Angle span operations

**Rationale**: Arc math is complex and self-contained, used specifically for G-code arc rendering

### 3. BoundsCalculations.js (~170 lines)  
**Purpose**: Bounds and viewport mathematics
- `BoundsUtils` class - Bounds creation, validation, operations
- `ZoomUtils` class - Viewport zoom and fit-to-screen calculations
- Bounds expansion and dimension calculations

**Rationale**: Bounds and zoom operations work together for viewport management

## Import Dependencies
- Constants.js (COORDINATES, VIEWPORT) - Used by all modules
- Internal dependencies between new modules (ArcUtils uses BoundsUtils, etc.)

## Consumer Update Strategy
MathUtils.js is imported by:
- Canvas components (coordinate transforms, arc rendering)
- Viewport system (zoom, bounds calculations)
- G-Code parser (arc calculations)
- Event handlers (coordinate conversions)

**Strategy**: Keep MathUtils.js as a re-export facade initially, then update consumers gradually.

## Success Criteria
- [ ] 3 focused geometry modules created
- [ ] MathUtils.js becomes re-export orchestrator
- [ ] All mathematical operations work identically
- [ ] Build passes without errors
- [ ] No behavioral changes to geometry calculations
- [ ] Clear separation of coordinate/arc/bounds concerns

## Risk Assessment
- **Low risk**: Well-defined class boundaries already exist
- **No circular dependencies**: Clean mathematical utility relationships
- **High precision requirements**: Must maintain exact numerical behavior
- **Extensive usage**: Used throughout rendering and parsing systems

## Expected Outcome
**Before**: 531-line monolithic utility file
**After**: 3 focused modules + orchestrator (~150 lines total reduction)

This refactor improves code organization while maintaining the mathematical precision required for G-code visualization.