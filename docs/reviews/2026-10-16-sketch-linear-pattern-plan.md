# Persistent linear sketch patterns

Read-only proposal, 16 October 2026, after Concentric `0800543`, while sequential Dimension picking is being accepted. No production edits, tests, native probes, builds or browser interactions were performed. This is a design decision to review, not an implemented capability.

## Recommendation and evidence

Start with **one graph circle repeated along local X or Y**, with a saved total count, positive pitch, explicit direction and omitted instances. A mounting-hole row is a complete useful result. Changing the seed's position or diameter must update every attached instance after Apply, Undo and reload. Calling detached copies a pattern would not satisfy this requirement. General line/arc groups, two directions, circular patterns, nesting and instance-specific driving dimensions remain outside this first scope.

Onshape's sketch pattern supports count/distance editing, later reopening, and deleted occurrences that do not return when count changes. Fusion exposes per-step Spacing versus overall Extent, editable quantity/distance and individual suppression. These support persistent intent and explicit removal; our exact identity and ownership policies below are our design choices. [Onshape linear sketch pattern](https://cad.onshape.com/help/Content/Sketch/sketch_linear_pattern.htm), [Fusion rectangular sketch pattern](https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/SKT-CREATE-RECTANGULAR-PATTERN.htm).

Current `CadPatternCommand.tsx` and `CadFeature` patterns operate on bodies. `CadSketchGraphSchema` has stable circle/center identities and several owner relations, but no pattern. `cadSketchSolverRuntime.ts` already lowers signed axis distances to `difference` and circle equality to `equal_radius_cc`. The existing graph and worker checks independently validate accepted geometry. These are a smaller starting point than a separate generated-geometry renderer or dependency engine. See `cadDocument.ts`, `cadSketchGraph.ts`, `cadSketchGraphReferences.ts` and `cadSketchSolverProtocol.ts`.

## Proposed persisted contract

Add one graph relation arm, initially circle-only:

```ts
{
  id, kind: 'linear-pattern',
  seed: { kind: 'circle', entityId, centerPointId },
  idPrefix,                         // required, at most 64 characters
  direction: '+x' | '-x' | '+y' | '-y',
  count,                            // integer 1..32, includes the original
  spacing,                          // positive CadScalar, millimetres per step
  omittedInstances                 // unique indexes 1..31, never seed index 0
}
```

The count limit is a proposed bounded product policy, not a measured performance limit. Count is literal in this slice; spacing retains exact expressions and participates in the existing parameter visitor. Flip changes only `direction`, preserving the spacing string. The source circle and center IDs are a topology witness. Changing their binding or the prefix under an existing owner ID rejects; recreate deliberately instead. Seed geometry and its constraints are never cloned or normalized.

Store ordinary numeric graph circles and dedicated centers for active indexes `i=1..count-1`, excluding omissions. Use deterministic IDs `${prefix}_i${i}_p0` and `${prefix}_i${i}_e0`. The owner keeps its own stable relation ID. Prefix collisions reject, including a collision encountered during a later count increase. Existing instances retain IDs through edits; shrinking and regrowing intentionally restores the same indexed occurrence. Keep omissions beyond the current count so regrowth does not undo a deletion. There is no persisted material-cell ordinal or geometry hash.

The first eligible seed is a nonconstruction graph circle, including one whose center is constrained to a linked support. Pattern-generated seeds and nested owners reject. Generated members inherit the seed's size through the relation, not copied dimension records. Construction conversion of the owned seed/members is initially blocked until detach. Legacy/profile patterns and circle-to-arc replacement are not implicit promotions.

## Native and acceptance model

For each active member lower the owner to three existing native conditions: center X difference, center Y difference, and radius equality to the seed. The nonzero coordinate difference is `±i * evaluate(spacing)`; the other is zero. Map all internal equation IDs to the real pattern relation ID for conflict diagnostics. Each copied circle contributes three variables and three independent conditions, so it adds no freedom to the seed. This is equation counting, **not yet pinned-native evidence**. Two free centers must not become secretly anchored.

Keep copies as ordinary numeric native variables. No source-derived fixed cache, second solve, post-solve projection or new WASM binding is needed. Native writeback preserves every seed string and descriptor through the existing numeric mask. Independently check both actual center differences and radius equality with the current driver/world-distance policies. Reject nonfinite pitch products, unsupported coordinates, unrepresentable distinct occurrences and duplicate circular supports; do not widen tolerances or heal contacts. Existing material/region validation handles the resulting analytic circles without automatic union or contour repair.

