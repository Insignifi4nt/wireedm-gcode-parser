# Datum Loft placement

Status: implemented and verified after local datum checkpoint `2d351e7`. The coordinator authorized this focused follow-on within the autonomous CAD task. Existing principal Loft behavior stays on its original construction path.

## Geometry contract

Loft accepts 2–16 ordered active sections, each with exactly one material boundary without voids. Sections on datum planes must share oriented local axes and normal. Differently tilted, rolled or reversed bases are rejected; no silent reversal or geometry relocation occurs. Basis differences within computed roundoff are charged by their section extent and translation span to the conservative `1e-7 mm` placement allowance.

The pure result retains each section's original plane, offset and local geometry. It adds placement, normal station and tangential translation in a common frame. An all-principal Loft retains its principal frame at the world origin and its existing absolute offsets and tolerance. Any datum input chooses the first placed section origin as common origin. Its station and tangential shift are zero; subsequent sections preserve authored origin translations and signed normal offsets. Station order must increase or decrease strictly beyond native and arithmetic precision. Features are never sorted.

`inspectCadLoftSketch` resolves one complete section. `inspectCadLoftSectionPair` shares basis/placement compatibility for UI defaults. `resolveCadLoftSectionPlacements` validates cached sections without repeating contour resolution. `resolveCadLoftSections` remains the authority used by document acceptance and native construction. Widening the generic section inspector must not accidentally enable datum Sweep; Sweep keeps its own explicit principal-placement gate.

## Native construction

The initial independent probe exposed placement-dependent smooth fitting: a three-section Loft built directly on a tilted plane differed from the corresponding transformed principal solid by `0.127188 mm³`, and their intersection missed additional material. Native validity and correct end bounds did not detect that change.

Datum Lofts therefore construct section wires in a canonical XY frame at the resolved tangential shifts and normal stations. Validate the completed native solid and its end-Z bounds there, then apply one owned rigid transform to the common frame and validate the placed solid. Checking a tilted solid by projecting its world axis-aligned box is invalid: the probe falsely reported 5–16 mm overshoot. Six canonical-placement probes, including the problematic three-section smooth case, descending YZ, XZ rectangles and distinct tangential datum origins, matched independent transformed solids within ordinary native numerical precision.

Retain the original native principal branch and all existing validity/positive-volume/closed-shell guards. Own temporary wires, planes, drawings, builder, transform and intermediate solids through success and failure. Failure preserves the preceding model and blocks export.

## Human and agent workflow

Reuse the existing Loft command and ordered section editor. Shared compatibility determines defaults and available sections; invalid stored selections remain visible for explicit repair. Datum metadata shows the named plane and effective station, with authored offset and tangential displacement in its tooltip. Pending fields, Apply, Cancel and Undo keep their current atomic semantics. No additional toolbar is needed.

`cad_inspect_loft` accepts only current version and ordered section IDs. The read-only facade validates the accepted document and returns a bounded eligibility receipt without original sources or geometry arrays. Successful preflight does not fit surfaces, validate a Boolean target or certify a native body. The controller checks open/busy/version/workflow/cancellation both before and after loading the facade. Public discovery and the agent guide explain common-frame station origins.

## Verification

Pure/domain checks cover frame equivalence, translated origins, signed and mixed-principal placement, separation, monotonic order, amplified precision and unchanged principal semantics. Both storage adapters retain source bytes and expressions. Native tests cover rigid-placement parity, the three-section fitting regression, descending/all-base examples, tangential translation, Join/Cut, STEP reopen, actual overshoot and forced transform cleanup. UI tests cover defaults, unavailable choices, order repair and atomic history. Production browser verification combines no-WASM preflight, visible creation/cancel, parameter rebuild, exact volume, current PNG and STEP export. Root separately reviews bounded receipts and asynchronous guards.

The final CAD gate passes 78 files / 959 tests; all 33 production CAD/kernel workflows pass. Production TypeScript/build, public documentation/schema parity and pinned source distributions pass. Native Codex WebMCP separately inspected sections on two translated, tilted datum planes, followed by visible Loft Apply, exact build, current PNG capture and browser-cache save. Numerical review reproduced and fixed omission of the second frame's angular allowance in an equivalent-orientation case; both section orders now reject the excessive uncertainty. Native transform setup and failure paths release all explicitly owned temporary objects deterministically.
