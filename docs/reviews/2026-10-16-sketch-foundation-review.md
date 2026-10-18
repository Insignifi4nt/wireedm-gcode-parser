# Sketch graph and preparation checkpoint review

Reviewed the local working tree on 16 October 2026 against the graph-first constraint integration plan. This is a bounded foundation review, not acceptance of complete sketch mode.

The reviewed production seams were `cadSketchGraph`, `cadSketchGraphGeometry`, `compileCadSketchGeometry`, the document parser and edit reduction, parameter traversal, graph region references, `cadEditPreparation`, `CadSession.editPrepared`, the sketch worker protocol/runtime/client, and `useCadController.edit`. The active form migration and feature-preview implementation were excluded while their owner was changing them. The storage preservation implementation was authored by this reviewer earlier and is reported as tested implementation, not independent storage review.

## Confirmed finding, resolved

**P2: caller-owned edits could change after validation but before lazy solver initialization.** `useCadController.edit` validated its argument immediately, then its preparation callback awaited the solver client before calling `prepareCadEdits`. That function captured the edits only after the await. A caller could therefore change an edit object or append another edit after submission, and the accepted document would contain that later intent. The existing preparation capture test began its delay inside `solver.solve`, after the vulnerable interval.

Reproduced through the actual mounted controller: submit a rename on a graph document, immediately mutate that rename and append a parameter edit, then await completion. Before the fix the accepted name was the mutated name. The committed operation therefore differed from the reviewed submission even though version and workflow checks passed.

The fix captures a structured clone immediately after complete edit validation. Preparation detection and both synchronous and asynchronous edit paths consume that captured batch. A regression in `useCadController.test.tsx` exercises the first lazy initialization and an already initialized client; neither the mutated rename nor appended parameter enters the accepted document. This test failed before the fix and passes afterward.

## Foundation checks

- The graph parser preserves source IDs and scalar text, validates ownership/references, and does not solve on load. Graph-bearing documents require schema 2; newly created and ordinary legacy documents retain schema 1.
- The material compiler uses graph point identities without proximity healing. It preserves oriented source-edge references across array reorder and withholds open, branched, crossing and overlapping graph candidates from simple closed-cell material. Existing region references include graph cycles and reject a split instead of silently retargeting a selected area.
- Parameter traversal includes point coordinates, circle radii and driving relation values. Renaming uses the existing token-aware scalar operation rather than rewriting source text or evaluating expressions into numbers.
- Preparation reduces intent before solving, preserves ordered point drags against the preceding solved candidate, and runs complete document acceptance after solver output. Session acceptance commits one history entry and rechecks cancellation, accepted version, workflow revision, part identity and the controller's workspace/storage assertion.
- The worker boundary compares output topology, relations and expression drivers with the captured request and independently checks graph residuals. Cancellation terminates active native work; timeout/disposal/late-reply tests cover worker replacement and bounded queued work.
- Exact pre-upgrade save preservation uses the existing shared file journal and is covered on cache and folder adapters, including interruption, retry, conflict, quota and cleanup failure. No migration occurs during read or rename.

No additional reproducible correctness or data-integrity finding was established in this bounded review after the input-capture repair.

## Evidence and remaining acceptance

The controller/session/preparation group passed **138 cases**. Graph/compiler/document and native solver/client groups passed **27 cases**. The prior storage checkpoint passed **84 cases** on both adapters. Tests were selected for geometry, captured intent, accepted state, lifetime and data preservation; no copy or source-text assertions were added. The new regression uses a solver transport substitute because the assertion is specifically at the controller's asynchronous ownership boundary; the separate runtime suites execute the real native solver.

The known eight oblique-arc precision rejections remain recorded in the solver reference; this review does not relax their checks. General planar arrangement, topology editing and the full graph drawing/selection/relation workflow remain pending work in the checklist, not new findings against this foundation. Final browser interaction, active-form/preview ownership and complete part-building acceptance still require their own completed implementation and review. This document does not authorize a push, merge or deployment.
