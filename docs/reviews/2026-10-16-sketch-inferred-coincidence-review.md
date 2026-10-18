# Inferred creation coincidence review

Independent review after `54fed37`, 2026-10-16, against the [inference plan](2026-10-16-sketch-inferred-coincidence-plan.md). Scope: authored constructor/roles, Canvas consent and pending picks, Workbench append integration, native preparation and source/cancellation ownership. Unwired arrangement is excluded.

One concrete ownership issue was reproduced and repaired with root approval. Pending attachments retained their point IDs and coordinates but did not pin their accepted source. A same-ID/same-coordinate sketch replacement, version change or parameter snapshot replacement could silently reuse an earlier pick against that replacement. All three event regressions failed before the fix.

A gesture-local pin now captures accepted sketch/document/version/parameters when the first coincident pick enters the pending drawing. Subsequent placement and final submission reject a changed owner while retaining the user's attempt. Releasing all pending links also releases the pin; numeric-only picks acquire no unnecessary owner. No assertion runs against the source transition of the drawing's own pending append. A separate deferred-success regression verifies that accepted-source rendering before promise completion does not misreport success as stale or retain pending attachments.

No open finding remains in this bounded review:

- Rectangle construction retains original picked axes and maps first/opposite roles correctly in all four directions, including cancellation-prone arithmetic. Fresh point identities stay distinct from source IDs. Polygon input order and typed roles remain exact; a circle can attach only its center.
- The constructor validates both exact evaluated source coordinates, checks the combined namespace/graph and returns only new append records. Source strings, IDs and existing relation tuples are preserved. The legacy normalized helper shares small allocators without adding a general authoring framework.
- Inference defaults off and affects future picks. Switching off releases pending intents, while Ctrl/Cmd suppresses only the current pick. Midpoints and radius picks remain numeric positions; Path keeps its separate shared-ID behavior. Owned polygon closure never borrows an ambiguous saved identity or invents another vertex.
- One existing append carries fresh geometry and removable coincidence together. Existing shared preparation, version/workflow guards, cancellation and local/global history remain authoritative. Native propagation, explicit detach and incompatible-batch rejection use those same operations; no extra solver, edit kind, persisted schema or tool was introduced.

Verification: **40 focused cases passed** across constructor roles/validation, creation events, actual Workbench deferred append/Cancel and real native propagation/detach/rejection. App `tsc --noEmit` and the scoped whitespace check passed. Logs: ignored `tmp/cad-inferred-review-red.log`, `tmp/cad-inferred-review-green.log` and `tmp/cad-inferred-review-focused.log`. The domain owner also reports 38/38 new/existing constructor cases and scoped diagnostics; no production changes followed its freeze. Build/browser acceptance remains with root. No build, commit or remote action was run by this reviewer.

## Root acceptance

The native visual pass found an additional interaction gap: orphan reference points disappeared on entering a drawing tool, despite remaining snap targets. The existing point renderer now keeps them visible as read-only references; pointer and keyboard events cannot select or move them while drawing. Its red-first regression and all 27 layer cases pass. The final production build includes this fix.

Full TypeScript/build, documentation/source distributions, shared UI checks and icon integration pass. All 21 production sketch/region journeys pass in Chromium and Firefox. Three drawing journeys were rerun against the final read-only-reference build and pass. The actual in-app browser verifies pending attachment feedback, both reference targets, exact distinct identities/source expressions, driver propagation, 180 mm² material and one 900 mm³ Pad without diagnostics. Four Undo operations restore the original empty disposable draft; no saved user project was created.

One integrated test file initially failed to import the icons package while a concurrent prebuild refreshed its generated distribution. The other seven files passed 208 cases. The affected Canvas file passed all 39 cases after the build. This was a verification orchestration mistake; build and test execution must remain sequential. Logs are under ignored `tmp/sketch-inference-*`; screenshots are `tmp/sketch-inferred-attachment.png` and `tmp/sketch-inferred-solid.png`.

This bounded attachment slice is accepted. Associative midpoint, exact topology tools and the full sketch audit remain outstanding; no claim of overall completion follows. All changes remain local.
