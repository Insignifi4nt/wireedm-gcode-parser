# DXF Units Task 1 Report

Date: 2026-07-13
Base commit: `1a1675b`
Status: implementation complete; exact-scope commit pending at report creation

## Implemented

- Added a discriminated raw `$INSUNITS` declaration record for recognized, unitless, unknown, missing, and malformed declarations.
- Malformed declarations retain the exact group-70 text when present and `null` when the group is absent; negative, non-safe, noninteger, blank, and nonnumeric values fail into the malformed state.
- Preserved the existing optional `parseResult.units` compatibility record for recognized, unitless, and unknown integer codes.
- Added `AppliedDxfUnits` and source-metadata slots for later applied-unit decisions and persisted declaration provenance without changing current normalization.
- Added root-level `preferredDxfImportUnit` to machine profiles, with conservative legacy/default normalization to `null`.
- Extended the strict portable schema-v1 codec to preserve millimeters/inches, migrate a missing field to `null`, and reject invalid values.
- Extended settings draft mapping and the Machine & Output settings UI with an Automatic/no preference, millimeters, and inches selector.
- Kept the preference independent of controller `unitsCode`, output settings, and both current and legacy verification fingerprints.
- Updated the legacy stored-machine assertion for the additive normalized `null` field.

## TDD evidence

### RED

Command:

```bash
npm test -- --run src/domain/dxf/__tests__/parseDxf.test.ts src/domain/machine/__tests__/machineProfiles.test.ts src/domain/machine/__tests__/machineProfileFile.test.ts src/app/workbenchSettings.test.ts src/__tests__/appWorkbenchDashboard.test.tsx
```

Observed before production changes: exit 1, 18 expected failures across all five files. The parser returned no `unitDeclaration`; profiles/codecs/drafts had no preference; and the settings selector was absent.

### Focused GREEN

The same command passed 5 files and 166/166 tests.

The compatibility slice:

```bash
npm test -- --run src/domain/dxf/__tests__/dxfToUpid.test.ts src/domain/dxf/__tests__/z39Compensation.test.ts src/domain/dxf/__tests__/z39RobofilPost.test.ts
```

passed 3 files and 48/48 tests. This proves direct raw-unit normalization remains intact and the missing-unit z39 fixture still uses the established scale-1 path.

The legacy stored-machine focused test passed 3/3 after its additive expectation was updated.

## Verification

- Focused Task 1 suite: 166/166 passed.
- DXF/z39 compatibility suite: 48/48 passed.
- `npm run build`: passed; Vite emitted only the existing chunk-size advisory.
- `git diff --check`: passed.
- A repository-wide run reached 1014/1015. Its only failure is the concurrently edited Task 6 generic-post test `posts mixed compensated and centreline operations with G40 boundaries and consistent traces`; Task 6 currently has uncommitted post/test/report changes and the parent confirmed this RED is not part of clean base `1a1675b` or Task 1. No Task 6 file is included in this commit. The parent will rerun the full suite after Task 6 commits.

## Scope notes

- No preparation, preview, confirmation, import persistence, geometry reinterpretation, or G20-output behavior was added.
- No storage adapter or Windows persistence was touched.
- `D:` was not accessed.

## Review follow-up

The task review passed specification and code quality with one P3 documentation finding: the status vocabulary existed only inline in `DxfUnitDeclaration`. A compile-first RED test imported the requested public `DxfUnitDeclarationStatus` alias and `npm run build` failed with TS2724 before implementation. The follow-up exports the five-value alias and constructs the discriminated declaration union through a status-constrained helper, keeping one documented source of truth.
