# Sketch integration review

Review date: 2026-10-14. Fixed repository baseline: `c16a15eb9f9805622ccaeda5b39dc2698ddfda8c`. Scope: the current uncommitted analytic sketch constraint model, intent panel, dimension annotations, Workbench ownership and feature-tree interaction. Root and domain-owner corrections were landing during this review. This is a scoped review, not a final review of the complete worktree.

## Actionable findings

| Finding | Reproduction and affected code | Status at handoff |
| --- | --- | --- |
| P1: agent dimension editing silently removed a parameter binding | Rectangle width is `"width"`, parameter width is 20 and an explicit width dimension exists. Call `applyCadEdits` with `set-sketch-dimension`, value 30. Original result retained parameter 20 but replaced the width scalar with literal 30. Human dimension editing instead changed the shared parameter. `cadOperations.ts`, dimension edit branch; `cadSketchConstraints.ts`, scalar setter. | Domain owner repaired this. Independent direct rerun now returns parameter 30 and retains width `"width"`. Added owner regressions cover named diameter conversion, shared quantities, compound rejection and atomic invalidation. |
| P2: dock commands replayed on another tree profile | Start Dimension, Move or Fillet from the dock, then Apply or Cancel and select another profile in the tree. The retained command token was consumed again by the new keyed panel because its previous-token ref started at zero. Canvas selection cleared the token, tree selection did not. `CadWorkbench.tsx`, profile command state and tree selection callback; `CadSketchProfilePanel.tsx`, command effect. | Root added document/profile ownership, monotonic sequence numbers and explicit command consumption. Source correction reviewed; final integration regression remains root-owned. |
| P1: a pending Exact geometry draft could be hidden by Move | Select a polygon/path, expand Exact geometry and change a coordinate. Its editor reports pending, but the outer idle intent panel's Move button remained enabled because its lock omitted that sibling editor. Clicking Move unmounted the exact editor and discarded its unfinished draft. `CadWorkbench.tsx`, selected profile editor composition; `CadSketchProfilePanel.tsx`, begin/action guard. | Root added `otherEditorPending` and blocks idle panel actions while the exact editor owns the workflow. Source correction reviewed; final integration regression remains root-owned. |
| P2: expression dimensions had no human correction route | Create Width with `size * 2` or Diameter with `1/3`. Reopen it and change its value. Both on-part and panel editors reject the existing compound binding. On-part editing directs the user to that same rejecting panel. Removing intent retains the expression, so Add dimension cannot release it. Analytic profiles have no Exact geometry fallback. `CadSketchProfilePanel.tsx`, dimension initialization and changedScalar; `CadSketchDimensionControls.tsx`, locked binding branch. | Root is adding explicit Edit expression and Unlink actions. Preserve the existing binding during ordinary numeric edits; unlink must be a deliberate operation. Not independently verified at this handoff. |
| P2: agent view state reported annotations that were absent | Enable on-part dimensions and select a free numeric rectangle/circle/slot. There are no annotations, but Workbench reported `onPartDimensionsVisible: true` merely because its geometry kind supported dimensions. The flag also ignored a profile preview hiding annotations. Public agent documentation calls this effective visibility. `CadWorkbench.tsx`, renderedPreferences assignment; `docs/site/agents.md`, rendered view description. | Root is deriving effective visibility from actual dimensions and rendering conditions. Not independently verified at this handoff. |

The first finding was reproduced through the real domain operation using `node node_modules/tsx/dist/cli.mjs -e` with a temporary inline document. Before repair, the output was `parameters.width = 20`, `geometry.width = 30`. After repair, it was `parameters.width = 30`, `geometry.width = "width"`. No persisted document or product source was changed by that reproduction.

## Evidence and boundaries

An independent combined run of `cadSketchConstraints`, `CadSketchProfilePanel`, `CadSketchDimensionControls`, `cadSketchDimensionAnnotations`, `CadFeatureTree`, `CadWorkbench` and native `cadKernelRuntime` passed **123 tests in 7 files**, 5.57 seconds. That run preceded the final expression, command-ownership and effective-visibility regressions. It does not certify their later changes.

