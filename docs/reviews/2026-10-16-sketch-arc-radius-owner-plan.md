# Retained radius ownership for arc boundary edits

2026-10-16. Proposed **next checkpoint after arc Extend**, not a change to its approved conservative behavior. Read-only assessment: no production/test edits, native probes, builds or package operations.

## Smallest useful policy

Permit an existing `radial-size` or `equal-radius` relation to remain **verbatim** when end Trim, arc Extend or middle-arc Trim retains the referenced source arc ID, center ID, direction and certified circular support. The operation changes angular extent, not that entity's radius meaning. Reuse the existing support/branch certificates, exact constructor requery and complete prepared-candidate equality; do not infer eligibility from entity ID alone.

For end edits, preserve the original relation IDs, operand order, quantity and exact scalar text. For middle Trim, the radius owner stays on the source-start survivor with the retained ID. Its new sibling receives only the already-designed ordinary Equal radius support relation. Do not copy the old dimension onto both children, rewrite an existing equality tuple, choose a hidden master or delete a dependent relation.

The bounded implementation belongs in the existing private dependency policy in [cadSketchTrimExtend.ts](../../src/domain/cad/cadSketchTrimExtend.ts): one explicitly named predicate for a radius relation **referencing the retained source arc**, used by end-edit and middle-edit checks. No new operation, saved schema, native binding, UI state or reference service is needed.

## Actual ownership and native meaning

[cadSketchGraphReferences.ts](../../src/domain/cad/cadSketchGraphReferences.ts) reports `radial-size.entityId` and `equal-radius.curveIds` as entity owners, then expands those entities into center/start/end point IDs. Consequently `assertDependencies` currently blocks a radius owner both as a whole-arc owner and through its derived endpoint dependencies. Any allowance must exclude that same approved relation from both routes; merely filtering the entity-owner test leaves a false detached-point blocker. Keep the shared reference visitors unchanged: deletion, inspection and other operations still need their complete dependencies.

The allowance must require that the relation actually names the selected arc. A radius relation on another entity that happens to share the detached point does not gain this exception. All unrelated entity/point records remain exact; the normal full-candidate certificate remains the final boundary.

[cadSketchSolverRuntime.ts](../../src/features/cad/sketch-solver/cadSketchSolverRuntime.ts) compiles every arc as two center-to-endpoint spokes with one structural equal-length equation. An arc `radial-size` is a center-to-**start** distance; diameter is converted to physical radius by `cadSketchRadialTarget`, without changing its displayed source. Arc/arc equality compares their start spokes; arc/circle equality compares that spoke with the circle's radius. Thus replacing a start endpoint changes the spoke used by the native equation, while the saved relation still owns the same arc's radius. That deliberate retained-support interpretation needs a start-side regression as well as an end-side case.

The independent [radial](../../src/domain/cad/cadSketchRadialRelations.ts) and [equality](../../src/domain/cad/cadSketchEqualRelations.ts) checks already measure **both** endpoints of every arc. Retain these checks and their current driver budget; structural endpoint-radius closure remains stricter and unchanged. No source projection or solver tuning is justified by this policy.

## Boundaries that remain strict

- A string coordinate or an explicit point relation on a detached endpoint still blocks an end edit. Fixed point/axis, distance, axis-distance, Coincident, Midpoint and other point owners must not follow a newly selected endpoint. The old point and any adjacent edge using it remain unchanged.
- Corner ownership stays blocked, even when it also constrains radius: fillet/chamfer relations own support/tangency/topology beyond a scalar radius. This proposal adds no tangent capability or corner transfer.
- Whole-curve deletion, circle→arc conversion, string circle-radius conversion and changes to center identity/direction/support receive no radius-owner exception. The existing circle Trim policy stays unchanged.
- Middle Trim preserves original outer endpoint drivers because those point records remain used; its new cut points still obey current identity, namespace, witness and alias checks. Start/end edits must not borrow middle Trim's different endpoint-retention semantics.

The predicate must be source-kind-specific: preserve existing surviving-line directional exceptions, add only surviving-arc radius exceptions, and keep all other owner kinds blocked. Existing generated Equal radius owners could then support a later end Trim/Extend of a middle survivor, since the same two arc radii remain related; no automatic relation removal is required.

## Risks and acceptance gates

Retaining a relation is not proof that native equations are independent. Fixed radii or other drivers may make radial/equality constraints redundant; shared preparation can also detect genuine conflicts, structural mismatch or candidate drift. Those outcomes must remain honest rejection with actual diagnostics. Never drop an equation, normalize an expression, manufacture conflict IDs or move an unrelated peer to make an exact boundary edit pass. A preceding parameter change must solve first; read-only proposals still do not solve unsatisfied intent.

Keep the future verification bounded: an exact start-side end edit retaining a radius/diameter driver; a matching equality owner with tuple order preserved; and middle Trim retaining old owners while appending its one sibling equality. Reuse current stale-witness, endpoint-driver, corner, circle and cancellation cases for unchanged behavior. One real native preparation must prove the full constructor candidate survives before claiming support. No broad numerical sweep is needed.

## One observable radius-edit part proof

Use the existing numeric-endpoint D plate and middle-arc cuts, with a string-driven center, `radial-size.value: ' stockRadius '` on the source arc and `stockRadius=10`. Add an independent **construction circle with numeric radius 10** and one existing Equal radius tuple linking it to the source arc; do not add a second persistent radius driver. Leave the edited arc endpoints free of extra point drivers.

Inside the existing consumed-sketch draft, preview/Cancel first, then apply middle Trim without releasing either original radius owner. Preserve all original relation/scalar records; append only the normal sibling equality. Deliberately repair the old explicit area selector and Finish. Then edit the existing radius parameter from 10 to 12 through ordinary preparation: both endpoints of both surviving arcs and the construction-circle radius must satisfy the new physical radius, while center expressions, original radius text and equality tuples stay exact. Validate the current material, native Pad and saved references; one Undo must restore the complete prior accepted part. An incompatible edit must reject atomically. If the ordinary driver composition rejects or drifts, report its measured limit before implementation expansion.

This is an additive operation-eligibility change using existing schema-2 records; no migration, installed package/post change or new solver binary. Apps already supporting the current arc/radius/equality records need no saved-format change, while earlier checkpoints may reject the boundary command under their conservative policy. Public help should describe the retained-radius interpretation when delivered, without claiming general constraint transfer or unrestricted native acceptance.
