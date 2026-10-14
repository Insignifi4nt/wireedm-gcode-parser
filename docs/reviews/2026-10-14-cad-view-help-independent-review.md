# Independent View help lifecycle review

Date: 2026-10-14. Baseline: `8375c294d09e0a43b48b7c37d977cc59fd9a4065`. Scope: the frozen `CadCommandDock.tsx`, `CadContextHelp.tsx` and `CadCommandDock.test.tsx` change, their actual solid/sketch consumers and existing disclosure/camera/draft regressions. No production, test, server, browser, package or public-document changes were made by this reviewer; only this private record was written.

## Result

No actionable finding. View-owned help now closes with the View drawer while its controls remain mounted. Unrelated canvas/standalone help keeps its existing behavior. The new context and lifecycle checks preserve focus, pending CAD edits and viewport state. This is a source-hashed independent review and focused Node 24 gate; the root's fresh production build and real keyboard/browser verification remain separate.

Root supplied real pre-fix evidence from the previous production bundle: View was collapsed (`aria-expanded=false`, `aria-hidden=true`, zero drawer height), while its body-portaled navigation help remained visible at 288 × 104.5 pixels. That proves the owner-lifecycle defect rather than a hidden-control listing in a compact DOM snapshot. This reviewer did not operate the browser or claim the old screenshot certifies the new bundle.

## Scoped ownership and portal behavior

`CadCommandDock` adds disclosure state to its existing host context. `CadViewTools` wraps only its own controls in a separate boolean visibility provider, with a true default for standalone use. The provider is part of the controls' React tree before their host portal is created; descendants therefore retain that visibility context when `CadContextHelp` creates its own body/dialog portal. This relies on React context ancestry, not the popup's physical DOM location or an inert-ancestor scan.

The broader dock provider alone does not hide help. Canvas, tree or inspector help outside `CadViewTools` continues to see the visible default. The actual Model and Sketch navigation helpers are inside their respective `CadViewTools` controls and receive the owner state. The context adds no DOM wrapper and no storage/schema/agent operation. Its import path has no module cycle: the dock does not import contextual help.

The controls' portal host and child identities remain the same across disclosure changes. Only context values and hidden state update; the viewport/camera, grid controls and CAD editor are not conditionally replaced. The mount/identity regressions verify one mount, no unmount and the exact same edited grid element after closure/reopening. No new Fit or navigation operation is triggered by this visibility change.

## Lifecycle, focus and event state

The displayed popup and its ARIA expansion/control relation now depend on `open && ownerVisible`. Owner closure therefore removes the body portal during the render/commit, independently of the later state reset. A layout effect clears the old hover timer, pin, keyboard-activation and suppression state and reports a genuine closure once. Hidden retained triggers cannot reactivate the portal through focus, hover or programmatic click.

Placement listeners are attached only while the popup is shown, with matching resize/scroll cleanup. Outside-pointer and Escape listeners likewise follow the shown state and retain their existing cleanup. Closing the View owner does not call contextual help's focus-restoration path, so focus remains on the View toggle rather than moving into hidden controls. Explicit help dismissal while visible still restores its own trigger focus and suppresses immediate preview reopening.

The retained close timer is cleared even if a prior leave event had already scheduled it. Reopening View begins with help unpinned; a new preview remains open beyond the previous timer's expiry. The unrelated canvas-help case remains open while View toggles and still handles its own Escape/focus restoration. Standalone contextual-help hover, keyboard pinning, outside dismissal and unmount cleanup continue to pass.

The existing View Escape handler still consumes the event locally before Workbench cancellation. Integration checks retain a pending Pad length of 27, the exact input element, accepted document/version and open workflow when Escape originates on either the View toggle or Fit control. Subsequent Apply accepts 27 in one history step and Undo restores the original document. Disclosure does not call Fit or remount the viewport.

## Independent verification

All executions used the installed Node **v24.22.0** binary. Focused results:

- Complete `CadCommandDock` and `CadContextHelp` suites: **11 passed**.
- Filtered `CadCommandDockIntegration`, `CadViewport` and `CadSketchCanvas` control/Fit/camera/occlusion checks: **25 passed**, unrelated cases skipped.
- The remaining Fit-origin pending-feature Escape case: **1 passed**.

Total: **37 distinct tests across five files**. The integration filter initially selected only the View-toggle variant, so the Fit-control variant was explicitly executed afterward; no assertions or timing thresholds were changed. Existing real solid/sketch Fit, capture identity, grid and inspector-occlusion behavior passed alongside the new help cases. No broad suite or native benchmark was repeated. Scoped whitespace checks passed; the owner separately reported TypeScript passing.

Implementation hashes match the owner's freeze and were rechecked after testing:

| File | SHA-256 |
| --- | --- |
| `src/features/cad/CadCommandDock.tsx` | `E16B3DA10032756EB795866C404A95CE65965F0E33F77B166BAE26757EA81C53` |
| `src/features/cad/CadContextHelp.tsx` | `5FDB914F46230A88A5617B2321AD60F3CFFDBFB3C0A17CB5773C920BDB38EF6D` |
| `src/features/cad/CadCommandDock.test.tsx` | `B4128E3685C741616FDE054FEB4065FB1250E639C882011F8476035E93205D2D` |
| `src/features/cad/CadContextHelp.test.tsx` | `A256C31B18BFEB0951591B6AA3D5524D5E849A2B7D51714746EEA65EDE6955DD` |
| `src/features/cad/CadCommandDockIntegration.test.tsx` | `EB04774CB4C1D89CB2594543A00C8FE743C99FF9E57DADAB86526E1846B452B5` |
| `src/features/cad/CadViewport.test.tsx` | `511704864D228747B26E479B2269A6DEE53DB88CAEC4341A8D9C9164721451E3` |
| `src/features/cad/CadSketchCanvas.test.tsx` | `9AB699CCF7D3C56AF3FEDE29AA581D9E4C95E971434CC8B39AF36099B46866AC` |