The reviewed code preserves full-precision initial dimension text, validates stale panel documents before Apply, distinguishes parent editing context from selected child rows, computes analytic side/diameter/radius/slot annotation supports, and removes non-geometric intent from the native model key while retaining full inspection ownership. Existing tests exercise no-change radius precision, diameter conversion, invalid geometry correction, stale cancellation, one-step Undo and native export retention.

Direct contour dragging was still being completed by its implementation owner, so absence of its Workbench callback in an intermediate snapshot was not filed as a defect. General coincidence, tangent, equal-length and arbitrary endpoint constraint solving remain outside the implemented analytic dimension model. No mock UI controls should imply those capabilities.

Root subsequently received a layout correction requiring a specification tree directly over the full viewport. Earlier left-sidebar placement is superseded by that instruction; it is not evaluated as the final requested layout in this review.

## Follow-up verification

The five original findings now have the following scoped status:

| Finding | Current verification |
| --- | --- |
| Shared dimension binding | Closed. The real operation updates a named driver, preserves its stored expression and updates correlated quantities. Diameter conversion updates the radius parameter. Compound drivers reject ordinary value edits atomically. The direct before/after reproduction and domain regressions pass. |
| Replayed dock command | Closed by the reviewed ownership correction. Commands carry document/profile ownership, use a monotonic sequence independent of cleared state and are consumed explicitly. Workbench behavior exercises a Dimension action followed by a separate Move action after Apply/Cancel. The root's command cannot remain available for another keyed profile panel to replay. |
| Competing Exact geometry draft | Closed by the reviewed composition guard. The outer idle panel receives `otherEditorPending` and disables its Move, Dimension, Construction and Fillet actions while the exact editor owns the pending workflow. Its own active editor remains usable. General Workbench pending guards continue to block saving, finish, selection and agent mutation. |
| Dimension expression correction | Closed for analytic dimensions. Explicit Edit expression preserves an unchanged definition and allows a deliberate replacement. Unlink retains the exact size and explicit intent with one-step Undo. A follow-up legacy case initially removed its annotation because no explicit record existed; root repaired this by adding one record only when needed. The new legacy radius `1 / 3` regression verifies exact numeric radius, retained Diameter annotation and Undo. |
| Effective annotation visibility | Closed. Workbench derives the flag from actual dimensions, Select mode and preview visibility. The behavior test verifies a free profile reports false, an explicitly dimensioned profile reports true, a Fillet preview hides annotations and reports false, and Cancel restores true. |

An independent current run passed **159 tests in 8 files**, 5.41 seconds:

```text
npm test -- --run
  src/domain/cad/__tests__/cadSketchConstraints.test.ts
  src/features/cad/CadSketchProfilePanel.test.tsx
  src/features/cad/CadSketchDimensionControls.test.tsx
  src/features/cad/cadSketchDimensionAnnotations.test.ts
  src/features/cad/CadFeatureTree.test.tsx
  src/features/cad/CadWorkbench.test.tsx
  src/features/cad/CadSketchDirectManipulation.test.tsx
  src/features/cad/kernel/cadKernelRuntime.test.ts
```

The command is shown wrapped for readability; the actual invocation passed all paths in one command. Native runtime cases exercise real OpenCascade geometry, exact topology ownership and STEP/STL export retention. Component cases use jsdom; they do not prove browser pixel layout or hardware-specific pointer behavior.

Preview measurement correlation also passes a worked example. A 50 × 40 mm rectangle with 5 mm corner radius has area `2000 - (4 - π) × 25 = 1978.5398163397448 mm²`. While that Fillet draft is visible, the inspector reports 1,978.54 mm², the accepted document/version stays unchanged, and Cancel restores 2,000 mm². Measurements now consume the same preview profile and parameters as the visible sketch.

The source now places the specification tree inside the full-size modeling area, with transparent overlay styling and a Parameters branch. Interactive descendants accept pointer events; unoccupied overlay space remains available to the viewport. Fit reads current occupied overlay bounds explicitly. Actual scrollbar hit testing, hover contrast, full canvas bounds and camera stability still require the root's integrated browser pass.

