# Direct circle interaction review

Local work after `4fd7dee`, without remote changes. Root owns the shared gesture integration; an independent reviewer owns the source helper and reviews the gesture paths. This is a bounded S07 interaction, not completion of the sketch goal.

## Source and interaction

`cadSketchGraphCircleControl` resolves an exact circle, its center and current radius without using a global freedom count as proof of local mobility. String radii, radial dimensions and equal-radius relations retain ownership, including an unchanged requested size. The complete-feature edit changes only the eligible numeric radius and reuses current numeric validation; it does not add a new extent cap. Exact points, expressions, relations, other entities and legacy profiles stay intact. Fifteen red-first interaction cases pass, including invalid bounds and exact DXF preservation.

The graph layer extends its existing gesture owner with a discriminated radius intent. Point movement keeps its original operation. Radius preview and commit use the same guarded full-feature update, shared prepared preview, submission and cancellation. Center/source/version/frame and selection filters participate in capture identity. Geometry is unchanged until acceptance, and a no-op adds no edit. Radius distance uses the captured center and true rim; grid rounding and Ctrl/Cmd suppression apply at release. Keyboard sizing shares the same operation. Expression and explicit size owners cannot be bypassed through the grip.

## Independent findings and repairs

Two meaningful regressions reproduced before their fixes (`tmp/sketch-circle-radius-review-red.log`):

- After a prepared radius-10 preview, returning to the original radius 5 could leave the cached radius-10 geometry painted until release. Clearing the cached document when no edit remains restores source geometry immediately while keeping the current gesture owned.
- A small circle's radius hit area could cover its center. Its grip now has a minimum screen offset and a noninteractive leader; the point and size hit areas stay separate. The captured geometric origin stays on the true circle, so offsetting the affordance does not alter requested radius. The regression checks independent center movement and radius 1-to-6 sizing.

The reviewed helper/gesture group passes 47 cases; scoped semantic/syntax TypeScript passes for the three reviewed paths (`tmp/sketch-circle-radius-review-focused.log`, `tmp/sketch-circle-radius-review-types.log`). Root's earlier related picking/coordinate group passed 65 before the added small-circle case. Equality guidance now directs the user to a radial dimension rather than suggesting they discard equality; no copy assertion was added.

No other concrete issue was found in the bounded review of source ownership, nonlinear distance/grid/modifier behavior, selection, capture loss, stale edits, preview/commit equivalence or the written production journey. General arc sizing and direct equality-linked dragging remain outside this slice; explicit dimensions continue to control linked size. No native settings, source correction, persisted schema or installed machine/post change.

## Root production follow-up

The first actual circle journey resized correctly, but releasing the pointer after Escape cleared selection and hid the grip, timing out at its second resize attempt. The graph handle had stopped pointer-down propagation, leaving the canvas unaware that the later empty-canvas click belonged to that cancelled gesture. Canvas pointer capture now marks graph starts through its existing click-suppression owner; normal canvas starts still reset that flag. The unchanged journey passes after this four-line ownership fix (`tmp/sketch-circle-radius-journey.log`), including exact source preservation, Cancel, Undo, equivalent agent feature update, keyboard sizing, explicit radial ownership, native extrusion and save/reopen. The related Canvas/Layer/source/coordinate group passes 92 cases (`tmp/sketch-circle-radius-canvas-followup.log`).

Native in-app proof separately dragged radius 5 to 10 around exact ` centerX ` / `0.00` source coordinates. Undo plus the guarded agent full-feature update reproduces the human result structurally. Applying Ø16 retains those exact coordinates, sets radius 8, marks the free grip unavailable and reports fully constrained. A 5 mm Pad builds one native solid, 1005.309649148734 mm³, without diagnostics. Undoing the Pad, dimension and resize restores each complete expected source; the final seed Undo restores an empty draft with no parameters, workflow or Undo entry. No user record was saved. Proof: `tmp/sketch-circle-radius.png`, `tmp/sketch-circle-radius-solid.png`.

Full production build/TypeScript, public documentation/source distributions, shared UI and icon integration checks pass. All 24 production sketch/region journeys pass in both Chromium and Firefox against the same final build (`tmp/sketch-circle-radius-final-{chromium,firefox}.log`). No remaining concrete finding is open in this bounded slice. Local checkpoint only; no push, PR, merge or deployment. The wider sketch goal remains active.
