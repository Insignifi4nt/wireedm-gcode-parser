# General design iteration 3

Compared six page/visibility variants and three original EDM mark candidates in `scripts/icon-revisions/general-v3.mjs`. The rendered comparison includes actual 14/16/24 px controls, enlarged construction specimens, and the three brand candidates at 16/32 px on both light and dark browser chrome. These are proposals; shared source and production assets remain unchanged.

## Closed page versus modifier clearance

The closed-boundary crossing-arrow pair preserves the page but produces a collision where the horizontal shaft meets the right document edge. The outward arrowhead is particularly crowded at 14 px. This is worse than the interrupted-outline pair from iteration 2. Do not adopt the crossing variants simply to obtain a closed contour.

The fully interior arrow pair preserves the complete page and stays legible. Its weakness is semantic: the arrow changes direction inside the page instead of visibly entering or leaving it. If full closure is a strict rule for every page, this pair is the better closed alternative. Otherwise, retain the iteration 2 mirrored lower-right arrows and interpret the interrupted edge as hidden behind a modifier, consistently across modified documents. Plain code/JSON pages should remain closed. A deliberately occluded boundary is different from an accidentally unfinished contour.

The closed-page interior pencil is too dense at 14 px, and touches the fold field at larger sizes. Retain the larger exterior pencil candidate from iteration 2 if an edited-document icon is wanted, with the same deliberate modifier clearance. The earlier generic lined page remains a weaker representation of unsaved changes. No single monochrome icon can establish the saved/unsaved distinction without the state label.

The shorter iris quarter in `hidden-iris-v3` restores the eye cue with less density than iteration 2's half-circle. It remains visible at 14/16 px and gives the slash room. Recommend this version for the next integrated comparison.

## Brand candidates

| Candidate | Small-size result | Decision |
| --- | --- | --- |
| `brand-separated-stock` | The wire remains a continuous line between two closed material contours. The displaced stock/offcut reads at 16 px and does not resemble a house, upward view arrow or U-pocket. | Best of this pass. Use as the next candidate in the actual header and favicon, with the Wire EDM name beside it. Its meaning is still abstract to a first-time viewer; the shape alone does not teach the process. |
| `brand-guide-stock` | The guide circle establishes the wire more literally. Its contact with the shaft and the right stepped cut add density at 16 px. | Keep as a larger-size alternate. Reject as the primary tiny favicon unless actual chrome inspection shows a clear improvement. |
| `brand-curved-stock` | The straight wire between curved stock has a clean silhouette, but it resembles phi or a diameter symbol more strongly than an EDM workpiece. | Reject for the brand. Shape clarity alone is insufficient when the metaphor names the wrong concept. |

Both browser-chrome specimens use the same dark favicon tile and current cyan mark, so the mark remains visible against either surrounding chrome. This is a favicon treatment, not embedded color for application glyphs. The production mark should keep `currentColor` and let its header provide the color. The existing AppShell `HardDrive` emblem should receive the selected mark explicitly; changing a storage alias globally would preserve the wrong context.

## Coverage ledger

`docs/design/icon-review/iteration-3-general/coverage.json` records every reviewed ID and its retain/refine/evaluate decision. This reviewer owns 57 IDs, not an estimated 70. The remaining catalog coverage must be reconciled by ID against the CAD and CAM reviewers' ledgers, including overlaps such as status and navigation. A count sum cannot prove coverage.

All 57 IDs were rendered in the three baseline pages from iteration 2. The initial general review kept the established arrow/check/status/lock/link/search/plugin/panel geometry after inspecting its symmetry and small-size behavior. This pass does not replace that inspection with a blanket approval. Strong iteration 2 changes remain the shared page field, paired import/export arrows, equal copy sheets, folder seam and clean spinner. Brand selection and modifier-boundary policy are still explicit parent design decisions.
