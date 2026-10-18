# Exact Move for selected sketch geometry

Date: 2026-10-16. Design and shared-operation implementation following the [acceptance audit](2026-10-16-sketch-acceptance-audit-next.md). The design was read through `e4dbf90`; implementation follows the equality checkpoint `4e7bee9`. The focused domain/preparation/private-draft slice is tested and frozen. Production build and browser acceptance belong to the root integration pass and are not claimed here.

## Recommendation

Add one exact translation command for the current point/entity selection. Construct its rigid source translation, run the existing prepared solver, and independently reject any result that misses the requested coordinates or changes an outside coordinate or radius. Keep every expression and relation. Reuse the existing RelationsPanel submission/preview owner for a compact typed Move first; canvas movement can follow separately.

This differs deliberately from `move-sketch-point`: that operation requests a temporary drag and can project onto remaining freedom. Exact Move must reject a blocked displacement as a whole, including a blocked axis. It must never substitute the nearest allowed move, edit a parameter automatically, append offsets to source formulas, remove relations or detach endpoints.

Official references support selection, an explicit move anchor, precise displacement and cancellation. Onshape's [Transform Sketch](https://cad.onshape.com/help/Content/Sketch/sketch_transform.htm) retains internal constraints for translation, but also documents dimension deletion and construction additions for some transforms. Those latter policies are unsuitable here. SketchUp's [Move](https://help.sketchup.com/en/sketchup/moving-entities-around) documents selected sets, a reference point, inference previews and typed relative coordinates; it is an interaction reference, not evidence of equivalent parametric solving. Both sources were read on 2026-10-16.

## Public command and ownership

```ts
{
  kind: 'translate-sketch-geometry';
  sketchId: string;
  selections: readonly CadSketchGraphSelection[];
  translation: CadPoint2; // local sketch XY millimetres
}
```

Use the existing canonical point/entity atom and complete-set validation: 1–64 distinct atoms, all owned by this graph. Mixed sets are valid. Preserve request order for UI identity; computation uses deduplicated source IDs. Promote the shared selection atom/schema/ownership check to a domain module and re-export it from the existing feature module, rather than importing feature code into `cadOperations` or creating another selection model.

Evaluate the displacement once against the candidate parameters after preceding edits have solved. Expression-valued command arguments describe this one operation; they create no saved relationship. An exactly zero vector returns the unchanged source/history, preserving redo. Reject nonfinite/out-of-range results and a nonzero requested component that disappears in floating-point addition at any targeted coordinate.

Determine moved point set **P** from explicit points and selected entities: both line endpoints; arc center/start/end; circle center. A point included directly and through several entities moves once. Preserve circle radius scalars, construction flags, IDs, entity order, arc direction, relation records and exact source strings.

Include a structural fillet/chamfer's original reference corner when all of its three operand entities are covered by this move. An entity is covered if explicitly selected or all its source points were in the initial P. Add only that relation-owned reference point; do not recursively grow a connected component from the added point. This lets a fully selected treated outline move without leaving its original corner behind. A partially selected treatment retains its outside support points and can reject normally.

## Boundary and driver policy

All points outside P retain their exact source coordinates. All circle radii retain their exact source scalars, including unselected circles. Same-ID shared endpoints necessarily move in incident unselected entities: moving a rectangle's top edge can stretch its two adjacent sides. Show the whole prepared sketch, not only a detached selection ghost. The first operation does not promise that incident unselected edges keep their former shape.

Distinct IDs at equal coordinates are independent. Even a declared coincident alias outside P is not silently selected or moved; a relation that cannot remain satisfied blocks the move. Selecting both identities permits their joint translation. Construction and material operands use the same rules.

For each moved coordinate, a string driver blocks a nonzero displacement on that axis, including numeric strings. A fixed-axis or fixed-point relation blocks the corresponding nonzero displacement too. Zero motion on a driven axis preserves its exact text. A linked circle radius does not block translation of its otherwise movable center. Do not rewrite fixed relation values or synthesize a second owner. Internal H/V, distances, parallel/perpendicular, radial/equal and corner relations remain unchanged. External relations are also retained; they can pass only when this exact move and unchanged outside coordinates satisfy them.

## Preparation and independent acceptance

Use one focused pure translation helper in the domain reducer. It validates ownership/drivers, calculates P and creates the affine candidate. In `prepareCadEdits`, treat this like a geometry-dependent command: flush preceding intents first, capture that solved source, reduce the Move, run the normal whole-document solve, then check this Move before processing later explicit edits. Do not decompose it into sequential point drags.

The independent certificate compares the returned geometry with the exact affine candidate: every targeted numeric coordinate equals its computed source-plus-delta value, outside coordinates equal source, radii and every noncoordinate field remain exact. A native Success alone is insufficient. A native result that changes either selected or outside geometry rejects; do not overwrite its output with intended coordinates to force acceptance.

Also check shape preservation against the source before native solving. Compare selected-set anchor-relative vectors and each selected entity's local support vectors, including both arc spokes, using the existing `cadPathClosureTolerance` on those local vectors. This is a stricter representability check, not a larger tolerance or a new solver threshold. It catches micron geometry shrinking when translated to a distant origin even though absolute-world roundoff would permit the difference. Circle radii remain exact; retain arc direction/branch and run the existing analytic geometry, corner, relation, path-encoding and complete-part checks. Numerically uncertain translations reject explicitly.

Operation-specific failures should identify blocked coordinates or missed intent through a precise `CadError` code and readable source labels. Ordinary native failures retain current structured diagnostics. Independent original-relation failures can report their real relation IDs; never manufacture native conflict/redundancy IDs. Failed previews/Apply retain the pending displacement.

No solver input, worker protocol, WASM, native scale or stopping criterion change is needed. Existing solver reply validation permits changes to any numeric coordinate/radius, so the Move-specific certificate is necessary in addition to that validation.

## Native evidence and rejected alternatives

An ignored bounded prototype uses pinned `@salusoft89/planegcs@1.3.0`: `tmp/sketch-selection-move-trial/probe.mjs` and `report.json`. Four fixtures compared ordinary translated seeds, fixed numeric point parameters and added driving-coordinate equations.

- Ordinary seeds accepted a dimensioned rectangle, a top-edge move with free height, and a major CW arc plus construction circle. Their returned coordinates and radii matched the requested candidate exactly, with no new native diagnoses.
- With height fixed, moving the top edge from Y=10 to Y=15 returned native Success by moving the bottom to about 3.5706 and top to 13.5706. The original height relation was satisfied, but the requested Move was not. The certificate must reject this.
- Added hard coordinate equations introduced artificial redundant constraint IDs on valid moves. Fixing point parameters introduced redundant implicit arc-radius equations; it also returned Success without conflict IDs for the invalid fixed-height candidate, whose independent original-relation check still failed.

Therefore do not add a hard-target protocol or filter native redundancies to accommodate one. The measured seed-and-verify path handles useful cases with the existing equations. These probes establish direction, not an exhaustive numerical range.

## Integration and red-first acceptance

Add the edit to the reducer/schema and narrow discovery/guide, the preparation geometry-dependent path, and `CadSketchEditDraft.validateEdits` under the existing sketch-ID guard. The same controller operation serves human and agent calls. Human owned drafts keep local Undo/Redo; Finish remains one guarded whole-part commit with deliberate consumer-area repair if needed. Reuse existing version, workflow, adapter, AbortSignal and late-result checks. No saved graph metadata or schema-version change is needed.

RelationsPanel can accept an initial `move` command, keep one discriminated active edit, and show ΔX/ΔY through shared controls. Reuse its exact source pin, prepared whole-document preview, Cancel/Escape and `CadEditCompletion`; do not create another form hook. Keep typed Move separate from the existing singleton point-drag semantics.

Pin a handful of behaviors at the shared operation/preparation seam, then one owned UI journey:

1. Translate a free dimensioned rectangle plus a circle, with mixed point/entity overlap in the request. Every source point moves once; sizes, construction, exact radius formula and IDs stay intact; one Undo restores the original.
2. Move only a rectangle top edge with free height. Its two shared endpoints move exactly, adjacent sides change, bottom points stay fixed. Repeat with a fixed height: reject the native Success that moves bottom/undershoots top, preserving the exact accepted snapshot/history.
3. Exercise one string-driven axis and fixed-axis/point relation: motion along an unblocked axis succeeds; any nonzero blocked component rejects the whole vector. Zero Move preserves redo. Distinct coincident aliases require both IDs; nearby undeclared points never join.
4. Translate major/minor arcs and circles without resizing, then a fully selected fillet/chamfer including automatic owned-reference closure. An invalid partial treatment move and an unrepresentable far-origin tiny translation reject without restoring or detaching topology. A valid edit of an ordinary far endpoint remains allowed when the retained treatment constraints permit it.
5. Put parameter edits before Move to prove source targets use the preceding solved candidate; put a later explicit edit after it to prove ordered batch semantics. Native output drift in an unrelated coordinate or circle radius rejects.
6. In an owned consumed sketch, preview a typed Move, reject/correct it, cancel a pending Apply, then accept and Finish. Main source stays unchanged until Finish; cancellation/stale owner/source/storage results never commit; Finish and one global Undo retain exact originals. Agents invoke the identical strict command through ordinary full-part atomic batches.

## Implemented shared boundary

`cadSketchGraphSelection.ts` now owns the canonical selection schema/type and complete-set ownership check, re-exported by the existing feature selection module. `cadSketchTranslation.ts` implements the affine source intent, retained-driver blockers, treatment reference-corner closure and local-vector representability checks. Fully covered arcs also compare their source and target signed-sweep class: a measured translation rounded a barely major CW arc (or minor CCW arc) onto a half-turn despite passing vector roundoff checks. That move now rejects explicitly; no geometric tolerance was widened.

The strict `translate-sketch-geometry` edit is present in `cadOperations` and the private sketch draft allowlist. Preparation flushes earlier edits, skips native solving for a zero command, solves the affine candidate through the existing whole-document path, and compares the entire result with that candidate before accepting later edits. Thus a native Success cannot silently project the requested Move, propagate to outside points, resize another circle or rewrite source records. The private draft retains its existing sketch ownership, local Undo/Redo and guarded one-Undo Finish.

Red-first evidence includes the missing command boundary, native Success missing the exact requested target, private allowlist, driver/precision checks and the half-turn branch case (`tmp/sketch-move-branch-red.log`). Final focused helper/preparation/private-draft suites pass **46/46** in `tmp/sketch-move-focused-final.log`; scoped syntax/semantic TypeScript for all eight owned source/test files passes in `tmp/sketch-move-types.log`. Cases cover shared endpoints, mixed selection deduplication, coincident aliases, exact strings/radii/records, ordered parameter batches, real-native treatment moves and zero-command redo retention. Independent real-native far-endpoint probes for both corner treatments also pass (`tmp/cad-move-independent-audit.log`). These are overlapping focused checks, not a claim of exhaustive numerical or browser coverage.

The command remains deliberately exact: constraints that require any adjustment away from the affine candidate reject, even if a projected drag could find another valid position. Numeric source components must represent the local shape and arc branch after translation; uncertain cases reject without healing, detachment or driver removal. Canvas translation gestures remain outside this shared-operation slice. No saved schema, native protocol, dependency or remote changes were needed.
