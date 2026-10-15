# CAM and simulation icon iteration 2

Status: review proposals only. No catalog, generated asset, component or application files were changed by this iteration. The parent integration selects and ports any paths it accepts.

The complete side-by-side specimen is [current versus proposal at 12, 14, 16 and 24 px](icon-review/iteration-2-cam/contact-sheet.png). [Lead-direction alternatives](icon-review/iteration-2-cam/lead-direction-alternatives.png) compares the center-pierce and outside-entry metaphors on one identical closed contour. `render-cam-review.mjs` parses the generated current SVGs, asserts their path data matches the editable source, then rasterizes current and proposed geometry with `@resvg/resvg-js`.

## Critical read

The current CAM symbols are a mixed set: the flag, pushpin, center mark and magnet are familiar, but the lead pair uses an open L that does not read as a closed cut contour, offset is limited to nested rectangles, the wire has an unexplained box, simulation and machine setup share a generic machine-front picture, and section view repeats the scan frame. The lead arrows also do not communicate their relation to the boundary consistently.

The proposal makes the irregular contour in `cam.mjs` the shared planar part silhouette for CAM editor, offset, toolpath, lead-in, lead-out and departure. Offset adds one smaller closed path; toolpath carries a tangent direction mark; departure points from the boundary outward. Entry and exit use the same exact base contour and reverse one another. The center-pierce arrow points from the interior toward the edge, while the reverse exit points from just inside that edge toward the interior. Both retain a 3-unit gap so the arrowhead stays visibly separate from the outline. The editor panel explicitly supports center-pierce entry from circle center to boundary, so that is the chosen directional metaphor. This choice is more specific than generic CAM usage: its manual-coordinate lead can be placed on either side of the contour. A label or tooltip must continue to identify the command; these tiny vectors cannot encode that variability.

The other plausible metaphor is the conventional outside approach, with lead-in pointing from outside stock to the contour and lead-out reversing back outside. It is more broadly recognizable for arbitrary profile entry and exit. I did not select it because it disagrees with the workbench's explicit center-pierce operation and would make `LeadInIcon` point away from that supported strategy. The pair comparison preserves this tradeoff for integration review rather than treating either convention as universal.

Wire, simulation and machine setup now share the same 18-by-16 machine frame. Their interiors distinguish the electrode between guides, the stock and active cut in a simulation view, and XY alignment controls. This unifies the family without using a play symbol as a substitute for the separately labeled playback controls. Section view shows a cut solid inside a viewport; section-for-CAM retains a shallow solid, a plane and a transfer arrow. The CAD scout confirmed it was not proposing either section icon, so I kept the distinction local: inspection has no transfer arrow, and CAD-to-CAM section transfer does.

## Per-icon decisions

| ID | Decision | Review |
| --- | --- | --- |
| `cam-editor` | Revise | Replace the triangle-and-spokes with the shared part loop, offset and direction mark. This is a composed CAM-planning symbol; it remains busy at 12 px and the editor label must carry the meaning. |
| `geometry` | Retain | The separate flat triangle-and-circle is a compact generic planning-geometry mark. It must stay planar and separate from the CAD solid and the CAM operation glyphs. |
| `toolpath` | Revise | A closed route using the shared contour ties it to profile cutting. The current open zigzag reads as arbitrary movement and has no relation to offset or lead geometry. The directional marker still needs its label at 12 px. |
| `offset` | Revise | Use two separated, closed, irregular nested contours instead of two rectangles. Nested outlines are the operation; keep their shape identical to the CAM contour family. |
| `lead-in` / `lead-out` | Revise | Use one shared closed base path and visibly reverse the internal arrow. This is deliberately the center-pierce example, not a promise that every lead is interior. |
| `departure` | Revise | Attach the outward arrow to the same closed boundary. This differs from the proposed lead-out, which points inward. |
| `wire` | Revise | Use upper and lower guides joined by one vertical wire inside the shared machine frame. The current inset rectangle reads as a workpiece or enclosure. |
| `simulation` | Revise | Show stock, wire and cut in the shared frame. Keep play/pause controls independent. |
| `machine-setup` | Revise | Keep the shared machine frame and show an XY alignment mark in its interior. Do not reuse simulation's stock-and-wire detail. |
| `section-view` | Revise | Show an inspected cutaway within a viewport. Current scan brackets plus cross-lines are too close to the scan/bounds symbol. |
| `send-cam` | Revise | Transfer a planar closed sketch profile with an interior opening. Avoid the file-with-text metaphor because the source is geometry, not a document. |
| `section-cam` | Revise | Keep the CAD shallow solid, expose a section plane and show transfer to CAM. This is distinct from section-view inspection. |
| `start-point` | Retain | The flag is a familiar start marker and is clean at 12 px. Do not replace it with a pin; the catalog already gives pin a different line-highlight meaning. |
| `pin` | Retain | A conventional pushpin matches pinned line highlights. Its physical metaphor is appropriate for the interaction. |
| `scan` | Retain | Corner brackets communicate bounds/scan framing. Keep its exact bracket silhouette distinct from the revised section view. |
| `circle-center` | Retain | A closed circle plus a centered dot directly marks the circle center. |
| `snap` | Retain | A magnet is a recognized geometry-snapping metaphor and matches the source interaction. |
| `origin` | Retain | The crosshair-and-center mark works as a compact origin target. It is not a machine coordinate editor by itself. |
| `rotate-clockwise` / `rotate-counterclockwise` | Retain | Familiar rotational arrows are direction-specific. These are shared geometry transforms, so no CAM-specific variant is justified. |
| `flip-horizontal` / `flip-vertical` | Retain | Mirrored profiles around an axis state the operation directly. The same geometry operation is used beyond CAM. |
| `move` | Retain | The four-direction move mark reads as a translation and should remain shared. |

## Toolbar and accessibility limits

At 12 px, contour detail and arrowheads collapse quickly. The actual-size sheet shows that the label is essential, especially for `cam-editor`, `toolpath`, `lead-in`, `lead-out` and `section-view`. Do not expose these icons as unnamed controls. Keep the current button's accessible name, visible label, tooltip, disabled guard and selection state; render the inline artwork as decorative inside a named control. The stand-alone SVG asset's image label does not replace the owning control's accessible name.

Before integration, check the tiny arrowheads and the nested loops in the running toolbar at its actual CSS size and foreground colors. The contact sheet verifies path occupancy and direction at the requested pixel sizes, not recognition in context or hit-target/accessibility behavior.

## Proposal files

- [`cam.mjs`](../../scripts/icon-revisions/cam.mjs) exports `camRevisions`, with `{ id, paths, reason }` rows. It deliberately does not change the catalog.
- [`render-cam-review.mjs`](../../scripts/icon-revisions/render-cam-review.mjs) refreshes the two comparison PNGs from the current icon source and those proposals.
