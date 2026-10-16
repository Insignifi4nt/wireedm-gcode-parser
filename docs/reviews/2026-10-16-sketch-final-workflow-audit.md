# Sketch workflow completeness audit

Read-only audit at `2ba28b0a`, against the original [S01–S22 reference](2026-10-16-sketch-workflow-reference.md), [checklist](2026-10-16-sketch-workspace-checklist.md) and successive inventories. Source and recorded acceptance were reconciled; no tests, native/browser work, builds or saved-record changes were performed. Earlier inventories describe their own snapshots: their missing Trim, Offset, cells, references, dimensions and pattern entries are superseded below. Passing gates alone do not close the broader goal.

## Supported everyday workflows

| Original scenarios | Current supported outcome and evidence |
| --- | --- |
| S01–S06 | Typed point/edge/profile selection, filters, directional boxes, overlap choices and matching highlights/focus; guarded preview/Cancel/history. `cadSketchGraphInteraction.ts`, Canvas/GraphLayer and the spatial-selection review support this. The latest checklist records the repaired single-gesture drag from a mixed selection; current GraphLayer no longer requires a preliminary singleton gesture. |
| S07–S12 | Legacy primitive/slot/path grips, graph free-point and circle-radius gestures, exact selected-set translation, expression-aware axes, open/closed line–arc drawing and shared geometry snaps. Circle-radius, Move, fresh-path and legacy-position-snap acceptance include actual parts and exact source/history checks. Generated or linked geometry retains deliberate owner restrictions. |
| S10, S13–S15 | Driving aligned/X/Y, conventional angle and radial dimensions; saved calculated references and Make driving; inspectable relations, freedoms and rejection operands. Coincident, H/V, fixed, equal size, parallel/perpendicular/collinear, midpoint, concentric, point symmetry and sliding point-on-line are delivered. The latest guided-bore proof includes off-guide drag, parameter following, zero freedoms and a real Pad. Ordinary Tangent is the exception below. |
| S16–S17 | Exact Split; end/middle line and arc Trim; circle Trim; line/arc Extend; independent signed analytic Offset. Witnessed proposals, explicit dependency blockers, retained direction/radius owners and native whole-candidate certification are implemented. The arc-boundary/Offset reviews record complete human/agent parts, not merely successful queries. |
| S18–S20 | Same-base preceding line/circle Use with strict refresh/Detach; independent legacy/DXF/plugin profile Copy; detached graph Mirror; persistent circle rows with count/pitch/omissions; construction conversion. Intersecting-cell selection/union and explicit consumer-area repair make these useful downstream. Broader eligibility is bounded, not implied. |
| S04, S21–S22 | Owned consumed-sketch editing supplies local Undo/Cancel and one strict whole-part Finish, with explicit area repair. Recorded browser/native journeys exercise toolbar/context/keyboard routes, exact history, guarded agent equivalents and save/reopen. Browser-cache and folder tests preserve identities/drivers and reject forged source before writes. This is substantial coverage, not every cross-command permutation. |

## Remaining blocking workflows

1. **Revise an ordinary smooth line–arc transition. Now accepted.** The bounded perpendicular mapping supersedes the earlier directed-angle failure. Tangent retains actual endpoint identity, strict branch/contact/arc checks and complete source authority. Chromium/Firefox and native pointer acceptance cover R5→8, private Finish, solid, exact section/DXF, history and save/reopen. See the current tangency plan and checklist. General circle/arc–arc support tangency is a scope limit.

2. **Reorient a reused noncircular detail precisely. Source-confirmed missing interaction.** The original transform contract explicitly includes anchor-to-anchor movement and exact rotate/copy. Current `cadOperations.ts` and Workbench offer ΔX/ΔY translation, Mirror and profile Copy, without a selected-geometry rotation/pivot or anchor-to-anchor placement command. A copied D-shaped mounting detail cannot be placed at a known angle through a shared exact operation. This is missing behavior, not a measured solver failure. A bounded rigid placement/copy contract should precede a general transform framework.

## Limits and next action

Circle-only rows leave wider S19 layouts partial. General projection, associative Offset, intersection/on-entity/alignment inference and arbitrary curve-corner treatments remain scope limits; this read establishes no additional failing part. Splines, 3D sketches and automatic constraint suggestions remain optional commercial expansion. Cross-command S21 combinations outside recorded journeys are unverified concerns, not asserted defects.

The rounded-profile acceptance is complete. Next prioritize precise reusable-detail placement. Keep the overall sketch audit open; do not reopen historical gaps or numerical sweeps.
