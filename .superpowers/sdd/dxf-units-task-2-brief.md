# DXF Units Task 2 Brief

Date: 2026-07-13
Base commit: `df72244`

## Outcome

Add a pure DXF import-preparation and live-preview layer. It parses once, exposes stable source-unit candidates for the selected machine profile, computes scaled supported-geometry bounds in millimeters without mutating raw entities, and evaluates those bounds against the selected machine work area. It performs no adapter activity or persistence.

## Binding behavior

- `prepareDxfProjectImport(workbench, { fileName, text, now? })` is synchronous and pure with respect to the workbench adapter: no reads, writes, deletes, or directory creation.
- Preparation retains the raw text, parse result, supported entity/warning counts, normalized profile snapshots, active profile ID, and active-profile default candidate selection needed by later tasks.
- Preparation rejects a file whose parsed entities produce no valid supported path segments.
- Unit candidates are recomputed for a requested selected-machine ID and deduplicated by exact scale with this priority:
  1. recognized DXF declaration;
  2. selected machine profile suggestion;
  3. millimeter fallback.
- Candidate IDs are stable semantic IDs: `millimeters`, `inches`, or `dxf-insunits-<code>` for other declared finite-positive units.
- Candidate source is explicit: `dxf-declared`, `machine-suggestion`, or `fallback`.
- A declared candidate wins deduplication over an equal machine suggestion/fallback; a machine suggestion wins over the equal fallback.
- Unitless, missing, malformed, or unknown declarations do not produce a declared candidate.
- Machine suggestions are only millimeters/inches and never silently become an applied decision; preparation only preselects the first visible candidate for later explicit confirmation.
- `previewDxfProjectImport(preparation, { machineProfileId, unitCandidateId })` rejects missing/deleted profile IDs and candidate IDs that are invalid for that selected machine.
- Preview clones and scales parsed supported entities through the existing normalization path, then derives exact segment bounds from supported geometry. It never trusts DXF header extents for part size and never mutates the parse result.
- Preview rejects non-finite scaled geometry and any candidate that yields no valid supported segments.
- Preview returns millimeter min/max bounds, width/length, selected profile/candidate, current selected-machine candidates, and machine fit.
- Add `evaluateMachineFitBounds` as a pure bounds entry point. Preserve `evaluateMachineFit` as the document adapter over the same calculation.
- No Task 1 field changes, no applied-unit persistence, no commit API, no dialog, and no Task 6 post files.

## TDD and verification

1. Write failing preparation/candidate/preview/machine-fit tests and observe the focused RED run.
2. Implement only the new pure modules and the bounds-based machine-fit refactor.
3. Run focused Task 2 tests, Task 1/DXF compatibility tests, production build, and `git diff --check`.
4. Stage only Task 2 files plus this brief/report and commit `feat: prepare DXF imports for review`.

## Files

- Create `src/domain/dxf/dxfImportUnits.ts`
- Create `src/domain/dxf/prepareDxfProjectImport.ts`
- Create `src/domain/dxf/__tests__/prepareDxfProjectImport.test.ts`
- Modify `src/domain/machine/machineFit.ts`
- Modify `src/domain/machine/__tests__/machineFit.test.ts`
- Add this brief/report only

## Exclusions

- No storage or project writes.
- No UPID construction or persistence.
- No import controller/UI flow.
- No geometry reinterpretation.
- No Windows persistence edits and no `D:` access.
