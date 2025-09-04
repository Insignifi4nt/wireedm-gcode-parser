# PR3: Extract ActionControls

Status: Completed

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

Implementation Notes
- Added `src/components/toolbar/ActionControls.js` to handle clear points, export ISO, drawer toggle, and normalize-to-ISO.
- Updated `src/components/Toolbar.js` to instantiate `ActionControls` and removed direct bindings for these actions.
- `getTextForNormalization` uses drawer text or loaded file content; normalization/export delegated to `FileHandler.exportNormalizedISOFromText` with generated filename.
- Preserved original custom status emission `status:show` after successful normalization.

Verification
- Manual checks confirmed clear/export/drawer/normalize behave as before; button states unchanged; success status shown for normalization; EventBus EXPORT_* events still fire.
