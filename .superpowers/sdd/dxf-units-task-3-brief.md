# DXF units Task 3 brief

## Scope

Add the confirmed DXF import commit boundary while keeping the legacy one-call importer available until the UI migration. A committed import must use the reviewed machine/unit choice, normalize geometry exactly once, preserve raw DXF unit provenance, snapshot the selected machine, and write each durable target once.

## Required behavior

- Reject unconfirmed decisions before any storage adapter call.
- Resolve the selected machine from the current workbench manifest and reject stale selections.
- Require explicit acknowledgement when overriding a recognized DXF unit declaration.
- Generate collision-free project IDs at commit time.
- Store raw `units` and `unitDeclaration` separately from confirmed `appliedUnits`.
- Prefer `appliedUnits.scaleToMillimeters` during normalization, falling back to raw units only for legacy callers.
- Preserve an override warning in the UPID source diagnostics.
- Deep-snapshot the selected machine without changing the workbench default selection.
- Validate applied-unit metadata and its agreement with the recorded coordinate scale.
- Synthesize safe applied-unit metadata for legacy project documents without mutating their geometry or source object.

## Verification

Write failing tests first for the strict boundary, exactly-once normalization, validation, and clone-only legacy synthesis. Run focused DXF/UPID/editor tests, the Z39/Robofil regression coverage, the full test suite, and the production build before committing only Task 3 files.
