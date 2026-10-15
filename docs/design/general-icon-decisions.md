# General icon decisions

Selected after the iteration 2 and 3 comparisons. Source edits are limited to the named general icons and the AppShell emblem; CAD and CAM geometry remains owned by their reviewers. Final generation and integrated rendering follow these source edits.

| Icons | Selected treatment | Reason |
| --- | --- | --- |
| `file-new`, `file-import`, `file-export`, `file-inspect`, `file-body` | Shared interrupted page with a consistent lower-right modifier field | The page edge is deliberately occluded by its modifier. Complete-page crossing arrows collided with the edge at 14 px; interior arrows weakened the entering/leaving meaning. The new import arrow points into the page and mirrors the outward export arrow. Unmodified code and JSON pages remain closed. |
| `copy` | Equal 13 by 13 unit sheets | Copy should duplicate the same object. The previous front sheet was 12 by 13 units and the rear sheet 13 by 13. |
| `folder-plus`, `folder-storage` | Shared closed folder and complete lid seam | Parameter grouping and folder persistence belong to the same folder family. A short storage slot distinguishes persistence from the add modifier. |
| `busy` | One continuous three-quarter ring | Removes a detached diagonal that made the opening uneven at toolbar sizes. |
| `hidden` | Iteration 3 short iris quarter under the slash | Preserves the visible-eye family while adding less density than the iteration 2 half-ring. |
| `dirty` | Iteration 2 exterior writing tool on the shared page | Describes edited content more clearly than generic text lines. The closed-page interior pencil was crowded at 14 px. Explicit unsaved state text remains necessary. |
| `wire-edm-mark` | Iteration 3 separated stock and displaced offcut with straight wire between them | Both material contours are closed. The wire occupies their kerf rather than resembling a view arrow, house or pocket. The guide variant was denser at favicon size; the curved variant resembled a diameter symbol. |

The selected mark replaces the AppShell heading's hard-drive emblem explicitly. It retains the same `size-4 text-primary` styling; the neighboring Workbench name remains the accessible text. The change does not alter storage controls, header substitution, modal behavior or focus guards. The favicon uses the same selected geometry with its own background and foreground treatment, supplied by the existing generator.

The mouse/trackpad pair keeps the existing laptop-context trackpad icon. The proposed direct trackpad looked too much like a bottom panel at 14 px and was not a clear improvement. Save, history, status circles, check/close, panel controls, lock, link, search and plugin retain the reviewed geometry. No speculative details were added to make unchanged assets look newly designed.

The 57-ID reviewer coverage ledger is `docs/design/icon-review/iteration-3-general/coverage.json`. Combine its IDs with the other reviewer ledgers to prove total catalog coverage; overlapping counts alone are insufficient.

## Verification at this edit stage

Source changes match the selected iteration 2/3 paths. No catalog or SVG generation was run by this reviewer. A focused `appFrontEndRedesign.test.tsx` run passed five tests and failed two while the concurrent CAM component imports were ahead of generated exports. Both failures report an undefined component in `EditorInspectorPanel`, so the owning task must rerun this suite after generation. This record does not claim a passing final integration test or final visual review.
