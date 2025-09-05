#Ideas for UX:

- Being able to click gcode segments inside the canvas, and highlight them in the gcode drawer as well as in the canvas (including hover). This would mean, to disable adding points as default behavior. More explicit: have as default the default mouse cursor with the behavior described under this idea. Have a "Add points" toggle/button, when that's "active" the cursor changes to the current cross cursor for adding points.

- Being able to add points along an existing segment. Have some toggle that snaps onto the "drawn" path, that allows adding points precisely on the path. I thought of this because for example if i have 2 points, G0 X0 Y0, and G1 X10 Y10, With the current system, i can only hover the point and it highlights it, but if i want to add a point precisely on that path, there is no way to do this spot on. 

## Technical Improvements

### Parser Refactor Track (separate from current UI refactor)
- Decision: Keep parser out of the ongoing UI/Event/Canvas refactor. Do a focused parser pass after the current branch stabilizes.
- Rationale: Parser is a stable, single-module API. Refactoring it now risks subtle geometry regressions and churn in Drawer/Canvas mapping.
- Goals:
  - Cohesion: extract tokenization/line pre-processing; keep parse-to-path pure.
  - Modal clarity: centralize handling for XY modes (G90/G91), units (G20/G21), IJ modes (G60, G90.1/G91.1).
  - Deterministic outputs: well-defined path item shapes and line↔path mapping.
  - Diagnostics: structured warnings/errors (codes), graceful limits for large files.
  - Performance: optional streaming/chunked parsing for very large files.
- Non-goals: UI/Drawer/Canvas changes; only the parser internals and tests.
- Mini plan (PRs):
  - PR1: Add Vitest + parser unit tests (fixtures: linear, arc, IJ absolute, G92 header). No logic changes.
  - PR2: Extract tokenizer + modal state container. Preserve external API and outputs.
  - PR3: Gate optional features (units, XY modal) behind flags if needed.
  - PR4: Optimize for large files (chunking/streaming) if performance warrants.
- Current feature note: G92 at header sets start point; mid-program G92 shows a warning and only affects subsequent moves (acceptable for our use).
