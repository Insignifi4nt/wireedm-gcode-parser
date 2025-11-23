# Arc Rendering Debug Session – Findings and Fixes

Date: 2025-09-02
Branch: `feat/arc-rendering-debug`
Status: Working fix validated on sample programs; pending wider testing. No commits have been made yet (changes staged in working tree only).

## Summary

We addressed two root causes that produced incorrect G2/G3 arcs and missing G1 link segments:

- Direction + quadrant error when drawing arcs due to a flipped Y-axis transform and angle normalization.
- Linear moves not rendering after arcs because the renderer used the previous move object directly rather than its endpoint.

We also added IJ-absolute (G60 / G90.1) support in the parser, a small debug overlay for arc geometry, and clarified warnings for mode-only lines.

## Symptoms Observed

- Arcs rendered as almost full or semi circles rather than short, quadrant-correct segments.
- Gaps around the circular path (ArcTestFile2.txt), where expected G1 link segments were missing.
- Visual inconsistency between the reference mini-app (where arcs worked) and the main app.

## Root Causes

1) Canvas arc direction under flipped Y-axis

- The canvas context is transformed with `scale(zoom, -zoom)` to flip Y-up into canvas Y-down.
- Canvas `ctx.arc(cx, cy, r, start, end, anticlockwise)` interprets arc direction in the current transformed coordinate system.
- We passed angles computed in world coordinates and then used the wrong anticlockwise flag, causing the long way around (major arc) to be chosen.

2) Linear segment start point after an arc

- The renderer called `_renderLinearMove(prevMove, move)` where `prevMove` is a move object.
- When `prevMove` is an arc, it does not have `{x, y}` fields; its endpoint is `{endX, endY}`.
- The validity check failed and the line draw was skipped, creating visible gaps between scallop arcs.

3) I/J interpretation mode

- The main app always treated I/J as relative offsets from the start point.
- Siemens-style posts use `G60` to make I/J be absolute center coordinates (also `G90.1`/`G91.1` in some controllers).
- Wrong center coordinates → wrong radius and angles → incorrect arcs.

## Changes Made (with rationale)

### 1) Parser: IJ-Absolute Mode

- File: `src/core/GCodeParser.js`
  - Added modal state `this.ijAbsolute` (default `false`) during `_reset()`.
  - Detect mode codes in `_parseLine`:
    - `G60` → absolute I/J center mode
    - `G90.1` → absolute I/J
    - `G91.1` → relative I/J
  - In `_parseArcMove`, compute center as:
    - Absolute mode: `centerX = I`, `centerY = J` (if both present; otherwise fall back to relative with a warning)
    - Relative mode (existing behavior): `center = start + (I, J)`
  - Avoid “Unknown command” warning for mode-only lines where we handled a modal code.

Rationale: Matches the reference app behavior and Siemens post (I/J absolute) so the arc center is correct.

Key references:
- `src/core/GCodeParser.js:66` modal state
- `src/core/GCodeParser.js:163` mode detection (G60, G90.1, G91.1)
- `src/core/GCodeParser.js:306` center computation by mode

### 2) Canvas: Arc Angle Normalization and Direction

- File: `src/components/Canvas.js`
  - Compute `startAngle` and `rawEndAngle` with `atan2`.
  - Normalize delta to match motion code:
    - CW (G2): ensure `delta < 0`
    - CCW (G3): ensure `delta > 0`
  - Set `endAngle = startAngle + delta`.
  - Important: because we flip Y with `scale(zoom, -zoom)`, pass `anticlockwise = move.clockwise` to `ctx.arc(...)`.

Rationale: Ensures the short, intended arc segment is drawn in the correct quadrant under a flipped Y-axis.

Key references:
- `src/components/Canvas.js:597-605` angle normalization
- `src/components/Canvas.js:609-615` call to `ctx.arc` with corrected anticlockwise

### 3) Canvas: Render G1 After Arc Properly

- File: `src/components/Canvas.js`
  - Added `_getMoveEndPoint(move)` to return `{x, y}` for linear moves and `{endX, endY}` for arcs.
  - In `_renderGCodePath`, when drawing a linear move, compute the `from` point as the previous segment’s endpoint via `_getMoveEndPoint(prevMove)`.

