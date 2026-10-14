# Critical iteration checkpoint

The user's request triggered grouped reviews of the whole catalog, followed by independent criticism and root selection. Luna handled CAD and CAM scouting and the usage audit. The stronger reviewer examined general controls and the selected designs across families. This checkpoint does not claim perfect standalone recognition or approve a release.

All 134 IDs have explicit review coverage in `icon-review-coverage.json`. All 244 current imported references were inspected against their labels and actions. The catalog now compares six related groups at 14, 16 and 20 pixels, alongside the individual size and state specimens.

## Decisions that changed the drawings

- Lead-in and lead-out use the same closed chamfered contour. Their interior arrows mirror exactly about its center. A checker reads the production paths and verifies closure, interior placement and at least three units of contour clearance.
- Offset uses an actual three-unit parallel inset on every side, including the chamfers. The first proposed inset had an incorrect corner and was rejected. CAM editing uses a pencil, cutting path uses tangential motion, and leads use radial motion.
- Wire electrode uses upper and lower closed guide blocks with a suspended wire. A common machine frame made it read as a window, so that proposal was rejected even though it matched the simulation and setup viewports. Their shared centerline and guide spacing preserve the relation without forcing identical silhouettes.
- Revolve now shows a stepped turned result and circular motion. Loft uses two differently sized closed oblique sections and corresponding generators. Sweep uses a closed curved result. We rejected the crowded centerline and the earlier generic trajectory arrow.
- Face, edge, body and datum-plane use a consistent 2:1 projection. Face selection retains a separate planar target and a visible gap to its pointer. Edge selection deliberately places the pointer on the edge. Showing a full cube for every selection target was rejected because it erased the distinction.
- Imported body now has a closed body silhouette. Pad/Pocket uses additive and subtractive cues. Existing Boolean results, Mirror and Linear pattern were already closed; no decorative marks or redundant closure edits were justified.
- Document modifiers share a consistent outline and badge field. Import/export mirror each other. The interrupted page edge intentionally depicts a modifier in front of the page. Closing that edge behind the arrow made the small drawing crowded. This is distinct from a geometry contour that must close.
- Copy sheets now have equal dimensions. Folder modifiers share their lid seam. Hidden geometry retains a restrained iris fragment. The busy glyph loses its detached fleck. Unsaved changes uses writing on a document.
- The app heading and favicon share the same stock/offcut mark, with a straight wire between closed material contours. Trackpad navigation uses a two-finger gesture on a touch surface. The laptop, panel-like pad and domino-like alternatives were rejected. The trackpad glyph has no current application consumer; its catalog specimen was compared against Mouse, Pan and panel controls.

The [before/revised sheet](icon-review/refinement-dark.png) records 35 changed or new glyphs at actual sizes. The light equivalent and full six-size sheets are in `icon-review/`.

## Decisions that corrected usage

“Insert Points” has its own point-to-program drawing. “Start Here” uses the program-start flag. Lead tree rows select the matching entry or exit icon instead of a shared flag. “Show me” uses an explicit Locate catalog entry. “Contour Tree help” uses Help. Both point-placement mode controls use the center-point marker; Magnet remains on snapping and magnetize controls. Names, handlers, guards and domain behavior are preserved.

## Review limits and integration

Dense CAD drawings still need their control labels at 12 pixels. The lead pair illustrates center-pierce behavior; arbitrary coordinate-based approaches can differ. Loft depicts connected section profiles, and Sweep depicts the resulting bent volume. Labels remain part of the design, rather than treating any 12-pixel picture as an unambiguous language.

The frozen inventory remains byte-preserved. Semantic checks cover 34 exact usage expectations, both dynamic lead directions, 17 feature bindings and 20 toolbar calls. The separate CAD task has published checkpoint `09795ec`; it is the eventual integration baseline. Its continuing hardening work and app servers remain owned by that task. No rebase, PR publication or deployment was performed during this visual pass.
