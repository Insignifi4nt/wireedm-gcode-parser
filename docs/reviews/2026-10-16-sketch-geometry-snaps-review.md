# Sketch geometry snapping review

Independent review of the local changes after `d705840`, 2026-10-16, against the [snap plan](2026-10-16-sketch-geometry-snaps-plan.md). Scope: Canvas creation picks, shared hint rendering, graph point drag integration, source/modifier/frame ownership and capture. The pure resolver's implementation has a separate owner; its caller contract was inspected here. Unwired arrangement is excluded.

Two concrete issues were reproduced and repaired with the root's approval:

1. **An accepted off-grid Path snap could move again without input.** Clearing the hint left the raw pre-snap cursor behind, and fallback grid rounding immediately changed its position. Repeating Space could append a segment the user had not chosen. The cursor now distinguishes raw pointer input from an exact world position. Only pointer input acquires magnets/grid; accepted Path points and keyboard movement retain their exact position. A red-first regression verifies repeated Space rejects zero length, then ArrowRight escapes acquisition and creates exactly the requested segment without borrowing another point ID.
2. **A cancelled graph drag could leave an earlier capture apparently current.** The hint lived in the child layer, while Canvas capture identity omitted the graph gesture's ownership. Adding the existing `graphPending` flag to the existing view signature invalidates a pre-drag capture even when the gesture ends in Cancel before rasterization finishes. This needs no new child callback or snap-state store. Active public captures remain blocked by the shared workflow guard.

No open finding remains in this bounded slice. Creation picks resolve against the accepted graph and current event modifiers at commit. Path endpoint reuse retains explicit IDs; arc-through picks and other shape tools copy positions with a visible “No relation” hint. Source/view changes clear acquisition. Draft closure remains an exact authored return rather than proximity welding.

The graph drag uses its captured accepted targets, excludes its own joint/dependent midpoints, checks driven-axis reachability, and recomputes suppression on release. Attained styling requires the current matching solved preview; an older preview cannot confirm a new target. Existing source/frame cancellation, AbortSignal ownership, late-result rejection and soft-drag semantics remain intact. No saved relation, source rewrite, new solver protocol or tolerance change was introduced.

Evidence: both new regressions failed before the fixes in ignored `tmp/cad-snaps-review-red.log`, then passed in `tmp/cad-snaps-review-green.log`. The complete focused Canvas, Picking, PathDrawing and GraphLayer set passed **97/97**, recorded in `tmp/cad-snaps-review-focused.log`. App `tsc --noEmit` and the scoped whitespace check passed. No production build, browser journey or remote action was run by this reviewer; final integrated acceptance remains with the root owner.

## Parent acceptance

The frozen integration passes 125 focused pure/interaction cases, full TypeScript, shared UI validation, icon integration and the production build including documentation/schema parity and pinned native source distributions. All 20 sketch/legacy/region journeys pass in Chromium and Firefox, run as 17 constraint journeys and three existing editing/region journeys. Ignored logs: `tmp/sketch-snaps-{integrated,types,ui-standard,icons,build,all-chromium,all-firefox,existing-chromium,existing-firefox}.log`.

The new production journey uses real pointer picks on off-grid source geometry, confirms exact rectangle corners and preserved expression strings, places a bore at an analytic midpoint, then gives the freehand bore a driving Ø4 mm before extrusion and save/reload. The first test expectation incorrectly assumed an unsnapped physical mouse pick could supply a bit-exact radius; the accepted journey uses the ordinary driving dimension for exact size, without changing app precision or snapping logic.

The in-app browser repeated that human workflow on an unsaved fixture and built its 5 mm extrusion through registered WebMCP. Source expressions, separate point identities and the absence of phantom inferred relations were inspected. The resulting native solid has volume 937.168146928204 mm³ and no diagnostics. Five Undo operations restore the empty original test draft. Native visual proofs: ignored `tmp/sketch-geometry-snaps.png` and `tmp/sketch-snap-solid.png`. No saved user project changed.

This completes the bounded position-snapping checkpoint. Persistent inferred coincidence, associative midpoint, topology editing and the full sketch audit remain open. No push, pull request, merge or deployment occurred.
