# Confirmed material removal across Cut families

Date: 2026-10-14. This scoped hardening follows the [Pad/Pocket interaction audit](2026-10-14-cad-pad-pocket-interaction-audit.md). It initially repaired sketch-based extrude and revolve Cut, then extended the same policy to Loft, Sweep and Boolean Cut after isolated probes established their equivalent gap. It includes shared native evidence used by Through-all Pocket and ownership of native candidates. It does not complete the overall CAD goal.

## Behavior and compatibility

Extrude/revolve Cut previously accepted a valid unchanged target when its tool was disjoint, directed away from the target, or only tangent. Loft, Sweep and Boolean Cut also accepted an unchanged disjoint or tangent target. The target was consumed under the Cut's feature ID without a diagnostic. All these Cut branches now require confirmed positive intersected material at the existing native precision policy. A no-material Cut produces `cut-no-material`, asks the user to check the cutting sketch or tool body, direction, extent and target, and retains the preceding valid bodies. Downstream features are not evaluated; export and section extraction remain blocked for that diagnostic model.

This is an intentional CAD behavior compatibility change. Saved histories containing previously accepted no-effect extrude, revolve, Loft, Sweep or Boolean Cuts may now stop rebuilding at that feature. Their serialized definitions, IDs, expressions, suppression state and originals are not rewritten. The user can correct the input or deliberately suppress the no-effect feature. Complete erasure also retains the preceding target and reports the specific `cut-erased` diagnostic instead of returning an unusable empty solid. Unresolved tool, target or intersected components produce explicit precision diagnostics; requested tolerances are not relaxed.

There is no CAD schema, machine package, installed post processor or storage migration. The release compatibility record and PR description should disclose the changed acceptance of saved no-effect Cuts. Through-all Pocket retains its existing diagnostic codes and cap precision checks. Join behavior is outside this decision.

## Native evidence and ownership

`cadKernelCutEvidence.ts` extracts the existing Pocket tolerance and per-solid measurement logic. Each target and Common solid is checked for closed, valid topology, finite positive volume and the existing resolution bound `max(1e-9 mm³, 4 × native tolerance × surface area)`. The `1e-9` floor and factor four are reused from the existing Pocket/solid policy; no new fixed epsilon or whole-target volume-difference threshold was introduced.

Distance Cut also checks each generated cutting region before it is fused with other regions, then checks the completed tool's individual components. A large region cannot authorize an unresolved thin annulus. The target is checked before Common, because an unresolved target component may be omitted entirely by a native Boolean. Common must contain positive, independently resolved solid material; contact-only faces and edges do not establish removal. Contact faces alongside confirmed solids remain allowed, matching Pocket.

The shared wrapper borrows target and tool. It releases Common after measurement, releases a rejected Cut result, and returns only the validated owned result. Model commit still waits for successful topology validation and meshing before consuming the target. Existing model failure cleanup disposes the generated tool and retains preceding native bodies. No automatic geometric healing or tolerance adjustment was added.

## Red-first verification

The first real OpenCascade run had **7 failing no-material cases and 3 passing valid-removal cases**. All seven failures showed that the kernel returned no diagnostic for the unchanged solid. The rejected cases were disjoint extrusions, outward extrusions from the top and bottom faces, a laterally tangent extrusion, a disjoint revolution, an outward half revolution and a tangent revolution.

The final focused run passed **92 tests in 6 files**, 3.52 seconds:

```text
cadKernelDistanceCut.test.ts
cadKernelPocket.test.ts
cadKernelModel.test.ts
cadKernelRuntime.test.ts
cadKernelDatum.test.ts
cadFeaturePreview.test.ts
```

The new Distance Cut cases use real native geometry. A radius 0.002 mm blind bore of depth 0.005 mm is checked against the independent cylindrical removal `πr²d`, exact section radius/depth and STEP round-trip material. A radius 0.001 mm bore in a one-million-millimetre stock is confirmed through its exact interior section and blind bottom; acceptance does not depend on subtracting nearly equal huge volumes. The revolved annulus removes the analytically expected half-volume `π(2² − 1²) × 10 / 2` from the stock.

