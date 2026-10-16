# Sketch freedom and conflict feedback

Internal implementation plan, 2026-10-16. Static review at `9fdee5c45fa654a469dbcdd5b2dfb7a84bb8ebe5`, including the installed `@salusoft89/planegcs@1.3.0` declarations and its pinned source. No production changes, solver probes, builds or new test campaign were performed.

## Decision

The published solver interface cannot give accurate per-point freedom. Correct the current affordance by distinguishing known fixed coordinates, a current whole-sketch zero-DOF observation, and unknown point freedom. Keep actual requested movement on the existing prepared solve path. Do not label every numeric point draggable because the sketch has some unrelated freedom.

Preserve structured rejection data through preparation and preview. Render relation/entity/point labels for humans, while tools receive exact IDs in bounded structured details. Do not recover diagnostic identity by parsing message text.

## What the pinned solver actually exposes

| Evidence | Consequence |
| --- | --- |
| Published `GcsSystem` declares global `dof()`, explicit `get_is_fixed(index)`, and conflict/redundancy tag queries. `GcsWrapper` adds ID mapping, not point mobility analysis. [Installed declaration](../../node_modules/@salusoft89/planegcs/dist/planegcs_dist/gcs_system.d.ts), [wrapper declaration](../../node_modules/@salusoft89/planegcs/dist/sketch/gcs_wrapper.d.ts) | There is no supported JavaScript getter for per-point DOF, a Jacobian/nullspace, dependent-coordinate groups or subsystem freedom. |
| The binding's `get_is_fixed` returns the boolean supplied when a parameter was inserted or set. Its solve loop excludes those explicit fixed parameters from the unknown list. The Embind export list contains no dependent-parameter getters. [Pinned binding source](https://github.com/Salusoft89/planegcs/blob/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/build-bindings/templates/gcs_system.cpp.njk) | It cannot detect B fixed indirectly by horizontal plus distance to driven A. Casting an undeclared getter into existence would not expose it. |
| Copied native `GCS::System` has `getDependentParams`, `getDependentParamsGroups`, `isEmptyDiagnoseMatrix` and diagnosis invalidation. A DOF query returns `-1` without a current diagnosis. [Pinned core header](https://github.com/Salusoft89/planegcs/blob/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/planegcs/GCS.h) | Richer information exists below the shipped interface. Reaching it requires a deliberate wrapper/native build and distribution update, not an app-only accessor. |

The core computes dependency groups using QR and a numerical coefficient cutoff. A group includes a nonpivot variable and pivot variables coupled to it. This is local linearized participation, not an exact per-point count of independent motion directions. Two coordinate memberships do not prove two independent freedoms. An empty driving matrix needs separate handling, and diagnosis occurs during solution initialization. A future binding must establish freshness at accepted coordinates rather than assume that reading a list after `apply_solution` refreshes it. [Pinned core implementation](https://github.com/Salusoft89/planegcs/blob/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/planegcs/GCS.cpp)

The exact package/core pairing and existing provenance limits remain in the [source manifest](../../vendor/sketch-solver/planegcs-sources.json). This investigation proposes no toolchain work or change to the current binary.

## Small honest affordance change

`prepareCadSketchGraphInteraction` already documents `freeAxes` as explicit coordinate-driver checks. It is a write-permission mask, not a solver freedom result. GraphLayer currently combines that mask with positive global DOF and displays "Drag or use arrow keys". That misclassifies B in the reported A/B/C example. [Interaction](../../src/features/cad/cadSketchGraphInteraction.ts), [GraphLayer](../../src/features/cad/CadSketchGraphLayer.tsx)

Use a small pure presentation helper with these states, derived from the accepted source and its current analysis:

| State | Honest meaning and behavior |
| --- | --- |
| Explicit coordinates driven | Both axes have exact expression or fixed-coordinate drivers. Keep the point selectable and existing coordinate-write restrictions; explain those drivers. |
| Sketch reports no freedom | Current, successfully validated accepted-source analysis reports zero DOF. Keep selection available; retain the current movement guard. |
| Point freedom unknown | At least one numeric axis can be written, but no point-level diagnosis exists. Use neutral point styling and "Movement follows dimensions and relations" rather than a verified-free or locked claim. An intentional drag/arrow request still goes through ordinary temporary targets and the unchanged acceptance checks. |

One explicitly driven axis remains visibly driven even when the other axis has unknown mobility. Keep that axis mask separate from movement classification. `CadSketchConstraintStatus` already publishes freedom only for a matching document/version/sketch and solved analysis; reuse that observation and ownership. Missing, stale, failed or rejected analysis must not become zero. [Status ownership](../../src/features/cad/CadSketchConstraintStatus.tsx), [runtime writeback](../../src/features/cad/sketch-solver/cadSketchSolverRuntime.ts)

If a requested move succeeds with unchanged geometry, explain that this target was constrained. Do not cache "point fixed" from one no-op: a permitted motion may be perpendicular to that target, and temporary targets are soft solver preferences. Likewise, unchanged coordinates after an ordinary solve say nothing about available movement.

Avoid a growing symbolic imitation of the solver, per-point test drags, component-by-component extra solves, finite differences or a JavaScript Jacobian decomposition for this affordance. They add another interpretation of constraints and singular cases. With the current binary, exact indirect point classification is unavailable. If the product later requires it, add one pinned native observation after ordinary accepted-source analysis, map returned parameter indices through the existing point index/offset table, extend worker schema validation, and retain source-version invalidation. First prove its empty-matrix, coupled-motion and singularity semantics on a few real fixtures. Do not promise exact one-versus-two point DOF or independent Cartesian dragging from membership flags alone.

## Where conflict structure is lost

1. Runtime returns typed `conflictingIds`, `redundantIds`, `partiallyRedundantIds` and independent graph issues. IDs already map to application sources. Implicit arc equal-radius constraints map to an entity ID; temporary drag constraints can map to a point ID. They are not all relations. [Runtime](../../src/features/cad/sketch-solver/cadSketchSolverRuntime.ts), [diagnostic types](../../src/features/cad/sketch-solver/cadSketchSolverTypes.ts)
2. `prepareCadEdits` concatenates these IDs into `CadError.message` under `Relations:`. It drops typed rejection context on that failure path. [Preparation](../../src/features/cad/cadEditPreparation.ts)
3. `useCadPreparedPreview`, RelationsPanel and GraphLayer retain only an error string for display. `cadSiteTools` converts `CadError` to `ToolError` with code/message only, although the tool transport already supports bounded details. [Preview](../../src/features/cad/useCadPreparedPreview.ts), [panel](../../src/features/cad/CadSketchRelationsPanel.tsx), [tool adapter](../../src/features/cad/cadSiteTools.ts), [transport](../../src/features/webmcp/siteTools.ts)

## Structure-preserving implementation

Add one feature-owned `CadSketchPreparationError extends CadError` carrying a frozen rejection record: sketch ID, rejection reason, diagnostics and source subjects. Keep existing `sketch-*` error codes. Construct it where preparation still has the failing candidate graph, including newly proposed relations and generated corner entities. This avoids looking up an attempted relation only in the accepted document, where it may not exist.

Use one pure graph presenter to classify each source ID as relation, entity or point and attach operand IDs through the existing reference helpers. It can return compact subjects such as:

```ts
{ source: { kind: 'relation', id }, category: 'conflicting',
  label: 'Distance between Point 2 and Point 4', pointIds: [...], entityIds: [...] }
```

Labels are transient descriptions of that exact graph. Reuse the same point/entity ordinals as the canvas, relation kind and formatted current quantity where useful. Keep IDs as action keys and machine fields; do not persist display ordinals as references. Duplicate relations need a local relation ordinal or quantity to distinguish their labels. Existing relation buttons' accessible names should use this presenter instead of raw UUIDs too. [Reference helpers](../../src/domain/cad/cadSketchGraphReferences.ts), [current inspector labels](../../src/features/cad/CadSketchRelationsPanel.tsx)

Give implicit entities labels such as "Arc 3 endpoint radius" and temporary targets "Move Point 2". Keep conflict, redundancy, native failure and independent invalid-solution issues distinct. A residual issue retains its source, code and residual; it is not recast as a contradictory dimension. Never invent a missing opposing relation when the native report identifies only one subject.

Retain this record in the error arm of `useCadPreparedPreview` and in Apply rejection handling. Render a short human summary plus bounded clickable subjects. Inspecting a subject highlights its exact operands using existing relation/selection callbacks; it never removes a relation or replaces the pending value. Escape/Cancel and late-result/source guards remain unchanged. A source change dismisses the old feedback rather than resolving its IDs against a new graph.

At the tool adapter, special-case this typed error before generic `CadError` conversion. Pass exact source IDs, categories, issue codes and counts through `ToolError.details`, using existing diagnostic summarization/budget conventions with explicit omitted counts. The human message stays readable. Do not expose candidate graphs, native pointers or library insertion tags, and do not add another top-level tool. [Existing summary helpers](../../src/features/cad/cadSketchConstraintInspection.ts), [tool details budget](../../src/features/webmcp/siteTools.ts)

## Bounded implementation and acceptance

Root should own GraphLayer/RelationsPanel/status wiring. A separable pure feedback module can own point-state presentation and source labels; preparation/error/preview/tool changes should have one owner so typed information is not flattened at an intermediate seam. No document schema, storage, relation equations, solver thresholds or native package change is needed for the immediate improvement.

Use a few focused checks when implemented:

- A is driven, B is fixed indirectly by H/V plus distance, and unrelated C remains free. B is selectable without a verified-free claim; C's existence cannot establish B's freedom. Explicit mixed-axis drivers still restrict only their owned coordinate.
- Current zero DOF, unknown diagnosis and stale analysis produce distinct feedback. No extra solve is launched by hovering or moving the pointer.
- A proposed conflicting distance is absent from the accepted graph but still gets the correct candidate-operand label and inspectable IDs. Accepted geometry, pending exact text and history remain intact.
- Structural arc and temporary point-target failures are labelled by their actual source kind. Redundant and residual failures retain their categories.
- Preview, Apply and tool execution preserve the same rejection record; human/accessible labels omit raw UUIDs, while bounded tool details retain IDs and omission counts.
- Source switch or cancellation removes old feedback and prevents late completion from highlighting or changing the new document.

These are proposed checks, not newly executed tests. Accurate native point mobility remains a separate, explicitly packaged capability if neutral feedback is insufficient.
