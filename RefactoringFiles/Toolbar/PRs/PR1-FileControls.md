# PR1: Extract FileControls

Status: Planned

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

