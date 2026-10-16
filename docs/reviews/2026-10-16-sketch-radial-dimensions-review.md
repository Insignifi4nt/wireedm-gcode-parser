# Radial dimensions and Construction ownership review

Independent bounded review against local `a29212b`, using the equal-size/radial prerequisite plan. Reviewed the current relation panel, Workbench commands, dimension layout/rendering, radial source/checker/native mappings and relevant ownership tests. Equality remains unimplemented and was excluded, as were the unwired arrangement files. No production edits, build, distribution or remote actions were performed.

## Findings

No actionable correctness or ownership issue found in this slice.

- A new numeric circle starts with a displayed diameter; an arc starts with radius. Provisional quantity conversion scales numbers or wraps the exact expression instead of replacing it with its evaluated value. Candidate edits remain private until Apply. Accepted radial removal/restoration reuses the original relation and exact scalar.
- Dimension finds an existing radial or fillet owner. A source-expression circle retains its original fx driver; no automatic transfer or second driver is exposed. The agreed parser rejection `already-driven-sketch-radius` is intentional. It does not claim that the pinned native solver reliably diagnoses an equivalent or conflicting fully fixed radius parameter.
- Native circle mappings use radius/diameter equations; arc sizing uses the existing center/start spoke and structural endpoint-radius equation. Independent radial validation checks both actual arc endpoints. Circle scalar precision excludes unrelated world-center magnitude. Source IDs, expressions and major/minor direction remain authoritative.
- Annotation arrows attach to actual circle supports or the midpoint of the signed analytic arc. Reversed representations retain the same support. R/Ø labels carry the exact source relation to the existing configuration callback, with shared label clearance and event ownership. Existing distance and corner annotation behavior is retained.
- The panel retains its existing cancellation, source ownership, prepared preview and awaited publication paths. Rejected or stale candidates cannot become accepted geometry through the new quantity selector. Removing a radial relation leaves solved numeric geometry; its subsequent freedom belongs to native inspection.
- Construction in Select mode edits the actual selected legacy profile through the shared awaited operation. The current checked state comes from that profile. A pending operation locks the dock, failure preserves source and releases ownership, Cancel invalidates late completion, and drawing defaults remain separate. Graph sets still require entity-only operands and do not act on a mixed subset.

## Verification

Five focused existing/new cases passed independently across `CadSketchRelationsPanel.test.tsx`, `CadWorkbench.test.tsx` and `cadSketchGraphDimensionLayout.test.ts`. They cover provisional quantity conversion/private draft/removal/restoration, an existing circle expression driver, native annotation reopening, awaited legacy Construction success/Undo/rejection/Cancel/default separation, and signed-major-arc/circle support placement. Log: `tmp/cad-radial-independent-focused.log`.

This review did not independently rerun the native radial suite or whole application. Those owner checks, final typecheck/build and real browser workflows remain part of root integration. It does not claim equality relations or complete sketch-mode acceptance.

## Root acceptance

The owner domain/native group passes 139 focused cases. The related UI group passes 128 cases, with overlapping narrower final checks. Full production build, TypeScript, docs/source distributions, shared controls and sequential icon integration pass. Firefox passes all 17 production sketch/region journeys; Chromium passes the 16 non-Slot journeys plus the Slot journey after a test-only ambiguous Construction locator was scoped to the modeling dock. The binary was unchanged between those Chromium runs.

Native in-app browser proof uses registered WebMCP plus real shared controls. Ø12 preview leaves accepted source unchanged and Cancel restores it. An exact ` nominal ` diameter relation updates the shared parameter to 16 through its annotation, retaining the expression and circle radius 8. The clockwise major arc receives R6 with the original endpoint IDs, direction and exact driven coordinate text retained. Both annotations attach to their actual curves. The selected legacy Slot becomes construction while retaining ` slotLength `. Finish and Pad5 yield one solid, volume 1005.3096491487338 mm³ (320π), bounds [-8,-8,0]–[8,8,5], no diagnostics. Five Undo steps restore the complete original feature. Screenshot: `tmp/sketch-radial-dimensions.png`; disposable unsaved tab closed. No saved user records or remote state changed.
