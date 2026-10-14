# Correlated CAD plugins and generated gear roots

Local follow-up on the unreleased 0.0.697 CAD worktree. This record supersedes the first plugin checkpoint's geometry and UI limitations. No merge, deployment or physical manufacturing verification is claimed.

## Geometry

Spur gear v2 uses Douglas Wright's [DANotes Appendix B](https://danotes.mech.uwa.edu.au/gears/appendices.pdf) equations for the involute and rolling rack-tip envelope. The full-depth rack uses addendum 1, dedendum 1.25 and clearance 0.25. Cutter rounding is capped by clearance and available rack tip width, retaining 5% of the feasible tip land. This supports steep pressure angles without overlapping root transitions. It does not infer the tip shape of an arbitrary numbered form cutter.

Trochoidal roots meet their involute flanks tangentially. Root and tip circles remain analytic. Flanks and roots use chords with an analytic second-derivative interpolation bound, at most the applied tolerance. Root subdivision uses interval-local bounds; no sample-only error claim is used. Undercut, pointed or thin tips below 0.2 × module, overlapping transitions and excessive edge counts are rejected. The module/tooth/pressure-angle range is conditional on these geometric and modeling limits.

The default tolerance is min(0.005 mm, module/200). The 8,192-edge budget is unchanged. Independent tests cover the source coordinate system, tooth thinning sign, placement/scaling, root/flank tangent continuity, envelope normal contact, cutter-dependent undercut and dense approximation checks. A 300-tooth module-0.05 gear passes at its automatic 0.00025 mm tolerance. Native material volume matches an independent Green integral, and a solid section transfers two closed contours while preserving approximation diagnostics.

Nominal geometry validation does not certify strength, fatigue, load, mating clearance or compatibility with a particular physical cutter. Tooth thinning applies to one gear, not an entire gear pair.

## Shared plugin rules

API 2 adds explicit derived relations, conditional field editing, numeric choices, dependent limits and constraints. Graph evaluation supports forward references and rejects cycles and unknown names. Editable inputs remain distinct from derived outputs. Static and dynamic ranges intersect; declared choices must satisfy the static input type/range. Disabled values remain stored and recipes explicitly compute effective geometry. Invalid input batches never modify the saved profile.

Independent API review corrected function-name/variable ambiguity, irrelevant inactive ranges, shared inspection metadata, contradictory bounds and impossible choices. `cad_inspect_plugin` exposes the same evaluator with version/workflow/cancellation guards. Both API versions remain supported. Installation still preserves exact source bytes through the existing cache/folder transaction operation; no storage migration or original deletion was introduced.

## Browser workflow and design checks

1. Existing profile configuration was overcrowded: duplicate labels/results, full-height properties, package prose and cutter presets obscured the driving inputs. The new configuration is a 320 px floating card with horizontal rows, a single X/Y/rotation row, locked derived sizes and collapsed advanced/details sections. Preserved named expressions remain visible through an fx indicator.
2. The original picker mixed selection and authoring. The new searchable list focuses ordinary Add operations; a separate authoring view retains validation and immutable installation. Live API 2 example validation succeeds.
3. Legacy root geometry remained unchanged on open. Explicit Upgrade, then Apply, rebuilt the user's profile with rounded roots and retained the module/bore/thickness settings and bindings. A separately preserved portable v1 original remains available.
4. Live input/version inspection confirmed automatic shift 0.29813333935693415 for 12 teeth at module 4, 20 degrees. The resulting solid built without diagnostics. Undo restored 18 teeth. The saved part is now named Parametric spur gear and retains the user's module 4, 12 mm bore and 10 mm thickness.
5. Fillet/Chamfer are grouped in an accessible toolbar menu. Their existing native selected-edge and all-edge operations remain intact. Exact concave-corner tests verify expected arcs/sections and volume. Ordinary solid fillets do not replace cutter-generated gear roots.

Before/after screenshots are retained as local browser artifacts. Keyboard focus, conditional disabled controls, expression preservation and rejected edits have DOM tests; screenshots alone are not accessibility certification. The saved gear is left open in the in-app browser.

## Validation and compatibility

Final CAD run: 89 files, 1,089 tests pass. Production TypeScript/build, documentation/schema parity across 92 files, pinned corresponding-source distribution and release compatibility check pass.

An initial broad run passed 1,080/1,081 tests; the existing four-body, 2,000-vertex-per-body topology fixture exceeded its 20-second timeout, including an isolated run. Current and clean HEAD benchmarks returned identical diagnostics and retained volumes, with materially varying native times. Its measured isolated Vitest duration was 24.71 seconds. Only that fixture's timeout/comment changed to 60 seconds; production code, topology limits and original assertions remain unchanged. The final full run passes.

Plugin API 2 documents require an API 2-capable reader. v1 packages and geometry remain pinned until explicit upgrade. Installed posts, post schemas/capabilities/events/audit rules, machine packages, UPID and controller output are unchanged. Approximation notes use existing UPID warning fields and survive sketch or solid-section handoff. Normal reviewed pull-request shipping remains required.
