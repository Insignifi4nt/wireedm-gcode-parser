# CAD cache, source selection and unload review

Review date: 2026-10-14. Fixed repository baseline: `c16a15eb9f9805622ccaeda5b39dc2698ddfda8c`. This addendum covers the latest contour-label cache exclusion, shared Pad/Pocket/Revolve sketch eligibility, and application integration of the unload guard. It does not repeat the earlier complete hardening reviews or certify browser layout.

## Confirmed findings and repairs

### P2: a competing stale unload listener survived clean state transitions

App installed the new session-aware unload guard while `useCadController` still installed its older listener whenever a rendered snapshot was dirty. That older listener prevented unloading unconditionally until a React effect removed it. The new hook could therefore remove its own listener synchronously while the competing listener continued to block unloading.

The new real-controller integration reproduction failed immediately after Undo restored the saved document, and after replacement with an empty document. Both assertions dispatched `beforeunload` before React effects could rerender. The saved/empty state was already correct in `CadSession`; the competing listener was the problem. Durable Save and clean pending-workflow coverage passed before repair, so those are supporting checks rather than claimed failing reproductions.

`useCadController` now owns `useCadUnloadGuard(session)` and its old effect is removed. App no longer installs a second guard. This keeps every controller host protected, including retained CAD state after returning to CAM. The existing hook still subscribes synchronously, reads actual session state at the event, protects clean pending workflows and ignores an empty default draft.

The integration suite uses real browser-cache persistence. It verifies a durable Save receipt against the loaded document; immediate Save/Undo release; immediate pending-workflow protection and Cancel release; empty-document replacement; retained unsaved CAD protection after Back; and unmount cleanup. It does not substitute a controller mock for these operations.

### P2: rejected section/export queries could replace accepted topology ownership

The runtime previously assigned the incoming full-document key before parsing/computing a section. On a metadata-only renamed document, a malformed or outside-body section returned an error while making the preceding accepted document's topology stale. A geometry-changing query additionally rebuilt and disposed the accepted model before the query could reject.

Four real OpenCascade cases were written first and all failed: malformed and outside-body sections, each against a metadata-only document and a resized document. Prior accepted inspection returned `STALE_BUILD` after the rejected query. Malformed sections also reached initialization before input validation.

Section input now parses before initialization/build. Read-only section/export requests reuse the current native model when its geometry key matches, or hold a newly built model temporarily. A successful reply commits its full key/model and releases the prior model. A failed query leaves the prior cache intact and disposes only its newly created candidate. Inspection guards and ordinary Build behavior remain unchanged; an explicit Build can still adopt a diagnosed prefix for display.

The four repaired cases verify retained exact topology descriptors and picks, unchanged build result identity, 1,000 mm³ STEP material, untouched caller documents and a later successful query accepting the new snapshot. A further regression uses a valid non-intersecting Distance Cut: exporting the diagnosed candidate rejects, the accepted snapshot survives, and STL reimport still contains 1,000 mm³. Explicit Build then adopts the new diagnosed prefix with a new build ID. The native owner independently reviewed this transaction boundary and found no actionable ownership issue.

## Cache and source-selection conclusions

Contour-label and dimension-intent exclusions preserve geometry reuse without relaxing full-document topology ownership. Actual feature names remain in the geometry key because meshes and STEP labels use them. Current incoming geometry/profile labels are validated before reuse; invalid renamed dimensions report the current name and preserve the preceding accepted cache. Existing native cases verify metadata-only reuse, current-key pick resolution, stale prior-key rejection, exact sections, STEP/STL retention, real dimension rebuilds and disposal invalidation.

The shared source helper preserves explicit sketch intent. Selecting an empty, construction-only or suppressed sketch cannot silently substitute the latest eligible sketch. Defaults are available when no sketch is explicitly selected. Distance Pad and Revolve support eligible datum-plane sketches; Through-all Pocket requires a principal-plane sketch. The shared source field filters to eligible preceding sketches and retains an unavailable stored source as a disabled selected option, instead of letting the native select appear to choose another source. The owned model picker and field use the same eligibility.

No further confirmed cache/source defect remains in this scope. Controller checks continue to pin asynchronous operations to current document versions, and replacement/storage-switch guards preserve pending or meaningful unsaved state.

## Verification and remaining measurement

- Source selection, Extrude fields, Revolve sources, unload integration, unload hook and real controller: **116 tests in 6 files passed**, 4.59 seconds.
- Real-native runtime after the query repair: **12 tests passed**, 3.34 seconds. The section ownership subset had **4 failures before repair**.
- `npx tsc -b --pretty false`: passed after the integration test narrowed the catalog connection result before capturing its workbench.
- `git diff --check` for App/controller/runtime: passed; Git reported the repository's existing CRLF-to-LF notice for App.

Unused parameters still participate in the native geometry key. This is a performance candidate to measure, not an asserted correctness defect. A section offset may reference any current named parameter even when solid geometry does not. Excluding such parameters safely would first require separating the current query expression environment from the immutable native material snapshot. No speculative key optimization was made here.

Geometry-changing read-only queries temporarily hold a candidate alongside the accepted model until their result succeeds or fails. This preserves accepted selection/material ownership and bounds the extra lifetime to that synchronous query; ordinary Build retains its existing replacement behavior. Native memory and broad application/browser verification remain part of the parent task's final checks.

Reviewed source SHA-256 identifiers at handoff:

| File | SHA-256 |
| --- | --- |
| `src/features/cad/kernel/cadKernelRuntime.ts` | `EEBF097EFEDEAF709D4EB5A1B7FD81CC2E6B22B35C77C9D9AE9F5A6FFD9E74A9` |
| `src/features/cad/useCadController.ts` | `7AF05EA0D25F48A855BC172B6EAC7C0F6DF3C1A9C86BEBA2B0FDEBC1F590E5FE` |
| `src/features/cad/useCadUnloadGuard.ts` | `B54BEC8F59DF5A5892F9CBDF80568E81FA068AFBD6BF697BAC89A0E566BDAD96` |
| `src/App.tsx` | `3F4E825D691ADA9AC23EE7751B4C0C692DA4EE00354BB4BF391DD26B8D97EC40` |
| `src/domain/cad/cadSketchSources.ts` | `59770FF3D174B00DDBA690EA5A7E1DE6D934A8E343AA5F1D2698ACDC8D86279E` |
| `src/features/cad/CadSketchSourceField.tsx` | `5C6BA867932B243502C2015F8E6A01B2A781E41033844D1AC0B611D783995BF5` |

This review did not start a server, control a browser, commit/push changes or mark the overall CAD goal complete.
