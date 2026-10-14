# Production general and CAM visual review

Reviewed the generated production assets after the selected source changes. `scripts/icon-revisions/review-production-general-cam.mjs` reads the real SVG files, verifies their path arrays match the editable source, and renders 32 selected icons at 12, 14, 16 and 24 px, plus 48 px construction specimens. Inspected both dark and light outputs in `docs/design/icon-review/production-general-cam/`. This includes the four transport icons omitted from the earlier general ledger and the new insert/locate semantics.

## Critical assessment

The modified-page family is materially stronger. Import and export now form a direct mirrored pair; the document fold and modifier field agree. The inspection circle and model badge still carry more detail than an arrow, so `file-body` is the weakest small file variant at 12 px. It remains legible as a modified file at 14/16 px, and its label supplies the model meaning. Enlarging the model badge would collide with the page and should not be done without changing the whole family.

The copy sheets are now equal, the folder seam no longer stops inside the folder, and the spinner has one clean opening. Folder storage reads as a folder with a persistence slot rather than a disk. The new dirty glyph reads as writing on a file, but edited content does not independently establish unsaved state. Preserve the explicit state label. The page outline is deliberately interrupted where the badge occupies its field; its modifier objects and all represented material contours are closed. Closing the page underneath the badge would recreate the edge collision rejected in iteration 3.

Hidden visibility has one slash and a short iris arc. The new arc does not retrace the slash: it runs from the left iris point to the lower iris point and stays below the diagonal. At 12 px it adds a small interior cue; at 14/16 px the eye family is clearer than the original iris-free outline. No additional pupil stroke is needed.

The selected brand retains a straight wire separated from two closed material outlines. It differs from the wire control's machine frame and the pause control's equal bars. At 12 px it is abstract; at the actual 16 px header size the displaced stock/offcut relationship survives. The favicon SVG uses exactly that geometry with a dark tile and cyan stroke, matching the previously rendered 16/32 px light/dark chrome comparison. The mark is useful beside the Workbench name, not a self-explanatory illustration of EDM to a new user. Further detail would worsen its tiny silhouette.

## New controls and family relationships

- `insert-points`: Three point circles, a central arrow and three program rows encode points entering a program. At 12 px the arrow is the least prominent detail, but the point column and row column remain separate. At its 14 px button size the insertion direction is visible. Do not add point labels or more rows; that would make it crowded. This is more specific than the old departure arrow.
- `locate`: The crosshair is appropriate for locating a highlighted control. It shares geometry with origin by design, but its explicit semantic catalog ID prevents conflating the two uses. The guide's text explains the action.
- `start-point`: The flag stays distinct from insertion, departure and leads at 12 px. Its pole is deliberately open; its flag contour closes back to the pole. It belongs to program-start selection, not a generic lead marker.
- Play, pause, previous and next are recognizable at all four sizes. Previous/next are exact mirrors with matching stops and closed triangles. The pause bars are closed narrow rectangles; their interiors become small at 12 px but remain separate. The standard transport vocabulary is clearer than inventing simulation-specific alternatives.

## Remaining CAM design limitations

The closed contour language unifies editor, offset, toolpath and leads, but their silhouettes inevitably converge at 12 px. Editor's diagonal pencil and offset's inset survive best. Toolpath and leads depend on their direction marker: downward/tangential for toolpath, opposing horizontal/radial for leads. The current lead pair expresses the app's center-pierce example and is not a universal outside-entry/outside-exit metaphor. Keep the visible lead labels in the 12 px tree rows. Reversing arrows only by color would be insufficient; the current shape does reverse.

Section view remains close to the generic solid-body family at 12 px. Its diagonal section cue is visible at 24 px but comparatively weak at tree size. Section-for-CAM has the extra transfer arrow and is more distinguishable at 14/16 px. If section view becomes a frequently used unlabeled 12 px action, review a stronger planar cut cue in the CAD family rather than adding another arrow. This reviewer did not alter CAD source.

Wire, simulation and machine setup share a frame. Their inner guide, stock/cut and axis-alignment shapes differ at 14/16 px but rely on adjacent labels at 12 px. That is an appropriate limit for dense technical controls; it should not be advertised as every icon teaching its operation without text.

No selected general geometry warranted another localized correction in this pass. The limitations above remain concrete context and sizing constraints, rather than absence of runtime errors being treated as proof of design quality. The four transport IDs and new insertion/locate IDs are explicitly included in the production review list for coverage reconciliation.

## Verification

- Production path parity passed for all 32 icons rendered by this review.
- Both theme sheets inspected at actual CSS sizes.
- `appFrontEndRedesign.test.tsx` now passes all 7 tests after generation, including the header and editor paths that failed while exports were stale.
- No production, CAD or generated asset changes were made during this review.