This recommendation deliberately avoids arbitrary copied arcs. Their structural endpoint-radius equation plus a complete translated-point binding can duplicate information. Supporting them requires a separate rank/representation proof, not simply iterating Mirror's output or hiding redundant diagnostics. Circle-only native feasibility should be gated by a few ordinary seed/spacing edits before implementation is advertised.

## Shared edits, ownership and deletion

Use existing `set-sketch-relation` for create/update. A focused `cadSketchLinearPattern.ts` reconciler called by that reducer arm allocates/removes the deterministic records and seeds numeric guesses from the current evaluated circle. The same module validates expected membership, ownership and residuals. Full source replacement remains strictly checked; callers do not submit computed instance geometry as authoritative pattern intent. No standalone tool is needed. Normal document/constraint inspection exposes the owner and index-to-entity mapping.

Generated members are selectable for inspection, passive dimensions and material selection. Their direct Move, radius editing, Split/Trim and additional driving relations initially explain **Edit seed or detach pattern**. Do not allow a new constraint on a member to back-drive a free seed unexpectedly. Seed position/size constraints remain normal editable source. Seed deletion or topology replacement blocks until explicit detach/delete of the pattern; cascade must not silently dissolve ownership.

Deleting a member means setting its whole occurrence index in `omittedInstances`, not deleting just its circumference record. Count reduction or omission must block on other dependent source references unless the same atomic edit deliberately repairs them. Never silently drop saved annotations. Removing the pattern relation is explicit **Detach pattern**, retaining all current numeric members as independent geometry. Deleting the pattern can atomically reduce to count1 then remove its owner, retaining the seed. Per-instance detach can wait; do not pretend suppression is detachment.

`cadEditPreparation.ts` must flush preceding solved edits before reconciliation reads the seed. Topology edits seed new members from that solved source and run the existing complete edited-prefix certificate; ordinary seed/pitch parameter changes solve normally. Preserve existing transitive external-reference updates and worker guards. Count changes may invalidate explicit consumer-area references; the current private sketch draft and deliberate area repair handle that. Default material remains governed by its existing semantics. Cache and folder saves retain the same pattern source. Older readers reject this additive schema2 arm; no automatic migration or installed-package change is proposed.

## Human workflow and meaningful gates

Select a bore circumference, choose sketch Linear pattern, then preview the row with one compact count/pitch editor and canvas direction arrow. Local X/Y and Flip are explicit, without a geometry dropdown. Reopen through any member's pattern command or its owner relation. Display the whole owned row, seed and omitted positions; Cancel returns to the exact source and prior selection. Use the existing preview/submission/version/frame owner and private Finish path. `CadPatternCommand.tsx` must dispatch by sketch/body context rather than substituting a body pattern.

Red-first acceptance should produce a **70×20 plate, four Ø6 holes at X10/25/40/55 and Y10, Pad5**. Expected volume is `5*(1400-36π)` mm³; also check actual bore centers and cylindrical radii. Reopen, change named pitch15→16 and seed Ø6→Ø8, decrease count then increase it, omit one occurrence and verify it stays omitted after another count change. Cancel one edit, Finish once, Undo/Redo and save/reopen through both adapters. Human and agent source must match. A conflicting seed driver, dependent omitted occurrence, stale preview and forged member binding must reject atomically. A free-seed case must retain three freedoms; a center-and-size-driven seed must retain zero. These gates are proposed, not executed here.

## Implementation boundary and decisions

One focused domain module plus the existing graph/schema/reference/scalar visitors; narrow reconciliation in `cadOperations.ts`; native lowering/worker acceptance; ownership guards and existing inspection; one sketch editor and command entry. Preparation, private-draft, storage/API and consumed-part tests cross these same interfaces. Rough production estimate is 450–750 lines across existing seams and the new modules, subject to source review. This is larger than detached copy because saved ownership and deletion are real behavior.

Approve or change the initial circle-only/X-Y scope, count cap and no member-driving policy before code. This would be a genuine first S19 checkpoint, not completion of general editable sketch patterns. If the required first deliverable must include arbitrary line/arc groups or unrestricted constraints on instances, this smaller design is insufficient. Decide that broader representation explicitly instead of incrementally turning a copied graph into an undocumented pattern engine.
