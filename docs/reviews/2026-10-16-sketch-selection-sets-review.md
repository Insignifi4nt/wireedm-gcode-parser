# Sketch selection set UI review

Independent source review of `CadWorkbench.tsx`, `CadSketchGraphLayer.tsx` and `CadSketchCanvas.tsx` against `92b1ba1`, including their current uncommitted changes. The shared selection helpers and viewport API were authored by this reviewer and are excluded from the independent review. The relation panel has a separate reviewer. The initial review was read-only; the follow-up below was authorized and implemented by the same reviewer. No build or browser run was performed for this review.

## Findings

One selection cleanup issue was found and fixed. No unresolved actionable issue remains within this bounded slice.

Workbench originally derived `graphSelections` by reconciling the stored set against the current graph, without pruning `graphPick`. A focused regression selected `[a,b]`, externally deleted `b` and its incident edge, and recreated `b` at different coordinates. The removed target became selected again. This was reproduced red before the fix. The same dormant identity could return after Undo.

Workbench now canonicalizes its existing selection owner in a layout effect only when reconciliation returns a different array. The functional updater checks the exact captured owner, so it cannot overwrite a newer selection published by an accepted creation callback. The regression now remains `[a]` after deletion, ID reuse and Undo; cleanup adds no document or history mutation.

## Reviewed guarantees

- Shift pointer and keyboard selection reach the additive callback before any point-drag ownership. Plain clicks collapse a multiple selection without implicitly moving one member; arrow keys cannot move an implicit member of a set.
- Graph events contain their pointer/click/key routing, so they do not also select a legacy closed profile. Legacy profile selection clears graph selection through the existing owner.
- Pending fields and submissions lock canvas interaction and agent viewport operations. A graph drag publishes pending ownership before invoking preparation. Source changes and cancellation dispose an existing graph gesture and preview.
- Delete groups selected point/entity IDs into one existing domain edit with the declared cascade policy. Construction changes target the entire entity-only set; a set containing points cannot silently convert its entity subset.
- The accepted creation callbacks can select newly created IDs before their initiating render receives the updated graph. The removed eager graph-membership check avoids rejecting a successful creation or retaining its workflow lock. Strict agent validation remains at the viewport boundary.
- One ordered set feeds graph highlighting, the relation inspector and viewport state. Capture identity includes secondary targets and selection order. Selection changes do not add geometry or saved history.

The root reported 114 focused UI cases passing before this review. After the cleanup fix, this reviewer ran six focused Workbench cases covering deleted-ID reuse and Undo, grouped construction/deletion, fresh rectangle and polygon selection, deferred drawing acceptance, and a subsequent toolbar dimension. All six passed. The drawing cases explicitly retain the accepted new edge selection, including across a deferred operation's source publication. This is not an independent rerun of the full suite or completion of the pending native/browser checkpoint.

## Root acceptance

The final production build, documentation/source distributions, app typecheck and shared-control check pass. The new test fixture initially failed TypeScript narrowing inside its async callback; the same owner captured the narrowed graph before the callback and reran the regression and typecheck successfully.

All 13 production sketch/region journeys pass in Chromium and Firefox, using the frozen completed build. The pair journey covers human Shift selection, horizontal alignment, numeric Cancel, exact linked-distance Apply, native conflict rejection without removing prior constraints, reverse-order public set selection and one Undo. The other journeys retain drawing, legacy grips, corners, consumed-sketch editing, deliberate consumer-area repair, extrusion, export and Save/reopen coverage. Logs: `tmp/sketch-multiselect-all-chromium.log` and `tmp/sketch-multiselect-all-firefox.log`.

The native in-app browser independently selected two points, accepted horizontal alignment and distance expression ` spacing `, retained exact anchor drivers ` 0 `, and kept the unrelated third point unchanged. Adding Vertical rejected; Apply remained disabled. Cancel retained the exact accepted feature. One public Undo restored only the preceding horizontal relation and original aligned coordinates. The disposable unsaved tab was closed. Visual proof: `tmp/sketch-point-pair-distance.png`.

This does not complete spatial selection or sketch mode. Box/filter/overlap behavior remains the next slice. Native inspection also showed that a point fixed indirectly by relations can still advertise dragging when another point keeps the graph globally free; per-point freedom affordances remain open. Human conflict messages currently expose raw relation IDs and need useful operand labels while preserving exact diagnostic identities for agents. No saved format, installed machine/post behavior or remote state changed.

The subsequent app typecheck caught lost optional-property narrowing inside the new regression's asynchronous callback. The fixture now captures its explicitly guarded graph in a local constant. The focused regression passed again, and `npx tsc -p tsconfig.app.json --noEmit` completed successfully. Production behavior was unchanged by this fixture repair.