### Fillet relation follow-up

The review subsequently identified one more P2 route defect: a rectangle's arithmetic Fillet radius lacked the explicit relation controls added for dimensions. With valid `geometry.cornerRadius = "1 / 3"`, ordinary value editing rejected the compound expression, while Edit expression and Unlink were unavailable. Rectangle Exact geometry also provided no correction route. Root added common relation controls for dimensions and Fillets, with the compound value input read-only until explicit expression editing is chosen.

This finding is now closed within the supported rectangle Fillet operation. Before repair, an independent run captured **7 passing cases and the new failing Fillet case**, with `Missing Edit expression`. After root's repair, an independent Panel + Workbench run passed **59 cases**. The regression was then strengthened with existing explicit Width intent and complete profile equality checks, so successful relation editing and unlinking also verify preservation of placement, role and unrelated intent. An unchanged full-precision arithmetic definition creates no history entry; editing `1 / 3` to `1 / 2`, exact unlink to `0.5`, and two Undo steps recover the saved original.

The independent boundary pass found a smaller no-op precision defect: a saved numeric-string radius `"0.3333333333333333"` was rewritten to a number after entering the equivalent `" 0.33333333333333330 "`. That started an unnecessary preview and added history even though the effective radius was identical. A regression was written first and failed, with **8 passing cases and 1 failure**. The Fillet value path now compares numeric values before generating an edit, matching dimension editing. Explicit expression mode still permits intentional relation replacement.

The final focused run passed **63 tests in 2 files**, 6.64 seconds: `CadSketchProfilePanel.test.tsx` (12) and `CadWorkbench.test.tsx` (51). Additional behavior cases verify that:

- Ordinary Fillet editing retains a named driver, updates its parameter and correlated Width, and publishes preview parameters without changing the accepted document. Explicit unlink freezes only the Fillet radius; the parameter and Width relation remain intact, and Undo restores the original.
- Empty, negative, oversized and unknown-parameter Fillet expressions reject atomically, clear invalid previews and leave the accepted snapshot untouched. Correcting the draft produces a valid preview; Cancel discards it.
- Both Apply and Unlink reject a draft after an external document edit. The accepted external change and original Fillet relation survive; Cancel remains available.
- Equivalent numeric input preserves the exact saved scalar representation, document/version identity and empty Undo history.

### Native cache: contour labels

A subsequent scoped cache review confirmed that a tree contour rename caused an unnecessary native rebuild because `cadKernelRuntime.modelKey` included `profile.name`. The real OpenCascade regression was written first: **6 runtime cases passed and the rename case failed** because the new build ID differed. The repair excludes only contour labels alongside non-geometric constraint intent. Feature and body names remain in the key because `cadKernelModel` stores those names in meshes and uses them for named STEP export.

This exclusion is safe for the current consumers: profile labels appear in sketch validation diagnostics, which are evaluated against the complete incoming document before cache reuse. Native sections and topology picks use IDs and geometry. Inspection ownership retains the complete accepted JSON key, so the new document is rejected before its build is accepted, then succeeds afterward; the old document is rejected even though its build ID and native arrays are reused. The regression also verifies current-name validation errors leave the accepted cache intact, STEP retains the solid's `Pad` label and 1,000 mm³ material, a body rename refreshes mesh/STEP labels, and a genuine Width change rebuilds to 1,500 mm³. Caller document bytes remain untouched.

Focused real-native verification passed **44 tests in 3 files**, 27.59 seconds: `cadKernelRuntime.test.ts`, `cadKernelModel.test.ts` and `cadKernelTopology.test.ts`. A separate one-process timing sample, with WASM initialization completed beforehand, measured 99.58 ms for the initial block, 1.29 ms for the contour rename and 16.17 ms for a Width rebuild. The rename reused the exact build and arrays; the scalar change rebuilt. These local wall-clock observations demonstrate this avoided rebuild, not a cross-device latency guarantee or a benchmark of complex parts.

This verification covers the current sketch/layout chunk. It does not mark the overall CAD goal complete or replace the final build, full suite and integrated browser review.
