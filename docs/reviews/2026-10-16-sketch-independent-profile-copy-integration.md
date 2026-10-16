# Independent profile copy: bounded native feasibility

2026-10-16, after local Mirror checkpoint `e364a05`. Read the complete [plan and independent design appendix](2026-10-16-sketch-independent-profile-copy-plan.md), then executed only the two authorized known-candidate preflights. No production source, tests, schema, native mapping, solver setting or tolerance was changed. No build, browser, package command or remote action ran.

Evidence: ignored `tmp/sketch-independent-profile-copy-native-preflight.{mts,json,log}`. Node 24 execution exited 0; JSON contains both full original and known candidate documents plus actual diagnostics. There is no native/test process left running.

## Result: go for the two known candidates

| Candidate | Actual native preparation | Geometry and source evidence |
| --- | --- | --- |
| Legacy Slot: center `[11,-7]`, length 30, width 10, angle 30°, source plane XZ and offset expression `' sourceOffset '` = 2.5 | Success, **10 DOF**; complete prepared document equals the exact constructed candidate; empty conflict/redundancy/partial-redundancy/independent-issue arrays | Four shared boundary points, two separate cap centers, two lines and two CCW arcs; no relations. Original scalar strings, source sketch, parameters and parameter metadata remain exact. New offset is numeric 2.5, with identical resolved placement. Area **278.53981633974485 mm²**, perimeter **71.41592653589794 mm**, unchanged from the source. |
| Accepted mixed DXF: one inch R1 CCW 270° arc and its closing line, imported normally into millimetres | Success, **5 DOF**; complete prepared document equals the exact constructed candidate; all diagnostic arrays empty | R25.4 and signed sweep **4.71238898038469 rad** remain exact. Two shared boundary points plus one center and no relations produce one simple cycle. Area **1842.702437292493 mm²**, perimeter **155.61570458604774 mm**, identical to the accepted path. The original BOM, CRLF, Unicode comment/name, source text and imported profile are exact. The copy reads the accepted R25.4 support; it does not apply the inch factor again. |

Each candidate uses its validated ordered outgoing starts as the new shared joints. It neither averages endpoints nor searches for nearby geometry. The maximum incoming/outgoing mismatch was **3.553e-15 mm** for the Slot and **4.666e-15 mm** for the DXF, below the existing **1e-12 mm** arithmetic closure floor. Existing graph checking, compilation, saved-path encoding and simple-cycle detection pass with no open, branched or arrangement entities.

The Slot's authored half-turn caps reconstruct as π ± **1.7763568394002505e-15 rad**, with maximum physical deflection **8.881784197001252e-15 mm**. The preflight treats only these known Slot caps as authored half-turns, as specified by the plan and existing Offset semantics. It does not reclassify a generic path near π. Both actual arc endpoint radii and source/result radii remain within the unchanged arithmetic support allowance. The generic DXF major branch is preserved exactly, including direction. Bounds differences are below that same allowance.

The check uses the existing real pinned runtime through ordinary `prepareCadEdits` with the known new graph feature, then compares the **entire** resulting document against the expected source-plus-copy document. Native Success is not accepted as evidence without that equality. The old source remains exact and the copied feature has no import/plugin provenance, legacy profiles or source expression links.

## Gate and limits

This establishes a bounded **go** for implementing the reviewed constructor and existing edit path. It does not establish arbitrary curve joints, plugin outputs, shared-datum behavior, frame/source ownership, human handoff, cancellation, storage or native solids. No extra fixtures, angle/scale sweep, coordinate repair or native tuning was attempted.

Keep the independent appendix's integration gates: explicit prepared-edit detection for a legacy-only source, document-owned feature identity/ordering and placement checks, and retirement of the copy workflow before opening the accepted new sketch. Exact source preservation and a complete candidate certificate remain required. A shared datum is still an explicit placement dependency; this principal-plane preflight makes no frozen-world claim.

## Author-run adapter implementation after go

Following the accepted preflight, `copy-sketch-profile` now reuses the existing strict edit catalog/reducer and exact-operation preparation branch. The reducer rejects a document-wide destination feature collision, resolves the actual source feature, and appends the shared constructor's new feature. Ordinary whole-document parsing enforces datum ordering and introduces schema 2 through this explicit edit. `needsCadSketchPreparation` explicitly recognizes Copy even when the source document has only schema-1 legacy profiles. Preparation flushes earlier intent, constructs the copy, solves normally and rejects any complete-candidate change with `sketch-profile-copy-intent`.

The public operation is discovered through the existing edit catalog; no registered tool, region-proposal arm or controller service was added. Private sketch drafts continue to reject this document-level command before calling preparation. Storage production is unchanged.

Five actual preparation cases first failed at the absent strict edit boundary (`tmp/sketch-profile-copy-preparation-red.log`). The first implementation gate is **114/114** in the existing tool, private-draft and both-adapter storage suites plus the new native preparation suite (`tmp/sketch-profile-copy-adapters-first-green.log`). The tool-discovery test's initial controller fixture was corrected to the existing read-discovery convention; that harness failure is not claimed as product RED evidence.

The real pinned runtime accepts the constructor's exact Slot and imported-major-arc candidates with the measured 10/5 DOF and clean diagnostic arrays. A preceding Slot length change is evaluated before copying; a source on an existing rotated datum retains that exact datum reference and numeric offset, while its explicit original Pad remains unchanged. Reordering the destination before its required datum is refused. A valid native-projected translation of the whole copied graph is nevertheless rejected by the complete-candidate check, and actual post-solve cancellation leaves the accepted session unchanged.

The existing browser-cache/folder table covers schema-1 save → explicit copy → schema-2 save/reopen, verifies the complete original save at its hashed originals path, then changes only the source length/offset. The source's exact expression text and parameter provenance remain saved; copied geometry and numeric offset remain independent. This does not add migration behavior or duplicate the existing transaction-interruption tests.

Scoped TypeScript checking of nine owned source/test paths and their transitive imports exits 0 (`tmp/sketch-profile-copy-adapters-types.log`, config `tmp/tsconfig-sketch-profile-copy-adapters.json`). The final frozen-domain gate again passes **114/114** in four focused suites (`tmp/sketch-profile-copy-adapters-final.log`), and the scoped type check rerun exits 0. Source/tests are frozen with no process active. These are author-run adapter checks; independent review and actual parent/native-solid/browser handoff remain separate gates.
