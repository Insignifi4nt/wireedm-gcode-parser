# PR3: Extract ActionControls

Status: Planned

## Summary
Move clear points, export ISO, drawer toggle, and normalize-to-ISO button handlers into `components/toolbar/ActionControls.js`.

## Motivation
Utility actions form a cohesive block; extraction cleans up Toolbar and keeps API stable.

## Scope
- In: Emit `POINT_CLEAR_ALL`, `EXPORT_START` (iso), `drawer:toggle`, and normalize-to-ISO via IsoNormalizer + FileHandler download.
- Out: Visual/UI changes.

## Acceptance Criteria
- All actions behave as before; button enabled/disabled states unchanged.

## Test Plan
- Run through actions; verify status messages and exports.

