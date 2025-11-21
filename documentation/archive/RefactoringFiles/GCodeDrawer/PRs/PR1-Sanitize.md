# PR1: Extract Sanitization Helpers

## Summary
Move input sanitization logic out of `GCodeDrawer.js` into a small utility module to improve cohesion and enable reuse.

## Motivation
`_sanitizeInput` and `_sanitizeContentEditableInput` are generic and used to protect against HTML injection and control chars. Housing them in `utils` clarifies ownership and enables future reuse.

## Scope
- In: Add `src/utils/Sanitize.js`; update `GCodeDrawer.js` to import and use.
- Out: No behavior changes; no edits to other components.

## Changes
- Add `src/utils/Sanitize.js` with exported `sanitizeText(input)` and `sanitizeContentEditable(element)`.
- Replace calls to internal methods in `GCodeDrawer.js` with imports.
- Remove the old private methods.

## API / Events
- No public API changes.
- No event changes.

## Acceptance Criteria
- Behavior identical; caret restore still works; debounce behavior unchanged. ✅
- All occurrences in `GCodeDrawer.js` use the new helpers. ✅
- Build passes and no new console warnings/errors. ✅

## Test Plan
- Paste HTML into a line; ensure tags stripped and caret remains logical.
- Paste control chars; verify removal.
- Edit a line, blur; ensure sanitize still applies and content change emits.

## Risks & Mitigations
- Caret restoration regressions: keep logic that preserves selection when content changes.

## Implementation Notes (Completed)
- Added `src/utils/Sanitize.js` with:
  - `sanitizeText(input)` (moved logic from `_sanitizeInput`).
  - `sanitizeContentEditable(element)` (moved logic from `_sanitizeContentEditableInput`, preserves caret).
- Updated `src/components/GCodeDrawer.js` to import and use the helpers in input, blur, paste handlers, and content emission.
- Removed the old private sanitization methods from `GCodeDrawer.js`.

## Verification
- `npm run build` succeeds.
- Manual checks: paste HTML and control chars; caret position remains stable; 3s debounce intact; `drawer:*` events unchanged.
