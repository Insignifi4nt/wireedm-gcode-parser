# PR1: Extract FileControls

Status: Completed

## Summary
Move file input and drag/drop handling into `components/toolbar/FileControls.js`, delegating file operations to `FileHandler` and emitting FILE_* events as today.

## Motivation
File I/O concerns are independent from view and actions; extracting simplifies Toolbar and makes behavior testable in isolation.

## Scope
- In: Input change, label dragover/dragleave/drop handlers; helper to update label text.
- Out: Any change to file validation or FileHandler API.

## Acceptance Criteria
- Behavior parity for file selection and drag/drop; status updates and button states unchanged.

## Test Plan
- Select file via input and via drag/drop; observe loading status and success/error flows.

Implementation Notes
- Added `src/components/toolbar/FileControls.js` with `init()` and `destroy()` to bind/unbind file input change and label drag/drop.
- Updated `src/components/Toolbar.js` to instantiate `FileControls` and delegate file handling via `onChooseFile(file) → _loadFile(file)`.
- Removed direct event bindings in `_setupEventListeners` for file input and label drag/drop (now handled by FileControls).
- Kept `_loadFile` in Toolbar to manage state, FileHandler usage, and label/status updates via EventBus.

Verification
- File selection (input + drag/drop) triggers load; `FILE_LOAD_*` events still flow; label text updates to “Loading...” then resets; error path resets input.