Rationale: Prevents skipping G1 segments that follow arcs (fixes gaps seen in ArcTestFile2.txt).

Key references:
- `src/components/Canvas.js:568` render function
- `src/components/Canvas.js` helper `_getMoveEndPoint` (added below the path renderer)

### 4) Debug Overlay for Arc Geometry (Optional)

- Files: `src/components/Canvas.js`, `src/utils/Constants.js`
  - Adds `DEBUG.SHOW_ARC_GEOMETRY` flag. When true, draw a small marker at the arc center and dashed spokes to start/end points.
  - Useful to visually verify center, radius, and angles while debugging.

Key references:
- `src/components/Canvas.js:618-638` overlay draw
- `src/utils/Constants.js:245-252` debug flag

## Visual/Behavioral Results

- Arcs now render on the correct minor arc path (no more almost-full circles) and flow smoothly into the next line/arc.
- The scalloped circle example (ArcTestFile2.txt) shows the straight G1 connectors between arcs instead of gaps.
- When `G60` is present, centers are interpreted as absolute and match the reference mini-app.

## Testing Performed

- Loaded `testing_gcode_files/ArcTestFile2.txt` and visually verified:
  - Arcs match expected quadrants and lengths.
  - G1 segments between arcs are visible and continuous.
- Turned on `DEBUG.SHOW_ARC_GEOMETRY` to verify centers/spokes line up with the geometry.

How to enable overlay:
1) Edit `src/utils/Constants.js`, set `DEBUG.SHOW_ARC_GEOMETRY = true`.
2) Reload and inspect centers/spokes while zooming.

## Known Limitations / Follow-Ups

- Modal motion reuse (no G word): Lines like `N1430 X13040 Y600 I13040 J0` lack an explicit G-word. Our parser currently does not reuse the prior modal motion for such lines; they will be skipped with a warning. If needed, we can add a `lastMotion` state (like in the reference app) to support modal execution.
- R-format arcs are not supported; only I/J.
- Only XY plane (G17) is assumed. U/V or taper arcs are not handled.
- We keep warnings for non-motion G-codes (e.g., G41/G38). We can whitelist if desired.
- High-DPI mode exists but is disabled by default; continue to validate transforms if enabling it.

## Implementation Notes

Angle and direction under flipped Y-axis:

- We normalize `delta = end - start` in world (Y-up) so that its sign matches G2/G3 intent.
- Because the canvas transform flips Y, the `anticlockwise` argument must effectively be inverted relative to world intent. Passing `anticlockwise = move.clockwise` ensures the visual path follows the intended world direction.

Arcs vs lines continuity:

- Arcs store endpoints as `{startX, startY, endX, endY}`; lines store points as `{x, y}`.
- Rendering code must always derive the “from” point from the previous move’s endpoint, not from the raw previous move object.

I/J Absolute (G60, G90.1) vs Relative (G91.1):

- In absolute mode, I/J carry absolute center coordinates directly; in relative mode, they are offsets from the start point.
- Missing I or J in absolute mode logs a warning and safely falls back to relative behavior to avoid hard failures.

## Change Log (by file)

- `src/core/GCodeParser.js`
  - Added `ijAbsolute` state; detect `G60`, `G90.1`, `G91.1` in `_parseLine`.
  - Compute center according to mode in `_parseArcMove`.
  - Suppress “Unknown command” warning when only a modal was processed.

- `src/components/Canvas.js`
  - Normalize angles and pick short path; call `ctx.arc` with corrected `anticlockwise`.
  - Render G1 from previous segment’s endpoint via `_getMoveEndPoint`.
  - Optional debug overlay for centers and spokes.

- `src/utils/Constants.js`
  - Added `DEBUG.SHOW_ARC_GEOMETRY` flag.

## Next Steps

- Decide whether to implement modal motion reuse (persist last G-code when a line omits the G word). If yes, mirror the reference mini-app’s approach.
- Add support for R-format arcs if your post uses them.
- Expand tests with more real programs (with and without `G60`).
- Consider quieting known non-motion codes to reduce warnings in production.

---

Prepared by: Codex CLI debugging session
Review reminder: No commits have been made yet; please review diffs, test additional files, and then we can create a focused commit and PR.

