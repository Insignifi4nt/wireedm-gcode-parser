# Retained arc radius acceptance

Accepted local slice above `f6a7cb9`, following the [reviewed plan](2026-10-16-sketch-arc-radius-owner-plan.md). The complete sketch goal remains active. No push, PR, merge, deployment, release bump, storage migration, native mapping or tolerance change.

## User behavior and scope

End Trim, middle Trim and Extend can retain an existing radius/diameter dimension or Equal radius relation when the referenced arc survives on its certified original circle. Existing relation IDs, scalar text, quantity and operand order remain unchanged. Middle Trim keeps the original owners on the old-ID child and adds only its existing ordinary sibling equality. Explicit point/string drivers, topology/corner owners, unrelated peer owners, whole deletion and circle conversion keep their previous policies.

The runtime change is one private retained-arc predicate in the existing dependency checks. It excludes the same eligible relation from both entity ownership and expanded endpoint ownership. It does not change the shared reference visitors or introduce a separate edit, UI state, service or solver binding. The existing branch/support certificates, exact constructor requery and complete native-candidate equality still apply.

The interaction remains consistent with the documented preview-and-intersection workflows in [Onshape Trim](https://cad.onshape.com/help/Content/Sketch/trim.htm) and [Fusion Trim/Extend](https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/SKT-TRIM-EXTEND.htm). Retained radius ownership is this app's explicit design policy; these references do not establish equivalent constraint-transfer rules in those products.

## Evidence so far

The upgraded existing D-plate browser journey fails on the disabled Trim command before implementation. Original radius/equality source, exact native Pad and actual private editor entry pass before that failure (`tmp/sketch-arc-radius-owner-journey-red.log`). This extends a meaningful complete-part test instead of adding another duplicate journey.

Pinned-native preflight proves an exact start-side diameter candidate with 3 freedoms versus 4 without the owner. The middle candidate retains the original radius and peer equality plus the ordinary sibling equality, with 4 freedoms versus 5 without that sibling. Both complete candidates remain exact with no diagnostic issue IDs. A later ordinary `stockRadius:10→12` edit legitimately redistributes the free numeric endpoint angles while both arc radii and the construction-circle radius become 12. Source strings, relation operands and IDs remain exact. A separate contradictory fixed-point/radius batch rejects with real IDs `stock-radius` and `fixed-radius-10`, retaining the exact session and radius 10. Evidence: ignored `tmp/sketch-arc-radius-owner-preflight.{mts,log,json}` and its fixture JSON. This is preflight, not production browser acceptance.

## Root acceptance

Seven focused pure suites pass 58 cases, including four new meaningful retained-owner groups and corrected obsolete blocker expectations. Two existing native preparation suites pass 13 cases. Scoped types pass for both owner groups. Full production build/TypeScript and public documentation/source distributions pass (`tmp/sketch-arc-radius-owner-{domain-final,integration-tests,build}.log`). Existing nonblocking bundler dynamic-import notices remain. Shared controls/icons have no source changes; prebuild rebuilds the icon package, and their unchanged broader audits were not repeated.

The upgraded existing complete D-plate journey passes in Chromium and Firefox, covering human preview/Cancel, explicit consumed-area repair, exact human/agent source and selector parity, legitimate R12 resizing, native section, Undo/Redo and save/reopen. The arc Extend and circle Trim journeys also pass in Firefox as related policy regressions. Logs: `tmp/sketch-arc-radius-owner-{chromium-first,firefox}.log`. No additional duplicate full journey was added.

In actual in-app browser tab 16, the original 5 mm D plate has volume 1347.148717794091 mm³. The human Trim retains every original point/string and radius/equality record, adds only its normal sibling equality and deliberately repairs the material selector, giving 1265.3981633974481 mm³. Editing the existing `stockRadius` through the human parameter editor to 12 rebuilds one solid of 1773.456452662415 mm³ with no diagnostics. The existing Pad and all relation records stay exact. The native XY section at 2.5 mm has one contour, two lines and two true R12 arcs. Free endpoint angles legitimately change; no unexpressed fixed-angle or uniform-scale claim is made.

Cancel preserves the accepted version. One Undo restores the complete pre-resize part; the next restores the original pre-Trim sketch and Pad. Actual WebMCP discovers the same middle target, packs the identical repair, and produces the identical complete human Trim and R12 results. UI acceptance is asynchronous: reads use the settled accepted version, rather than reusing a version captured during Apply. No application workaround was introduced for a stale verification read.

Proofs: `tmp/sketch-arc-radius-owner-{preview,solid}.png`, `tmp/sketch-arc-radius-owner-native-proof.json`. The disposable draft was undone through all four global steps to zero features, empty parameters and no Undo, then closed without saving a user record. All verification processes are stopped. Independent actual-source review below has no open finding.

## Compatibility and unfinished scope

This changes operation eligibility using existing schema-2 radius/equality records. Earlier checkpoints may reject the newly accepted edit; saved geometry/relation formats remain unchanged. There is no general constraint transfer, circle-radius conversion, ordinary Tangent or Split-owner expansion. Reference/source reuse, remaining relations and sketch transforms remain unfinished.

## Independent actual-source review

Reviewed the frozen diff above `f6a7cb9`: production dependency policy, four new pure regression groups and the updated former rejection cases, both native preparation files, tool descriptions and the upgraded complete D-plate journey. This is distinct from the earlier plan review. No tests, native probes, builds, browser actions or production edits were performed by this reviewer.

No actionable implementation finding remains in this bounded read. The predicate requires an actual surviving arc and a radial/equality relation that names its ID. The same approved relation is excluded from the combined entity/expanded-point owner test; explicit detached-point relations and string drivers still block. No-hit deletion supplies no surviving source, circle conversion remains separate, and line directional policy is unchanged. Middle Trim keeps original owners on the old-ID child and appends its existing sibling equality. There is no relation rewrite, dropped equation or change to shared reference visitors, geometry certificates, solver lowering or exact prepared-candidate validation.

The new pure cases exercise the changed native start-spoke meaning, CW start Extend, exact diameter text/equality tuple order, middle support, peer-only radius ownership, explicit/string endpoint drivers, actual fillet ownership and deletion. Read the genuine original start-Trim failure in `tmp/sketch-arc-radius-owner-domain-red.log` and final author results: seven suites/58 cases pass, with eight-path scoped types clean (`tmp/sketch-arc-radius-owner-domain-final.log`, `tmp/sketch-arc-radius-owner-domain-types.log`).

The two frozen integration files use the real query and constructor before shared preparation, comparing the **complete** boundary candidate rather than only its visible arc. Later R12 propagation is tested separately on the selected-area Pad document. A fixed-R10/R12 batch obtains actual conflict IDs and leaves the exact session unchanged. These address the design-review fixture clarification. Read author evidence of 13 passing cases and clean scoped types in `tmp/sketch-arc-radius-owner-integration-{tests,types}.log`; the earlier native DOF comparisons remain preflight evidence rather than a universal independence claim.

The upgraded existing journey retains private Cancel, deliberate old-area repair, one whole-part Undo, same-ID human/agent parity and save/reopen. Its resize assertions inspect actual endpoint/section radii and retained source records without assuming uniform scaling of free angles. Final build, Chromium/Firefox and live native acceptance remain root-owned and pending at this review freeze. Other driver compositions may safely reject; broader sketch completion is not established here.
