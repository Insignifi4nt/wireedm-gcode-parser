# UPID correctness compatibility record, 2026-09-21

This is an **unreleased branch record** for `feat/upid-simulation-workbench`, to carry into the reviewed PR and its eventual app release record. It does not advance the app release, UPID schema, post schema, execution-plan schema or engine API. Historical release JSON records remain unchanged.

## Confirmed corrections

- Semantic validation previously accepted unrelated contour and path-element bounds even when the source-segment bounds were accurate. Those derived containers now have to match the union of their owned source bounds, including circular extrema. Invalid values produce `upid-identity-mismatch`; floating-point noise remains accepted. Validation does not mutate the document.
- A stored segment whose opaque ID matched a generated partial-cut segment ID could be replaced in the execution geometry map. The regression uses two disjoint lines: clipping the first to X=0..5 previously also changed the second's emitted X=20..30 motion to X=0..5. Temporary IDs now reserve all stored segment IDs before allocation. Existing IDs are retained where unique, and collision suffixes are deterministic.
- Distinct exclusion ranges closer than nine decimal places could receive identical formatted IDs, leaving the app's own edited document structurally invalid. Newly allocated span IDs are unique without rounding the actual ranges. Authored existing IDs are retained, and repeating an unchanged participation edit no longer removes the partial lead reviews.

## Compatibility checklist

| Area | Impact |
| --- | --- |
| Schemas | No added/removed fields or version changes. Contour/path-element bounds with stale or invented values are newly rejected; they already contradicted the documented source-consistency invariant. Source/span IDs stay opaque; no new reserved prefix is imposed. |
| Execution events | Ordinary noncolliding documents retain the same derived IDs, event vocabulary, geometry and exact source ranges. Formerly colliding inputs now produce the correct source geometry and, where needed, different temporary operation references. |
| Post capabilities | No capability declaration or preflight requirement changes. No new post callback or controller event is introduced. |
| Audit and output | **Potentially breaking for affected historical plans:** correcting a geometry/identity collision changes the execution plan and potentially controller output. Existing saved-plan comparisons remain strict and can block a previously accepted bad snapshot. Do not relax an audit or update a post to reproduce corrupted geometry. |
| Installation and storage | No installation, migration or persistence code changes. Installed package hashes, saved revision bytes, source input and catalog schemas remain unchanged. No automatic repair/rewrite is performed. An affected project must be corrected/reviewed and saved as a new revision. |
| Diagnostics and repair | Derived-bounds diagnostics identify source disagreement and preserve the original. `SAVED_REVISION_EXECUTION_PLAN_MISMATCH` now explains that saved revisions/packages remain unchanged and directs users to review/save a new revision. Public v1/v2 authoring guidance describes these limits and the separation of simulation assumptions from UPID intent. |

## Verification

- Regression-first evidence: four derived-bounds cases failed before the validation change; the identity suite reproduced the wrong second motion, duplicate exclusion IDs, and discarded review on an unchanged edit before their fixes.
- 313 tests passed across 15 focused files after the behavioral changes: all UPID tests, machining participation/identity, execution plans, saved revisions, Robofil package/golden output and simulation.
- The final diagnostic change passed the same 313-test selection. All three published portable UPID fixtures passed executable conformance; application TypeScript and whitespace checks passed.
- Existing positive portable v1/v2, legacy engine snapshot and post-fixture coverage remains in those suites. Integration still requires the parent branch's complete build, documentation and broader workflow checks.

No merge, deployment or physical machine verification is represented by these results.
