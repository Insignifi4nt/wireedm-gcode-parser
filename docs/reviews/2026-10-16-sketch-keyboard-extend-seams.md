# Keyboard-owned line Extend seams

2026-10-16 · read-only plan against `aeb61d3`. This is a proposed next slice after drawing ambiguity acceptance; implementation has not started. No production/test edits, probes, tests, package commands or builds were run for this plan.

## Existing behavior and gap

`CadSketchCanvas.tsx` handles ContextMenu and Shift+F10 and reads the focused SVG `data-cad-sketch-entity` / `data-cad-sketch-point`. It projects the source geometry's start point only to anchor the menu. `openOverlap(..., 'keyboard')` then performs a screen pick and deliberately leaves `target` unset, so keyboard invocation offers selection rows without boundary edits. That preserves Split/Trim's need for an actual pointer location, but also withholds Extend even though its source intent needs only a line ID and explicit end.

`CadSketchBoundaryPreview.tsx` already separates preview from commit. Its pointer Extend helper projects the cursor to choose start/end, rejects the exact midpoint, calls `prepareCadSketchLineExtend`, and allocates the submitted endpoint ID once. The domain query already accepts `{ graph, parameters, entityId, end: 'start' | 'end' }`. It supplies the exact analytic added segment, finite boundary, witness and endpoint-reuse information. No geometric algorithm, domain edit, public tool, schema or new controller route is required.

`CadContextMenu.tsx` already supplies focus traversal, activation, disabled reasons, Escape/Tab/outside/blur dismissal and focus restoration. `CadSketchCanvas` already owns immutable boundary previews, accepted-source/version/frame/filter pins and async submission cancellation. Reuse those mechanisms.

## Smallest implementation

1. Factor only the existing query/allocation/error block into a feature-local `prepareCadSketchExtendEndPreview(prepared, sketchId, entityId, end)` helper. Keep the pointer helper's current signature, nearest-end decision and midpoint rejection, then delegate. This is factoring the existing feature boundary, not a new authoring API. Both paths use the same dependency labels, endpoint contact help, strict query and exact submitted witness.
2. Pass the focused entity ID explicitly from the keyboard handler into the existing menu-opening owner. Resolve that ID against the current prepared graph and require a line. A projected source point may position the menu and measure its screen frame; it must never select an end, derive a cut parameter, or replace the focused entity with a coincident screen hit. Do not infer an edge from a focused point, multiple selection, or canvas background. Preserve the existing chooser/legacy fallback where no eligible focused edge exists, and preserve lock/preview/filter guards (`points` does not enable an edge action).
3. On the owned focused line, prepare two alternatives once: **Extend start** and **Extend end**, each with its real query result or dependency/no-boundary reason. They refer to the source line's start/end IDs, not screen-left/right. Keep Split/Trim unavailable in this keyboard path: there is no owned pointer parameter. Pointer invocation continues its existing single-end behavior and Split/Trim preview.
4. Keep one menu owner. Store the prepared Extend alternatives in a small readonly end-keyed list on that owner; store only the active action/end discriminator and derive the displayed preview from it. Do not copy a second active preview or introduce another pending/submission state. Focus/hover changes the displayed analytic preview; activation submits the stored edit through the existing `onEditMany` and `submitEdit` path. IDs are allocated once per prepared alternative, never on focus or activation. Reopening the menu is a new intent and may allocate new IDs.

The existing pointer owner can retain its single prepared result. A narrow shared menu-item/submit closure may remove duplication between the one pointer option and two keyboard options; avoid a generic action framework. An explicit end value must remain typed data, never parsed from the human label.

## Ownership and capture contract

The keyboard owner must retain the same prepared graph, document identity, version, cancel signal, pick filter and spatial frame pins as pointer boundary edits. Check them before activation; retain the captured owner and existing AbortSignal during submission. Source replacement, external lock, preview mode, tool/filter changes and frame changes invalidate the owner through the current guards. Late completion must not select a new endpoint after cancellation or select an endpoint belonging to another owner. Menu dismissal before submission performs no edit; the menu's synchronous close-before-callback behavior must continue to submit its captured valid owner rather than rely on newly cleared React state.

Include the end alternatives and active end in Canvas's existing view/capture identity, just as current `split`, `trim`, `extend` and `action` participate. A keyboard focus change between the two options changes the rendered preview/capture revision without changing the source document. Keep existing pending reporting, endpoint selection after accepted completion and menu focus restoration. No parallel selection state is needed.

Unavailable alternatives show the domain reason; do not invent a distant boundary or silently switch to the other end. Source dependency rules, declared endpoint reuse, one-time numeric interior contact, whole-candidate solver certification, consumed-area repair and one accepted Undo remain exactly the existing Extend operation's responsibility. Hosted agents already own the equivalent explicit-end witness through the existing inspection/proposal/edit flow; no agent API addition is needed.

## Two meaningful red-first cases

1. **Focused identity and explicit choice.** Focus an actual line overlapping another edge, invoke ContextMenu, and verify the two end options use that line ID even where a screen pick is ambiguous. Give the ends different finite boundaries. Keyboard focus changes the analytic preview without editing; activating one option submits exactly its shown witness and stable endpoint ID once, then selects the accepted endpoint. Verify no Split/Trim edit is offered from the synthetic visual anchor. A real no-boundary end can be disabled with its existing reason; do not add a separate label-presence test.
2. **Cancel and late ownership.** Invoke Shift+F10 on the line, preview an end, Escape, and verify no edit plus restored focus. Reopen, activate with deferred completion, then change the accepted source/version (or the existing tested frame boundary). Verify the submission aborts and its late completion cannot select an endpoint or leave a pending preview. Reuse the current deferred-edit test helpers; do not repeat the entire already-tested pointer cancellation matrix.

Keep existing pointer midpoint, exact preview/submit and Split/Trim tests green. After localized tests, run relevant scoped types; root owns later build and browser proof. A subsequent actual keyboard browser check can use the same focused line and menu workflow rather than another geometry journey.

## Files, size and limits

- `src/features/cad/CadSketchBoundaryPreview.tsx`: about 10–20 net lines to factor explicit-end preparation; no domain changes.
- `src/features/cad/CadSketchCanvas.tsx`: about 35–60 net lines for focused-ID ownership, two alternatives, active-preview derivation and capture fields. Coordinate ownership after the drawing chooser freezes.
- `src/features/cad/CadSketchCanvas.test.tsx`: two behavior cases using actual keyboard events/deferred completion; likely 70–100 lines with current helpers.
- `CadContextMenu.tsx`, operations, preparation, solver, schema and public tool contracts should need no changes.

This plan enables keyboard-owned line Extend only. It does not make Split/Trim location-independent, extend arcs/circles, bypass blockers, create persistent cutter constraints or add a new selection/geometry system. Estimates are implementation bounds, not measured patch sizes.
