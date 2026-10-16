# Persistent preceding-sketch construction reference

Design only, 16 October 2026, after independent Copy checkpoint `10d67ca`. No production/test edits, tests, native probes, browser actions, builds or package changes. Mirror, Offset and independent profile Copy are delivered; none supplies the dependency described here.

## Recommendation and vendor evidence

Implement one deliberately narrow **Use reference** operation: choose one stable graph line or circle in an active preceding sketch, retain it as read-only construction geometry in the active sketch on the same declared base plane, constrain ordinary local geometry against it, and recompute downstream after source edits. Explicit **Detach reference** retains its current local IDs and numeric geometry. Do not add solid-edge projection, legacy/plugin boundary ordinals, arc projection, arbitrary plane transforms or associative Copy to this slice.

This is useful enough to justify the next ownership change: a bore constrained to a layout line must follow its midpoint after the layout width changes. Another detached-copy variant would not meet that requirement. However, this is larger than the last copy constructors: sequential derived-state preparation and exact-operation propagation need design review before implementation.

Onshape Use projects edges from a part/sketch into the active sketch and previews projected geometry on hover. Used edges update with their source, with documented limitations when geometry type changes. These support source picking, persistent identity and an explicit unsupported-topology diagnosis, not a claim that this proposal implements general projection. [Onshape Use](https://cad.onshape.com/help/Content/Sketch/use.htm)

Fusion distinguishes projected geometry with an associative Projection Link from independent geometry; linked projections update after source changes. Its documentation also names re-link, break-link and delete as lost-projection actions. This proposal implements strict unavailable-source rejection and explicit detach first, without inventing a repair loader or automatic re-link. [Fusion project/include](https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/SKT-SKETCH-CREATE-PROJECT-INCLUDE.htm) Autodesk's support instructions identify Break Link as the way to edit formerly projected geometry. [Fusion Break Link](https://www.autodesk.com/support/technical/article/caas/sfdcarticles/sfdcarticles/How-to-break-sketch-link-to-modify-projected-geometry-in-Fusion-360.html)

All decisions below are proposed application contracts, not implemented behavior or undocumented vendor behavior.

## Existing seams and the authority problem

| Actual module | Present behavior and required narrow extension |
| --- | --- |
| `src/domain/cad/cadDocument.ts`, `cadSchema.ts` | Sketch owns profiles plus an optional local graph. Accepted parser outputs are detached/frozen and cached by identity. Parser validates graph geometry and preceding feature inputs. Add saved reference shape and independent cross-sketch validation; never refresh geometry in the parser. |
| `src/domain/cad/cadFeatureInputs.ts` | Sketch operands currently have no sketch dependencies; datum placement is separate. Extract reference source sketch IDs here so ordering, deletion/cascade, suppression diagnostics and dependency inspection share the same ownership. |
| `src/domain/cad/cadDatumPlanes.ts`, `cadDocumentFrames.ts` | Existing principal/datum frames and numeric offsets resolve placement. The document-frame cache parses its input, so it must not be called on an unsolved/stale intermediate candidate. Use the preceding datum lookup already built by the ordered pass. |
| `src/domain/cad/cadOperations.ts` | `applyCadEdits` is strict `parseCadDocument(reduceCadEditIntents(...))`. Internal `reduceCadEditIntents` validates edit schemas and returns **unparsed intent**. Preserve that distinction; no public parse bypass. Add the narrow creation edit and owner-aware detach handling. |
| `src/features/cad/cadEditPreparation.ts` | Parses the accepted input, reduces pending intent without a final parse, solves graphs in feature order, then parses the complete result. Refresh each target from the already solved preceding prefix before its worker request. Do not parse the whole stale intermediate candidate. |
| `src/features/cad/sketch-solver/cadSketchSolverRuntime.ts` and protocol/types | Worker sees one graph plus numeric parameters, not a document or frame context. It already fixes string-owned parameter components through `set_p_param(..., true)`. Add fixed numeric reference ownership without converting any value to a string or introducing a second solver. |
| `src/domain/cad/cadSketchGraphReferences.ts`, `cadParameters.ts`, `cadSketchGraphEdits.ts` | Local relation entity/point traversal drives deletion and surgery blockers. New owner exposes only its **local** entity there; fully qualified external IDs belong in feature dependencies. Source IDs are not expressions and must not enter scalar rewriting. |
| `src/features/cad/cadSketchEditDraft.ts` | A consumed sketch owns a valid prefix and local history. Earlier graph numeric solve values may change; original strings, topology, relations, profiles and provenance are pinned by `withoutSolvedGraphValues`. Reuse this preservation rule for explicitly authorized downstream reference propagation, not a global ignore-numeric comparison. |

### Saved contract

Prefer **one new typed graph owner relation** over another geometry store or a separate persisted reference sketch. Keep ordinary local line/circle entities for the existing compiler, snapper, picker and relation operands:

```ts
type CadSketchExternalReference = {
  id: string;
  kind: 'external-reference';
  entityId: string; // local construction line/circle
  sourceSketchId: string;
  source:
    | { kind: 'line'; entityId: string; startPointId: string; endPointId: string }
    | { kind: 'circle'; entityId: string; centerPointId: string };
};
```

The source witness contains topology only, never source coordinates, formula text, ordinal boundary indexes or a geometry hash. A source coordinate/radius edit with the same topology recomputes. Source kind, endpoint identity/order or center identity replacement fails as a changed reference. Split/Trim/Extend that changes a witnessed source endpoint therefore requires explicit detach or a deliberate later re-link design; it must not silently follow the retained entity ID to a shortened edge.

The ordinary target numeric coordinates/radius are an **accepted evaluated snapshot**, not independent drivers or fallback geometry. They let the existing local graph compiler/rendering operate without document-global lookups. The complete parser must recompute the expected values from the actual preceding source and compare them exactly. Projection between different normal offsets of the same declared base preserves local X/Y exactly and needs no tolerance-based coordinate matching. Forged/stale snapshots reject in parse, read, build, storage and `applyCadEdits`. Preparation alone may replace the derived snapshot before acceptance.

Local shape rules: exactly one reference owner per entity; kind matches its source witness; `construction:true`; owned points and circle radius are numeric. Allocate dedicated local support points, not point aliases shared with another entity or owner. Ordinary local relations may reference these points/entity, including Coincident to a separate local point, Midpoint and Equal radius. A reference is not material, an implicit joint with the source, or a source parameter alias. Another explicit dimension can still conflict or be redundant; do not silently remove it. Local point drivers/formulas cannot overwrite the owned snapshot.

### Source, frame and lifetime

- Fully qualified identity is source sketch ID plus graph entity ID and its typed topology witness. Source and target graph namespaces remain separate. Source must precede target and be active; direct legacy/plugin or solid boundaries are ineligible. A construction source is valid. No nearest-geometry or index fallback.
- First placement rule accepts identical principal plane, or the **same datum feature ID**, with independently finite normal offsets. This is orthogonal projection along the common normal: source `origin + u*x + v*y + normal*sourceOffset` projects to target `origin + u*x + v*y + normal*targetOffset`, so copy local X/Y directly. Do not subtract the two world positions or offsets numerically. Target retains its own exact offset driver; source offset edits leave projected local X/Y unchanged. Distinct but coincident datums or different principal planes do not qualify. Common datum motion moves both. No arbitrary frame transform, ellipse or tolerance-based base-plane equivalence.
- Reference metadata is saved in schema 2 and round-trips exactly. Old documents omit it unchanged. Older installed readers will reject the additive relation; state this in compatibility/public diagnostics. Schema 1 adoption still uses the existing explicit schema-2 upgrade and original-preservation path. No silent storage rewrite or schema-number-only workaround.
- Missing/suppressed/later source, changed witness or frame mismatch is a named strict error identifying source and dependent sketch. A source edit/delete/suppress fails atomically unless the batch deliberately detaches or deletes dependents first. Do not accept a broken-part document or render its stale snapshot as valid.

## Preparation and exact-operation gate

1. Start from accepted `parseCadDocument(document)`. Capture all edit arguments before asynchronous work, as now.
2. Reduce validated intent through `reduceCadEditIntents`; reference snapshots may temporarily be stale. This result is not an accepted document and must not escape through public reads/builds/storage. Source constructors used during reduction must consume the solved prefix, not call `parseCadDocument` on this intermediate whole part.
3. Traverse in feature order. Resolve source identity and frame against the already solved active prefix, produce a detached target graph with refreshed owned numeric components, solve the target, and verify the owned components still exactly match the authoritative refreshed values. Preserve every original source string and unrelated record. No target equation drives a preceding source backward.
4. Final nonrepairing whole-document parse rechecks dependency availability, exact snapshot equality, ordinary graph residuals and solid consumers. Only then can the existing version/cancel guard commit.

The exact geometry commands are a **blocking design/acceptance gate**, not an incidental equality tweak. Today Move/Split/Trim/Extend/Offset/Mirror/Copy compare the entire solved document against the exact constructed candidate. Legitimate downstream reference updates would make that comparison fail. Do not globally ignore numeric differences or disable that certificate.

Small proposed extension: construct the exact edited candidate; solve and certify its edited prefix against that exact candidate **before** propagating downstream reference consumers. Determine the transitive dependent sketches through the existing feature inputs. Only those later sketches may refresh reference snapshots and solve their ordinary numeric components. Every other original feature stays exact. Within permitted dependent sketches, topology, point/entity/relation identity/order, all relation definitions, strings, profiles, placement/provenance and packages stay exact; only pre-existing numeric point coordinates and circle radii are solver-owned, plus precisely refreshed owned snapshots. Run the unchanged independent graph check and final full parser. If a downstream constraint cannot follow, reject the entire originating operation.

This requires a small explicit preparation phase boundary, not another history or solver framework. It must have one real source-Move-to-dependent-native proof before shipping. If the check cannot stay narrow, stop and reconsider the saved model rather than ship parameter-only following while implying arbitrary source edits work.

Proposed public creation edit on the existing guarded `cad_edit_document` surface:

```ts
{ kind: 'use-sketch-entity', sketchId: string,
  sourceSketchId: string, sourceEntityId: string, idPrefix: string }
```

The shared constructor captures the current typed witness and allocates `${prefix}_reference`, `_e0`, line `_p0/_p1` or circle `_c0`; prefix max64, complete target namespace collision rejects, no automatic retries. Caller supplies identities, never computed geometry. The local source/target/witness are validated again during Apply.

Detach uses the existing `remove-sketch-relation` for this owner, with an explicit contextual **Detach reference** label. Preparation must flush preceding edits **before** removing a reference owner, so detach keeps the latest accepted/recomputed geometry. `set-sketch-relation` replacement of an existing owner needs the same flush. Creation also flushes first. A batch `[detach, delete source]` is deliberate and can commit once; deletion-first remains dependency-protected. Do not expose generic relation removal as an unnoticed link break.

Move/grip, construction-off, Split/Trim/Extend/corner and dimension-setting mutations of owned supports reject until detach. Ordinary reference inspection, endpoint/center/midpoint position snapping and using the reference as another relation's operand remain valid. Explicit detached Mirror copying may snapshot it without copying the reference owner. Deleting a reference entity must explicitly/cascade-delete its owner, not leave invalid metadata or silently convert it to editable geometry.

## Human entry and private ownership

Use one operation-local source stage, not a new global picking service or geometry dropdown. Pin the active target document/version/sketch/frame. **Use reference** lends the existing tree's sketch selection to choose an eligible preceding source sketch; render that actual accepted graph in a temporary read-only `CadSketchCanvas`, with `graphControls.entityPick` restricted to its line/circle IDs. The tree selection is intercepted by this command and does not retarget the active target sketch. Clicking an edge switches back to the **actual target prepared preview**; Apply/Cancel use the existing submission/preview owners. Change source clears the preview synchronously before enabling accepted-source picking. Invalid/background picks are consumed.

Actual reuse: `CadWorkbench.tsx` already lends a real alternate sketch canvas for profile Copy and `CadSketchMirrorEditor.tsx` owns `choose-line → preview` with `useCadPreparedPreview`. `CadSketchGraphLayer.tsx`'s `entityPick` supports eligible entity IDs, Enter/Space and consumed selection; `CadSketchCanvas.tsx` routes overlapping candidates and keyboard context selection through it. Eligibility already accepts circles. Its overlap menu text currently says `Line` for every entity-pick candidate, so use the actual kind label. No new intersection or screen-distance picker is needed. Context actions on the target reference offer Inspect source and Detach; they must not enter the source sketch by overwriting the pinned target owner.

The owned sketch-draft allowlist can admit creation/removal only for its current target sketch. Preceding source features remain read-only while choosing. Local Cancel restores everything; Finish validates the full part and makes one global commit. Editing the source in a private prefix intentionally has no later target in that local prefix; its whole-part Finish must use the same downstream refresh/strict acceptance. No separate source-edit session or direct controller bypass.

## Bounded red-first proof and native go/no-go

Native capability is plausible from the current runtime's fixed-parameter path, **not newly measured here**. Proposed lowering fixes the owned numeric point parameters and circle radius directly as current evaluated constants, preserving numeric source type. Never manufacture numeric expression strings or freeze the source graph. The independent post-solve owner check compares exact target values, including a worker-reply guard for those components. Fixed native parameters may omit conflict/redundancy IDs, as already known for expression drivers; report actual diagnostics and reject an independently invalid result, never fabricate owner IDs.

Before production, authorize only these bounded actual pinned-WASM candidates, then the same real preparation cases:

1. **Line reference:** source A[`0`,`10`] → B[` span `,`10`]; target reference at independent XY offset5 fixed to its local X/Y, local numeric bore center Midpoint to the target line, radius3. `span40→60` moves bore20→30 while the reference has zero geometric DOF and source strings/IDs remain exact. Changing source normal offset0→2 leaves projected X/Y unchanged; native target placement remains its own offset5. One source exact Move or equivalent current authored geometry edit proves the certificate/propagation boundary; reverse endpoint direction is exercised without source witness rewriting. A constrained target that cannot follow rejects the whole source edit.
2. **Circle reference:** source expression center/radius, one local construction circle reference and a distinct local bore related Coincident-center/Equal radius. Parameter edits move/resize the bore; the source remains unchanged by target edits. Adding an incompatible target driver yields actual native diagnostics or independent invalid-solution rejection, with no accepted version/parameter/storage change. Do not tune native settings for this gate.
3. **Pure authority/lifetime:** forged/stale snapshot rejects strict parse/`applyCadEdits`/read/build; normal prepared source edit refreshes and passes; wrong kind/support IDs, source order/suppression/frame and collision cases reject. Detach retains current numbers and local IDs, subsequent source changes no longer move them. No source kind/endpoint replacement auto-rebind.

Complete human+WebMCP part proof: preceding construction layout line from[0,10] to[span,10], separate80×20 plate sketch at XY offset5 with R3 bore. Use line via actual canvas pick, constrain bore to Midpoint, Cancel/Apply inside the existing owned sketch draft, then Pad5. `span40→60` moves the native bore center20→30 while volume remains `5*(1600−9π)`. Detach, change span80, verify center stays30; Undo restores dependency and exact source/target records. Save/reopen through browser cache and folder adapters, repeat one guarded agent creation/removal, and verify missing/suppressed-source rejection leaves the accepted document/version/save original untouched. Volume alone is insufficient evidence of following: inspect native hole-center/section placement and target Z5→10 extent too.

## Ownership and size

Estimate 300–420 production lines across a focused reference resolver/constructor, graph schema/visitors and dependency/parser checks; 70–110 preparation/runtime/protocol lines including the exact-operation boundary; 100–150 contextual source-pick UI integration. This is an estimate, not a line quota. Tests should cover the functional groups above rather than another numerical sweep.

Recommended split: one domain owner for typed owner/resolver/guards; one preparation/native owner for sequential refresh, exact propagation certificate and worker boundaries; root owns contextual source picking, private source/target entry and complete native/storage/browser acceptance. Review the preparation phase contract and bounded native evidence before dispatching parallel implementation. If that boundary needs a generic dependency engine, the proposal has exceeded this slice; stop rather than disguise snapshots as persistent references.