Further cases preserve positive/negative and symmetric extents on XY, XZ and YZ, and a translated/rotated datum frame. Precision cases reject a thin cutting annulus alongside a broad cutter, a thin Common component alongside a broad confirmed removal, and a far-coordinate unresolved target before intersection. Interrupted Common/Cut operations and complete erasure verify that native temporaries are released while borrowed target material survives. An independently disposed rejected candidate leaves the accepted runtime's build, inspection ownership, STEP material and caller document bytes intact. Existing runtime stale-build guards remain unchanged. The preview coordinator still turns native diagnostic results into rejected candidates, so a retained earlier preview cannot authorize Apply.

`npx tsc --noEmit -p tsconfig.app.json --pretty false` passes. The scoped whitespace check passes. Browser interaction and the final complete-worktree verification remain root-owned.

## Analogous operations and remaining limits

The initial isolated real-native probes used 20 × 20 × 10 mm stock centered in XY, with Z from 0 to 10. Before the extension, these operations accepted unchanged stock volume, approximately 4,000 mm³, without diagnostics:

| Operation | Exact probe input |
| --- | --- |
| Loft Cut | Radius 3 circles centered at local `[50, 0]` on XY stations 0 and 10 |
| Sweep Cut | Radius 3 circle centered at local `[50, 0]` on YZ, with an XY rail from `[0, 50]` to `[10, 50]` |
| Boolean Cut | Independent radius 3 cylinder centered at XY `[50, 0]`, depth 10 |
| Contained Join | Radius 3 circle centered at XY `[0, 0]`, depth 5 wholly inside the stock |

### Cut-family extension verification

Loft, Sweep and Boolean Cut now call the same `cutCadKernelConfirmedMaterial` wrapper. No second material algorithm was added. The extension's first real-native run had **15 failures and 3 passing analytic-removal cases**: six disjoint/tangent cases lacked a diagnostic, three complete-erasure cases lacked the specific `cut-erased` result, and six interruption cases lacked the mandatory Common stage or its ownership evidence.

The current focused run passed **98 tests in 5 files**, 6.85 seconds: `cadKernelCutFamilies.test.ts` (18), `cadKernelDistanceCut.test.ts` (21), `cadKernelLoft.test.ts`, `cadKernelSweep.test.ts` and the concurrently repaired `cadKernelRuntime.test.ts` (12). The new family cases retain an unrelated 2,000 mm³ solid in every scenario. Valid circle-section Loft and Boolean tools remove `90π mm³`; the straight circular Sweep removes `45π mm³`. Sections show the exact hole, STEP reimports both surviving solids with the independently expected total material, and only the successful Cut's operands are consumed. No-effect and erased operations retain every preceding body.

Interruption tests use actual native shapes and inject a failure at Common or Cut. Failed Loft/Sweep operations release their generated tools and Common temporaries. Failed Boolean operations keep both accepted borrowed native bodies usable; Common and rejected results are still released. Caller document bytes remain unchanged. Join and Boolean union/intersection branches retain their existing behavior.

An independent source review of the runtime query transaction repair found no actionable ownership defect. Section arguments are parsed before initialization or reconstruction. Metadata-only failed queries retain the accepted full-document key. Geometry-changing section/export queries build a separate candidate, dispose it on failure and preserve accepted native shapes and picks. A successful query adopts the new model/key and then disposes the prior model. Its 12 real-native regressions passed in the combined run above, including failed section/export retention and explicit Build adoption. This extension made no runtime source or test edits.

The final integration run added existing Model and Pocket suites and passed **136 tests in 7 files**, 8.85 seconds. It covers all the family suites above, the original Boolean union/intersection behavior, and unchanged Through-all Pocket diagnostics and cap precision. The app no-emit type check and scoped whitespace check also pass.

Wholly contained Join policy remains explicitly deferred; deliberate parametric unions may need a different feedback policy. Region selection, general constraint solving, depth handles, UI layout and other new feature kinds were not added by this work. The all-family saved-history compatibility warning must be carried into the public release/PR record by the root task.
