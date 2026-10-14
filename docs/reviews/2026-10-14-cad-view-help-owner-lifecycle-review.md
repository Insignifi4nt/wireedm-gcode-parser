# CAD View drawer help ownership review

Reviewed checkpoint: `8375c294d09e0a43b48b7c37d977cc59fd9a4065`, Node 24.22.0. This is a private implementation record; the broader CAD work remains active.

## Resolved suspicion

The compact CUA DOM snapshot listed closed View controls. Root inspected their actual attributes: the View toggle had `aria-expanded="false"`; its controlled drawer had `inert` and `aria-hidden="true"`; the select had `aria-label="Named view"`. Current source also supplies contextual labels for the fit, grid, snapping, and spacing controls. The compact snapshot does not establish an accessibility defect. No control-label or hidden-control workaround was added.

Current source and focused existing tests show an out-of-flow dock and inspector, non-interactive overlay wrappers with interactive descendants, SVG/canvas-owned pointer handlers, retained viewport mounting, and explicit Fit calculations that account for overlay occlusion. No separate pointer-stealing or layout-shifting defect was reproduced in this review. These checks do not replace actual browser layout or keyboard verification.

## Proven defect and red evidence

`CadContextHelp` pins a nonmodal popup into `document.body`. `CadCommandDock` intentionally keeps its View controls mounted while making the drawer inert. Consequently, keyboard-pinning Model navigation help and closing View from its toggle left the help popup visible and focusable outside the inert drawer.

Before product edits, three formal real-component tests failed: solid help pin/close/reopen, sketch help pin/close/reopen, and a pending hover-dismiss timer during owner closure. Log: `tmp/cad-view-owner-help-red-node24.log` (3 failures, 4 skipped).

Root independently reproduced the production gesture through CUA. The View drawer had a zero-height rectangle and was hidden, while the body-portaled help retained a visible 288 × 104.5 rectangle. Screenshot inspected by this reviewer: `C:/Users/cristian/code/Wire_EDM/tmp/cad-node24-orphan-navigation-help-closed.png`. Root then closed the popup, restored the collapsed View state, and preserved the blank draft; this agent did not operate the browser.

## Scoped repair

`CadCommandDock` passes its disclosure state to `CadViewTools`; that component supplies a visibility context only around its controls. Unrelated canvas/tree/inspector help inside the broader dock provider remains independent, and standalone controls default to visible.

`CadContextHelp` renders and attaches popup behavior only when both its local disclosure and its owner are visible. Hiding its View owner clears pending hover dismissal, resets pin/keyboard state, reports closure once, and suppresses the portal immediately. It leaves focus with the View toggle rather than restoring focus to the hidden help trigger. A hidden retained trigger cannot reopen the popup. Reopening View permits fresh hover or keyboard help interaction.

No view control or viewport is unmounted by this repair. CSS, camera/navigation state, document edits, rendering/native state, schemas, storage, and agent APIs are unchanged. No global visibility observer or hidden-DOM scan was introduced.

## Verification

Under the required Node 24.22.0 toolchain:

- `CadCommandDock.test.tsx` and unchanged `CadContextHelp.test.tsx`: 10 passed before adding the final independent-canvas-help regression.
- Final focused five-file UI gate: 18 passed, 111 intentionally skipped across dock, contextual help, Workbench, solid viewport, and sketch canvas. Log: `tmp/cad-view-owner-help-green-node24.log`.
- New regressions verify both solid/sketch help lifecycle, exact grid element identity and retained edited state, one mount/no unmount, focus staying on View, exact disclosure callbacks, refusal of hidden activation, reopening, hover-timer cancellation, and unrelated canvas help plus Escape focus restoration while View is collapsed.
- `npx.cmd tsc -b --pretty false`: clean; log `tmp/cad-view-owner-help-tsc-node24.log`.
- `git diff --check`: clean.

The new source has not been bundled or exercised in the production browser by this agent. Root owns the fresh build/browser proof and independent review gate. The already-running checkpoint CI does not certify this uncommitted fix.

## Frozen SHA-256

| File | SHA-256 |
| --- | --- |
| `src/features/cad/CadCommandDock.tsx` | `E16B3DA10032756EB795866C404A95CE65965F0E33F77B166BAE26757EA81C53` |
| `src/features/cad/CadContextHelp.tsx` | `5FDB914F46230A88A5617B2321AD60F3CFFDBFB3C0A17CB5773C920BDB38EF6D` |
| `src/features/cad/CadCommandDock.test.tsx` | `B4128E3685C741616FDE054FEB4065FB1250E639C882011F8476035E93205D2D` |
| unchanged `src/features/cad/CadContextHelp.test.tsx` | `A256C31B18BFEB0951591B6AA3D5524D5E849A2B7D51714746EEA65EDE6955DD` |
| unchanged `src/features/cad/cad-command-dock.css` | `6F04ABAAC80D38AE56ADDF06156A6F20F20164F33D159D7650518BDEE5B4F816` |
