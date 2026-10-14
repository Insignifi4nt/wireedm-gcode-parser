# Independent depth presentation review

Reviewer: `/root/explicit_sketch_dimensions`; author: `/root/tree_interaction_refine`. Scope is the two presentation-only helper/test changes. No tracked product/test source, server, build, browser, saved document or release change was made by this reviewer.

## Verdict and corrected finding

The initial requested pair (`06D0C770…` helper / `1380C405…` test) contained one real display defect: `Number(distance.toFixed(6))` erased supported nonzero values. Accepted Pad validation requires magnitude greater than `1e-7`; therefore `±4e-7` and `±2e-7` are valid accepted values, yet the original compact format displayed zero. Root and this reviewer independently identified the boundary, and the same author repaired and verified it. The initial pair is superseded, not approved as final.

The final pair below reviews clean. Ordinary labels keep six fixed decimals without trailing zeros. Only when that display is zero while the real quantity is nonzero, a six-significant-digit scientific fallback retains the sign and nonzero meaning. True zero remains zero. This changes display text only; exact quantities, source aliases, source-frame endpoints and native/editor acceptance rules remain unchanged. The tracked accepted-small cases parse complete `±4e-7` documents first. Separate boundary/below-range renderer cases are accurately identified as provisional and do not imply accepted native eligibility.

Idle/guide rust `#b84f18` and hover/active rust `#a6440e` use the established source-selection palette; locked appearance/reasons stay intact. Actual Three material tests verify contrast against dark canvas and selected cyan and normal restoration after hover. Body materials, ray projection, anchoring, geometry, hit target, capture/routing and camera operations do not change. Root still owns fresh lit/raster verification of this final palette; a source contrast calculation is not a substitute for that proof.

## Independent evidence

An ignored read-only replay (`tmp/cad-depth-presentation-independent.ts`) uses real `CadSession` document acceptance, the actual depth model and a real Three camera/handle. All six quantities `±4e-7`, `±2e-7` and `±19.844262327110005` pass. The small labels are respectively `Length ±4e-7 mm` and `Length ±2e-7 mm`, and ordinary noisy values display `Length ±19.844262 mm`. Every full-precision quantity/endpoint, exact ` depth ` binding, complete document text and session snapshot remains unchanged. Log: `tmp/cad-depth-presentation-independent-small-values.log`. This proves display behavior and shared-domain acceptance; it does not assert a new native build of those tiny fixtures.

In-memory reversal of only the palette/format statements exactly reconstructs original functional helper SHA `37DB0032E5DD799182A1572363F7AC7F669B175B2CA05242A8662579FC3CFD83`. Removing only the new presentation tests/import exactly reconstructs original helper-test SHA `3ACE3198F55872303DD5CA868AA571BDF6548E2898913AA3A8187A93C41C3576`. Thus no mathematical/control code or prior assertion was altered. The replay writes no product source; `tmp/cad-depth-presentation-independent-diff.log` contains both reconstructed hashes.

Independent Node24.22.0 run: **93/93 tests across six full files passed** (`tmp/cad-depth-presentation-independent-focused.log`). These cover presentation/helper, mounted viewport depth, real Editor/Session handle, editor depth, source picking and ordinary viewport. Full app strict TypeScript passes with exit 0 (`tmp/cad-depth-presentation-independent-types.log`), and scoped diff checks pass. Both final hashes match before and after verification.

Parent reports that the prior functional bundle passed actual physical drag/Cancel/Apply/one Undo and that the new public-agent region E2E passed one real Chromium test in 3.1 seconds. Those are attributed parent results; this reviewer did not rerun a browser or infer browser success from unit/discovery checks. Earlier functional evidence remains applicable because its exact helper implementation is preserved beneath this display-only delta.

## Final frozen SHA-256

| File | SHA-256 |
| --- | --- |
| `src/features/cad/cadExtrudeDepthHandle.ts` | `1D242DC7398B7EF12221F323D123E372CAC039EF0353C3B495B6AAE9C81DD32B` |
| `src/features/cad/cadExtrudeDepthHandle.test.ts` | `C28DA2E7066FDE78FE06BD6F1380E1C0D7523766A33ECC0572A6EE6F3E09F3AF` |

Author record: `2026-10-15-cad-depth-handle-presentation-review.md`, SHA `2A9A07A1F15A49ED191F2BF402B5A372E524076235BC037F8AAC7348EBD6F885`. The earlier routing/geometry/settings/API records retain their original scoped identities; no source outside this two-file presentation repair was changed here.
