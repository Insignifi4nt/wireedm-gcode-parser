# Selected CAD family and trackpad critique

Inspected the selected CAD source sheet at actual 14/16/24 px in dark and light themes, then reviewed the face-pointer clearance correction in the refreshed source. This review addresses visual meaning and crowding, not the earlier runtime result. CAD source was not changed by this reviewer.

## Selected CAD treatment

The face pointer previously approached the lower-right face edge closely enough for its stroke to merge with the contour. Moving its tip to `18 14` separates it from the closed face rhombus. The pointer now approaches from outside the object. This is clearer at 14 px and preferable to placing a cursor inside an already small plane. The source uses one closed face contour and one closed pointer; neither requires a broken edge to make space.

The edge pointer is different deliberately: its tip at `14 11` lies on the edge running from `4 16` to `18 9`. That contact identifies the selectable edge, while the endpoint dots establish a bounded line. Separating it would weaken the target relation. Body selection retains the full closed body with a pointer on its right side, keeping it separate from the lone face and lone edge metaphors. The body pointer remains the densest of the three at 14 px, but changing the cube into another perspective would sacrifice their family relationship.

Loft now reads as a tapered volume. Its two closed rhombus cross-sections have different sizes and share the same oblique axes as the body family. The larger lower section is not an arbitrary decorative ellipse. The silhouette resembles a pyramid at 14 px, but the smaller finite top section distinguishes a lofted frustum at 16/24 px. Omitting the hidden rear connector was a sound density choice. Adding that connector would create another central line through an already small object.

Sweep reads as a bent extrusion or curved strip, with a closed outer boundary and two capped ends. It is simpler than a path-and-section construction icon and no longer looks like an unclosed hook. It does not independently explain that a profile travels along a trajectory, but its bent result is visibly different from Loft and Revolve. A centerline would add a path inside the volume and make it less readable at 14 px. Keep the current result silhouette.

Revolve's stepped turned body and axis distinguish it from ordinary rotation. The outer rotation cue becomes small at 14 px, but the result body remains recognizable and separate from Loft. Imported body keeps the same closed cube as Body and adds a downward import direction, which is a more coherent family than the earlier open shell. Datum plane is a restrained closed rhombus; it is intentionally related to face geometry without copying a selection cursor. Combined Pad/Pocket now carries separate plus/minus modifiers instead of implying that both material operations add material.

No further CAD redraw is recommended from this pass. These judgments do not assert that each tiny result silhouette teaches its operation without labels. The repaired face-pointer separation is the concrete crowding improvement; edge contact is an intentional semantic relationship rather than the same defect.

## Trackpad alternatives

Root subsequently selected the two-finger candidate for the catalog. There is no current application consumer or Trackpad settings row in this checkout, so no actual-settings preview is claimed. The current generated source and the integrated before/revised sheet record the adopted drawing. The comparison against mouse, pan and panel glyphs remains the relevant density check for this catalog-only icon.

Rendered three new candidates at 14/16/24 px, plus enlarged construction specimens, against the current mouse, pan hand, panel and machine frame. Sources are `scripts/icon-revisions/trackpad-v4.mjs`; comparison sheets are under `docs/design/icon-review/trackpad-v4/`. Production trackpad geometry remains unchanged.

| Candidate | Critical read | Recommendation |
| --- | --- | --- |
| Rounded pad with contact trails | Two circular contacts and short trails stay distinct from pause bars, but the small image reads as a socket or two adjustment controls inside a panel. | Reject as primary. The intended gesture is less obvious than the generated shape's competing meanings. |
| Oblique pad with two contacts | The flat surface differs from an upright machine frame. At 14 px its two dots read as a domino more strongly than fingers touching a trackpad. | Reject as primary. Oblique perspective alone does not fix the metaphor. |
| Two fingers over pad | The gesture is explicit at 14/16 px. Two fingers and a lower pad field distinguish it from the full pan hand and from the mouse device. The pad field is deliberately interrupted behind the hand, and the gesture traces are not CAD material contours. It is denser than the laptop. | Best new candidate for the labeled Trackpad setting, if direct gesture meaning is preferred. Preview it in that actual settings row before replacing the current asset. |

The current laptop remains recognizable at 14 px but describes the hardware context, not the input method. That is its tradeoff, not proof that it is the best metaphor. The two-finger candidate improves semantic specificity while costing visual density. None of the three candidates warrants automatic integration based only on its enlarged specimen.

The source-only candidate sheet intentionally does not claim generated asset parity. The selected production CAD source was regenerated by the owning task after the face correction. Lead arrows were also mirrored precisely by that task; their separate geometry checker verifies the actual generated path coordinates. This reviewer did not alter audits, guards or CAD integration.
