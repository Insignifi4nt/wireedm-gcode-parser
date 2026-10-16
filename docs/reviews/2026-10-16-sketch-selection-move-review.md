# Exact sketch Move review

Independent review of local changes after `4e7bee9`, 2026-10-16, against the [Move plan](2026-10-16-sketch-selection-move-plan.md). Scope: canonical selection promotion, source translation, shared preparation, private draft allowance, RelationsPanel Move ownership and contextual dock routing. Unwired arrangement is excluded.

No open correctness or ownership finding. No production repair was made by this reviewer.

- Selection has one domain atom/schema, with feature re-exports preserving existing consumers. Complete ownership/duplicate validation happens before translation, including a zero move. Mixed overlapping operands move each exact source point once; equal coordinates never imply shared identity.
- The helper preserves all scalar strings and noncoordinate source fields. String coordinates and fixed axes block only nonzero movement on their owned axes. Full treatment support adds its original reference corner once, without recursively selecting adjacent geometry. Partial support keeps outside coordinates exact.
- Local anchor/support vectors reject representational distortion independently of world-origin tolerance. During implementation, the owner reproduced and fixed a near-half-turn arc rounding case: the existing signed sweep now also preserves minor/half-turn/major classification. The CW/CCW regression is red-first; no tolerance or solver setting changed.
- Preparation flushes preceding intents, builds one affine candidate, solves through the ordinary path, and compares the whole returned document with that candidate before later edits. Selected-target drift, outside coordinates, circle radii or other source mutation cannot pass on native Success alone. The zero-vector path skips solving and preserves session redo/history.
- Move reuses the existing RelationsPanel submission, preview, stale-source pin and AbortSignal owner. Its discriminated mode holds workflow ownership even at zero displacement, and Cancel restores ordinary selection editing. Consumed-sketch edits remain private until one normal whole-part Finish; existing late-result/workflow guards and bounded local history remain in force.

Verification: **24 focused cases passed** across translation, real native preparation, private drafts, panel and dock. This includes blocked native projection, ordered parameter/Move/dimension batches, outside drift, treatment support, branch precision, zero history, local/global Undo, cancellation and stale owners. Log: ignored `tmp/cad-move-independent-focused.log`.

Two additional independent real-native probes moved only the ordinary far endpoint of an incident filleted/chamfered line. Both succeeded exactly while retaining every treatment/support point and relation. Thus merely touching a treated incident edge does not over-block valid endpoint edits. Probe and output: ignored `tmp/cad-move-independent-audit.ts` and `.log`.

The owner also reports **46/46** helper/preparation/private-draft cases in `tmp/sketch-move-focused-final.log`; that log was inspected. No full suite, production build or browser journey was rerun by this reviewer. Those final acceptance checks remain with the parent owner.

## Parent acceptance

Completed against this frozen patch: full TypeScript, shared UI validation, production build and icon integration passed. The related panel/selection suites passed 127 cases; tool/viewport suites passed 52. All 19 production sketch journeys passed separately in Chromium and Firefox. Logs are ignored `tmp/sketch-move-{ui,tool-boundaries,all-types,shared-ui,build,icons,all-chromium,all-firefox}.log`.

The in-app browser also exercised the actual private sketch workflow on an unsaved 20 × 10 mm plate with a parameter-driven bore and an extrusion. A constrained edge move was rejected without changing the source. Moving the four plate edges, bore and an overlapping selected point by (10, 5) moved each support once. Preview, local Apply/Undo/Redo, private Finish and global Undo preserved the exact original strings and outside point. The resulting solid had bounds (10, 5, 0)–(30, 15, 5), volume 937.168146928204 mm³ and no diagnostics. Registered WebMCP repeated exact Move and the history-free zero move. The owned test tab was reset to empty; no saved user project changed. Visual evidence: ignored `tmp/sketch-selection-move.png`.

This is a completed local checkpoint, not acceptance of the broader overnight sketch goal. No push, pull request, merge or deployment occurred.
