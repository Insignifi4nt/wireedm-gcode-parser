# CAM and simulation icon iteration 3

Status: isolated design proposal. No production icon catalog or app UI was changed. [Iteration 2](iteration-2-cam.md) is retained as an earlier exploration; v3 separates the CAM operation metaphors after its rendered silhouettes converged too much.

The [current/proposal comparison](icon-review/iteration-3-cam/current-v-proposal.png) uses the actual generated SVGs as the baseline, verifies path parity with the editable source, and rasterizes both sets through `@resvg/resvg-js` at 14, 16 and 24 px. The [lead-pair comparison](icon-review/iteration-3-cam/lead-pair.png) compares inside-entry/exit with the outside alternative on one closed contour.

## Visual direction

The CAM operation family shares a contour language, not one repeated glyph. CAM Editor uses one closed profile plus a pencil modifier. Offset uses two closed contours whose edges are truly parallel. Toolpath uses the closed contour and a tangential direction marker. Lead-in and lead-out keep the same closed base and reverse a radial arrow with a 3-unit clearance. At 14 px, the marker remains small, so every use needs its visible label or accessible name.

The v2 direction paired several near-identical rings and, at 12–14 px, looked like the same glyph repeated with barely visible marks. The v3 comparison shows a pencil, inset contour, tangent path and radial entry/exit as different operations. Its profile is a symmetric four-corner chamfered contour so the outline cannot be mistaken for the single folded corner of a document. The proposed inset uses the parallel offset of each straight and diagonal edge; it is not an arbitrary smaller polygon.

Lead-in points from the interior toward the edge, and lead-out reverses back into the interior on the exact same closed path. This cues the documented center-pierce operation (“cuts from the circle center to its boundary”). The coordinate-based lead workflow allows arbitrary points, so that direction is not universal. The comparison includes outside-entry/outside-exit for parent review. The icon label remains authoritative in either case.

Wire, simulation and machine setup share a 24-unit machine frame. Their interiors stay distinct: upper/lower guides with the electrode between them; stock crossed by a moving wire; and XY alignment axes. The repeated frame signals related machine controls, while interior geometry carries the action. At 14 px these details are crowded, so the frame is family consistency rather than a standalone symbol. `Section view` stays an inspected wireframe cutaway with no transfer arrow; `Section for CAM` shows the cut through a shallow solid and the transfer arrow.

## Current-source audit: all 24 IDs

This ledger is the scope of this review, not a claim that every catalog ID has a current UI call site. “Catalog only” means the exported path exists but this checkout has no matching JSX use.

| Catalog ID | Current source evidence and semantic disposition |
| --- | --- |
| `cam-editor` | Catalog/export only. Revise to a closed profile plus pencil modifier; keep separate from the generic `geometry` lens mark. |
| `geometry` | Used in `EditorUpidRail.tsx` as the Geometry lens. Retain the flat planning-geometry mark; this is not a solid-body symbol. |
| `toolpath` | Catalog/export only. Revise to closed contour plus tangent travel direction. |
| `offset` | Catalog/export only. Revise to exact parallel nested contours. |
| `lead-in` | Catalog/export only; the Entry panel supports circle-center and coordinate-based leads. Revise to the interior-to-boundary cue and document the coordinate-mode limitation. |
| `lead-out` | Catalog/export only; the Exit panel allows coordinate-based endpoints. Revise as the reverse of the lead-in illustration, not as a universal outside exit rule. |
| `wire` | Catalog/export only. Revise to upper/lower guide bars and the vertical electrode inside the shared machine frame. |
| `simulation` | Used for the Simulation workspace tab and 3D loading status in `EditorPage.tsx` and `SimulationViewport.tsx`. Revise to a viewport with stock and active wire. |
| `machine-setup` | Used beside “Machine” / “Machine model settings” in `SimulationPanel.tsx`. Revise to the shared frame with XY alignment interior. |
| `departure` | **Do not use for CAM departure.** Its `ArrowRightFromLine` alias currently appears beside “Insert Points” in `EditorInspectorPanel.tsx:1289` and “Start Here” in `EditorProgramLinesPanel.tsx:344`. These are two different meanings and neither means “depart from contour.” Parent integration is adding dedicated Insert Points and Start Here IDs. |
| `start-point` | The `Flag` alias is used in `EditorPathNavigatorPanel.tsx:2517` on lead-in/lead-out tree rows. Retain this contour-transition marker. It must not be reused for G-code “Start Here.” |
| `pin` | Used to clear pinned line highlights in `EditorProgramLinesPanel.tsx`. Retain the thumbtack. |
| `scan` | “Inspect bounds” catalog entry; no current JSX use found. Retain a scan/bounds frame and do not map it to the simulation collision scan without an actual control. |
| `section-view` | No current JSX use found. `ScanLine` in the old inventory referred to “Fit machine and stock”; current `SimulationViewport.tsx` uses `FitViewIcon`. Retain a sectioned model/view meaning, separate from CAM transfer. |
| `section-cam` | Used in the CAD file menu as “Section for CAM” with title “Create CAM geometry from a planar section.” Revise to section plane plus transfer arrow. |
| `send-cam` | Used in the CAD file menu as “Send sketch to CAM.” Revise to a planar closed source profile plus transfer arrow, unlike the shallow solid in `section-cam`. |
| `circle-center` | Catalog/export only, with matching center-pierce domain behavior. Retain circle plus center point. |
| `snap` | Used for “Toggle grid snapping” in `CadSketchCanvas.tsx`. Retain the magnet. |
| `origin` | The `Crosshair` alias is used by `EditorGuideDialog.tsx:133` for the “Show me” target-highlighting action, not a coordinate datum. Treat the current alias mapping as a separate semantic collision; do not copy this usage into machine setup. |
| `rotate-clockwise` | Used in `EditorPathNavigatorPanel.tsx`. Retain the directional rotation arrow. |
| `rotate-counterclockwise` | Used in `EditorPathNavigatorPanel.tsx`. Retain the reverse directional rotation arrow. |
| `flip-horizontal` | Used in `EditorPathNavigatorPanel.tsx`. Retain the mirror-about-axis glyph. |
| `flip-vertical` | Used in `EditorPathNavigatorPanel.tsx`. Retain the mirror-about-axis glyph. |
| `move` | Used by `EditorPathNavigatorPanel.tsx:886` for Apply Translation. Retain the shared translation glyph rather than inventing a CAM-specific move action. |

The required new semantic IDs missing from this list are `insert-points` and `start-here`; their definitions belong to the parent catalog owner. Do not remap the existing `departure` path or alias to either action.

## Proposal and validation

- [`cam-v3.mjs`](../../scripts/icon-revisions/cam-v3.mjs) exports `{ id, paths, reason }` proposals. It is independent of `icon-source.mjs`.
- [`render-cam-v3.mjs`](../../scripts/icon-revisions/render-cam-v3.mjs) checks generated SVG/source parity and writes both comparison sheets.

Validation rendered 11 changed IDs at 14/16/24 px and the four lead alternatives, syntax-checked both proposal scripts, and passed `git diff --check`. No app tests were appropriate because v3 changes only review artifacts.
