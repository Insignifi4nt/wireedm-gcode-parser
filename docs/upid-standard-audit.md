# UPID standard audit, 2026-09-08

Scope: the current UPID v1 model, portable JSON, validation, geometry editing, source tracing and neutral execution compiler. Baseline: `ae4e714`. This review followed the broader CAM feature audit and deliberately probed malformed and boundary inputs beyond ordinary workflow tests.

## Confirmed defects fixed

| Priority | Defect and effect | Correction and evidence |
| --- | --- | --- |
| High | Full-turn ARC records could compile successfully with no cutting motion. | Preserve exact full-turn semantics; clockwise/counterclockwise and remaining-distance-stop regressions. |
| High | Tiny but accepted line/arc cuts disappeared under a hardcoded epsilon. Tiny arc stops also rounded their sweep to zero. | Preserve distinct coordinates and positive tiny angles; numeric-boundary compiler tests. |
| High | Rebuilding topology reused positional contour IDs and could transfer authored decisions to an unrelated chain or duplicate segment ownership. | Match source topology, preserve unaffected identities, allocate new identities, refuse ambiguous authored split/join edits transactionally. |
| High | Mirroring a circle left excluded source intervals on the wrong physical side. | Reflect circular ranges while preserving source/span IDs; mirror and double-mirror regressions. |
| High | Stale inferred starts could bend a changed source edge toward an old picked point. | Revalidate the inferred point against the current source before applying a split. |
| High | Malformed referenced geometry, null references and missing path-element metrics could throw instead of returning validation diagnostics. | Guard malformed graph entries; public-parser and semantic regression tests. |
| High | Repeated unit metadata could consistently claim that DXF millimeters meant inches. | Validate the authoritative unit-code/scale relationship, preserving separate user-confirmed reinterpretation. |
| High | Finite but forged segment-length caches could place remaining-distance stops at the wrong physical point. | Recompute expected line/arc/circle length and reject disagreement beyond floating-point noise. |
| Medium | Finite but forged segment bounds could misdirect fit and picking. | Require line/arc/circle bounds to match source geometry; inaccurate caches fail before editing. |
| High | Persisted temporary machining operations could forge source attribution or bypass intended partial-cut semantics. | Reject derived `machiningIntent` in source documents; derive only from source geometry and participation. |
| Medium | Partial-cut traces used temporary operation/segment IDs and reset source ranges to 0..1. | Trace saved UPID IDs and actual source intervals through reversed cuts and stops. |
| Medium | Switching to wire-center geometry left saved controller choices active in export, incorrectly blocking output. | Keep those choices dormant until finished-contour geometry is selected again. |
| Medium | Metadata and display labels accepted arbitrary objects; supplied optional containers could have invalid types. | Strict primitive/container checking before import writes; preserve genuinely nullable fields. |
| Medium | A same-ID plan diagnostic could disagree with its source diagnostic. Manual override tags/order could contradict operation state. | Validate payload agreement independently of JSON key order and enforce override agreement. |
| Medium | Deep or cyclic diagnostic details overflowed the validation stack. | Bound nesting and detect cycles; malformed inputs return diagnostics. |
| Medium | Oversized input consumed file-reading/parsing/validation work before a size check. A formatted export could exceed the import limit. | Check file size before browser byte reads and the 64 MiB UTF-8 limit before parsing; compact export fallback keeps large saved documents reimportable. |
| Medium | New topology identities caused selection to disappear during consecutive segment transforms. Refused edits gave no explanation. | Follow the stable source segment to its new owner; show a warning and retain entered coordinates on refusal. |

## Performance

The compiler rebuilt a complete segment index for every operation even when there were no distance stops, and cloned the same document and operation data repeatedly. It now shares the existing index with stop resolution and retains the isolated derivation without redundant document clones.

On this workstation, a deterministic fixture of disjoint, valid wire-center lines with explicit threading measured:

| Operations | Before, median | After, median |
| --- | --- | --- |
| 1,000 | 106.8 ms | 35.4 ms |
| 4,000 | 883.2 ms | 98.8 ms |

These are local warm-run medians, not a general hardware guarantee. The same source produced complete, immutable execution plans; source input remained editable and unchanged.

Run `npm run upid:benchmark` on an otherwise idle machine to reproduce the fixture and measurements. It builds source geometry before timing, validates every compiled result, and reports the median of three runs after warm-up.

## Added support and format guidance

- Public `parsePortableUpid(text)` validates without opening storage or binding a machine.
- `npm run upid:validate -- <file> [--require-executable]` reports structural validity separately from execution readiness. It supports several files, strict UTF-8 decoding and process exit codes for scripts.
- Three complete v1 reference files cover mixed primitives/threading, partial-circle retention stops, and compensated circle entry. `npm run upid:conformance` checks all three through the real portable parser and neutral compiler.
- [UPID v1 contract](upid/v1/README.md) documents units, identities, ownership, review state, supported machining intent and versioning. It explicitly freezes the current vocabulary instead of implying that new optional fields are invisible to strict older readers.

## Must-have versus later support

The fixed issues above are correctness and data-integrity requirements for the existing planar single-cut product. They did not require a new UPID version.

For a broader production CAM product, rough/skim passes and multiple independently planned active groups are the next substantial additions. Taper/UV, stock/fixture clearance, native advanced curves and associative constraints require explicit new semantics and tests. They are future scope, not implemented features. Publishing a JSON Schema and portable negative conformance fixtures would also make third-party producers easier to build; the reference parser, CLI and complete positive examples provide executable validation today.

## Verification

Verification completed:

- Full Vitest suite: 1,287 tests across 127 files passed after the geometry-cache changes. The final browser-file-size guard then passed 17 focused controller/CLI tests, including its new regression; TypeScript passed again.
- Production browser suite: 77 passed, one optional external-fixture case skipped. Five UPID round-trip, transform and machine-export browser scenarios also passed against the final geometry-cache validation.
- Production build and post-authoring documentation checks passed.
- All three complete UPID reference documents passed `upid:conformance` through the real parser and execution compiler.
- One wall-clock spatial-performance assertion failed while other work was running. The subsequent complete suite with four workers passed without changing its thresholds or candidate-count assertions.

All source changes are committed on the working branch; no merge or deployment was performed. Larger versioned capabilities listed above remain future work and are not included in this checkpoint.
