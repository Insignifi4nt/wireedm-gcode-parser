# DXF Units Task 1 Brief

Date: 2026-07-13
Base commit: `1a1675b`

## Outcome

Model raw DXF unit-declaration status and future applied-unit provenance, and add an independent preferred DXF import-unit suggestion to reusable machine profiles and settings. This task does not add preparation, confirmation, persistence commit, reinterpretation, or post-output conversion.

## Binding behavior

- `parseDxf` retains a discriminated `unitDeclaration` for:
  - recognized `$INSUNITS`;
  - code zero / unitless;
  - nonnegative unknown integer codes;
  - missing declaration;
  - malformed declarations, retaining the raw group-70 text when present and `null` when absent.
- Recognized, unitless, and unknown declarations retain the existing `DxfDrawingUnits` record. Existing optional `parseResult.units` behavior remains compatible.
- Negative, non-safe-integer, noninteger, nonnumeric, blank, or absent group-70 values under an `$INSUNITS` variable are malformed. A wholly absent `$INSUNITS` variable is missing.
- Define `AppliedDxfUnits` with label, positive scale (validation comes later), basis (`dxf-declared`, `user-confirmed`, `legacy-assumed`), confirmation state/time, and optional machine-profile suggestion provenance.
- `PathPlanningSourceMetadata` can persist both `unitDeclaration` and `appliedUnits`, while `units` remains the raw parsed DXF units record.
- `MachineProfile.preferredDxfImportUnit` is a root-level `'millimeters' | 'inches' | null` suggestion. It is independent of controller `unitsCode` and output configuration.
- All default, blank, classic Robofil, and verified Robofil profiles normalize the preference to `null` unless explicitly set.
- Missing legacy preference normalizes to `null` without schema-version changes.
- Portable schema-v1 profile files round-trip a valid preference, accept a missing legacy preference as `null`, and reject any other value at their strict boundary.
- Settings drafts round-trip the preference and expose an editable selector with Automatic/no preference, millimeters, and inches.
- Editing the preference does not change output/controller units and does not invalidate controller verification. Do not include it in either current or legacy controller verification fingerprints.
- Preserve current direct DXF normalization and z39 behavior: raw recognized units still scale through the existing fallback and missing z39 units still assume scale 1 until later confirmation tasks.

## TDD and scope

1. Add failing parser, machine-profile codec/normalization, settings mapping, and settings-control tests. Run the focused suite and record the expected RED failures.
2. Add only the minimal types/parser/profile/codec/settings implementation to pass.
3. Run focused tests, full Vitest, production build, and `git diff --check`.
4. Stage only Task 1 files plus this brief/report and commit `feat: model DXF unit decisions`.

## Expected source files

- `src/domain/dxf/types.ts`
- `src/domain/dxf/parseDxf.ts`
- `src/domain/dxf/__tests__/parseDxf.test.ts`
- `src/domain/path-intel/types.ts`
- `src/domain/workbench/types.ts`
- `src/domain/workbench/defaultProject.ts`
- `src/domain/machine/machineProfiles.ts`
- `src/domain/machine/machineProfileFile.ts`
- `src/domain/machine/__tests__/machineProfiles.test.ts`
- `src/domain/machine/__tests__/machineProfileFile.test.ts`
- `src/app/workbenchSettings.ts`
- `src/app/workbenchSettings.test.ts`
- `src/app/MachineOutputSettingsPanel.tsx`
- corresponding existing settings-panel test file if needed

## Exclusions

- No new preparation/preview/commit API.
- No storage writes or manifest/project import changes.
- No geometry scaling behavior changes.
- No DXF confirmation dialog.
- No G20 gating.
- No Windows persistence edits and no `D:` access.
