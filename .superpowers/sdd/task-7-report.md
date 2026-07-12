# Task 7 Report — Integrated correctness audit and release verification

Date: 2026-07-12
Branch: `codex/upid-correctness-safety`
Base: `eefc712`

## Outcome

- Audited all 21 findings from the 2026-07-08 bug-hunt ledger: 9 were already fixed before this correctness branch, 12 were fixed in this branch, and 0 remain open.
- Re-ran the entire DXF -> UPID -> edit -> validate -> post/export path and closed final review gaps around compact IJ-mode headers, legacy schema-v1 options, import-warning provenance, edit-time diagnostic retention, and stale legacy topology diagnostics.
- Kept the compensation boundary explicit: output remains G40 wire-centre geometry; reversal changes traversal and arc direction only; no G41/G42, D-register, feed, or automatic lead-in/lead-out policy was inferred.

## Final review hardening

- `a7edb17` aligned committed Playwright coverage with the compact Contour Workbook and progressive endpoint disclosure.
- `b40af20` reused the shared G-code interpreter for compact headers such as `G90.1G17` and normalized only omitted legacy layer-filter arrays.
- `8293363` persisted DXF parse warnings, retained lossy source diagnostics through geometry edits, and recalculated duplicates introduced or resolved by edits.
- `d70ac60` independently re-audits live legacy geometry before post/export. It canonicalizes derived geometry on clones, sanitizes, rebuilds endpoint clusters, derives fresh linear adjacency, and blocks every new error-level duplicate/overlap/intersection/branch/invalid/non-finite finding without trusting or mutating persisted chains/diagnostics.
- `8dfd15b` removed the final review's Minor cold-start upload race by waiting for the browser-cache workbench inputs before every E2E upload.

The final whole-branch review returned **APPROVE** with zero Critical and zero Important findings. Its one Minor browser-harness finding was fixed and then passed 10/10 parallel reproductions plus the complete Playwright suite.

## Final verification

- Full Vitest: 50 files / 757 tests passed.
- Production build: passed. Main JavaScript is 723.86 kB (196.97 kB gzip); Vite's existing over-500-kB advisory remains non-blocking.
- Playwright on owned strict port 3107: 28 passed / 1 explicitly skipped in 10.5 seconds; the app-title ownership assertion passed.
- `z18f25.dxf`: 72 exact finite segments, one closed contour, zero error diagnostics.
- Focused validator/performance/DXF gate: 3 files / 141 tests passed.
- Performance medians:
  - endpoint clustering, 1,000 -> 4,000: 11.38 ms -> 26.04 ms (2.29x);
  - oversized-bound queries, 4,000 -> 16,000: 7.15 ms -> 32.74 ms (4.58x);
  - mixed-location queries, 1,000 -> 4,000: 1.87 ms -> 5.78 ms (3.08x);
  - mixed-size sanitization, 1,000 -> 4,000: 48.91 ms -> 304.26 ms (6.22x);
  - live legacy validation, 1,000 -> 4,000: 15.92 ms -> 72.43 ms (4.55x).
- Browser visual check on the real z18 import: meaningful content, no Vite overlay or page errors, and no document overflow at 1280x720 or 1024x720.
- `git diff --check`: passed.

## Remaining non-blocking work

- The production bundle-size advisory remains and can be addressed separately with code splitting.
- Compensation-aware reversal and safe lead-in/lead-out activation/cancellation remain the next intentional design phase.
