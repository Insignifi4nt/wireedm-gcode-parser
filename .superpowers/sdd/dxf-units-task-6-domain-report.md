# DXF units Task 6 domain/post report

## Delivered

- Added an interpreter-backed executable G-code word scanner with source-line metadata.
- Reused the scanner for generic structured compensation template validation instead of maintaining a second regular-expression lexer.
- Added the `post-inch-units-unsupported` diagnostic code.
- Gated only UPID composition when G20 is requested by the selected project profile or appears in the effective header, footer, or candidate posted body.
- Made G20 blocking atomic: generated body, moves, operations, blocks, metrics, and program-operation trace are empty and download readiness is false.
- Kept comments, G200, and G21 safe from false positives.
- Kept the preferred DXF import unit independent from output units and prevented a second coordinate scale.
- Added a regression proving external `gcode-text` containing G20 still imports and exports through the legacy machine-program pipeline.
- Preserved the verified Robofil/z39 domain output behavior.

## TDD evidence

RED was observed before production changes:

- 3 files / 91 tests discovered.
- 6 expected failures: two missing scanner cases and four missing UPID G20 safety cases.
- The external G20 text regression and compatibility cases were already green, proving the requested scoping boundary.

GREEN after implementation:

- Scanner/UPID/external-text focus: 3 files / 91 tests passed.
- Expanded Task 6 + Robofil/z39/compensation focus: 9 files / 196 tests passed.

## Concurrent integration status

The full suite was run and reached 1104 passing tests with three failures, all in the concurrently active Task 4 confirmation-dialog tests. The production build likewise reached only Task 4's unintegrated controller/dialog type errors. No Task 4 controller, dialog, app DXF flow, or E2E files were changed by this task. Full-suite/build/E2E evidence will be rerun after Task 4 lands, as a follow-up.

## Review handoff

Review the exact Task 6 domain commit for:

- exact lexical G20 matching and comment/G200 behavior;
- effective-source selection when a machine snapshot is present;
- candidate post-body scanning;
- atomic removal of generated millimetre motion;
- preservation of existing post diagnostics and `programOwned` semantics;
- no coupling to `preferredDxfImportUnit`;
- no global G20 ban in external machine-program text;
- unchanged verified Robofil/z39 output.
