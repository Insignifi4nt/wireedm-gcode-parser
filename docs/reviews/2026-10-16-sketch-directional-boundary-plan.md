# Direction-preserving line boundary edits

2026-10-16, based on local `97765b7`. This bounded implementation follows the [remaining-workflow audit](2026-10-16-sketch-remaining-workflow-audit.md): a fresh four-H/V rectangle should not require discarding its direction intent before an end Trim or line Extend.

## Deliberate authored-operation policy

For a **surviving line**, preserve Parallel and Perpendicular records exactly. Preserve every nonmatching H/V record exactly, including an adjacent rectangle side's relation to the retained old corner. For H/V whose exact unordered operand pair is the line's original endpoint pair, replace only the detached endpoint operand with the new endpoint ID. Retain the relation ID, kind, tuple order and array position. Source line ordering and relation operand ordering are independent.

Reject that transfer if another line or arc uses the same original endpoint pair, in either order. An endpoint-pair H/V relation cannot identify which of those edges it meant. This is an exact source-ID check; it does not infer ownership from coordinates or coincidence classes. Explicit reuse of a witnessed boundary endpoint follows the same operand substitution as a fresh numeric endpoint.

The exception does not apply to no-hit whole-edge deletion or arc Trim. Distance, fixed-axis, fixed-point, coincidence, equal-length, line-angle, radial/equal-radius and corner ownership remain conservative blockers when affected. String coordinates on the detached endpoint still block, including numeric text. No dimensions, attachments, source drivers or relations are dropped automatically. Other old points, exact scalar strings, cutter data and unrelated source records remain unchanged.

This transfer is **our explicit edit semantics**. [Onshape](https://cad.onshape.com/help/Content/Sketch/trim.htm) documents first-intersection trimming and whole-curve deletion without a boundary; [Fusion](https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/SKT-TRIM-EXTEND.htm) documents preview/next-intersection behavior; its [trim API](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_SketchCurve_trim.htm) retains the original entity for an end trim and makes constraint creation optional. Those pages do not specify this app's exact H/V operand-transfer policy or establish vendor parity.

## Small implementation seams

Only [cadSketchTrimExtend.ts](../../src/domain/cad/cadSketchTrimExtend.ts) changes in production. `assertDependencies` receives a source-line allowance only when a line survives. Its narrow direction predicate permits Parallel/Perpendicular, preserves nonmatching H/V, and rejects ambiguous original endpoint-pair H/V ownership. Existing arc/deletion callers receive no allowance and keep their strict behavior.

The shared `replaceEndpoint` constructor explicitly maps matching H/V operands using the original line's endpoints and the chosen replaced end. It does not remap adjacent relations, reverse tuples, allocate relation IDs or introduce a generic transfer framework. All existing public schemas, target/result types and query signatures remain unchanged.

Queries and constructors still recheck the exact numeric intersection witness, selected endpoint range, nondegenerate source support, entity namespace and strict parsed geometry. Existing preparation still flushes earlier solves and requires the complete native result to equal the constructed candidate. Permitting a directional relation at source construction is not permission for the solver to move another point or relax acceptance. There are no new native equations, tolerance changes, migrations, contact inferences or arrangement cells.

## Three meaningful test groups

1. **Authored direction:** genuine fresh rectangle H/V, reverse the edited line, reverse the matching relation pair, and reuse an exact expression-driven cutter endpoint. Only the matching horizontal operand changes; the other three rectangle direction records and every old point remain exact. A separate vertical Extend case preserves Parallel/Perpendicular and an adjacent old-corner horizontal pair unchanged.
2. **Scope and ownership:** an original pair shared by another line or arc rejects; whole-edge deletion and arc Trim remain strict. Fixed point/axis, explicit coincidence, angle and fillet ownership still reject. Existing distance, equal-length and detached-string regressions remain, with their actual blocker IDs preserved.
3. **Shared real acceptance:** the separate preparation owner captured two native RED dependency failures before implementation. After the change, both real pinned-WASM cases pass complete-candidate equality: fresh rectangle end Trim changes only its matching H operand; line Extend preserves Parallel/Perpendicular, reuses the driven boundary endpoint, and closes a 100 mm² contour with 40 mm perimeter. No solver adjustment was required.

Two old domain expectations intentionally change: a failed batch containing a distance driver and an allowed H/V relation now reports only the distance relation as a blocker. This verifies truthful structured ownership, rather than hiding the distance error or retaining a stale blocker list. Source immutability and the actual rejected batch remain covered.

Evidence: three new domain RED failures in `tmp/sketch-directional-boundary-domain-red.log`; two native REDs in `tmp/sketch-directional-boundary-native-red.log`. The separate native owner reports 2/2 exact accepted cases in `tmp/sketch-directional-boundary-native-green.log`. The final focused regression set passes 56/56 across eight domain/intersection/preparation files in `tmp/sketch-directional-boundary-domain-final.log`; scoped TypeScript for the three owned source/test paths passes in `tmp/sketch-directional-boundary-domain-types.log`. Owned diff checks are clean. No production build or browser run is performed by this owner.
