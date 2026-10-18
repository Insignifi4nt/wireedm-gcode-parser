# Retained arc-radius native feasibility

2026-10-16, after local `f6a7cb9`. Separately authorized bounded preflight through the existing pinned runtime; no production, schema, tolerance, solver, package or build changes by this task. Known candidates were constructed directly, without bypassing a hosted operation or changing the current dependency checks. This section establishes feasibility, not final public-query/UI acceptance.

Ignored evidence: `tmp/sketch-arc-radius-owner-preflight.{mts,log,json}`. Reusable complete source/candidate documents: `tmp/sketch-arc-radius-owner-fixture.json`. Node 24 execution exited 0; the only harness repair was a missing runtime import, before any native call.

| Known geometry | Actual native result | Exact source/candidate |
| --- | --- | --- |
| Quarter arc with diameter text `' 2 * stockRadius '` | Success, 3 DOF | Complete graph unchanged |
| Start replaced from old A `[10,0]` to C `[6,-8]`, retained center/direction/end and both material chords | Success, 3 DOF | Complete graph unchanged, including old A, all strings and diameter record |
| Same start-side result without the diameter owner | Success, 4 DOF | Complete graph unchanged; the diameter supplies one condition |
| Original numeric-endpoint D with radius text `' stockRadius '` and construction-circle equality `['peer','arc']` | Success, 6 DOF | Complete graph unchanged |
| Known middle Trim: old A→P / new Q→B, original owners plus ordinary sibling equality | Success, 4 DOF | Complete graph unchanged; both arcs remain R10 quarter arcs |
| Same middle result without its new sibling equality | Success, 5 DOF | Complete graph unchanged; the sibling equality supplies one condition |

All six checks returned empty actual conflict, redundancy, partial-redundancy and independent-issue arrays. The start-side arc's native radius spoke changes to C while the original diameter scalar/quantity/ID remains exact. Its signed CCW extent grows from `π/2` to `2.498091544796509`, preserving R10 at both endpoints.

## Ordinary radius edit and atomic contradiction

The middle result uses a string-driven center, free numeric A/B/P/Q, unchanged guide-top strings, and a construction circle with string-driven center `[35,0]` but **numeric** radius. Shared `prepareCadEdits` accepts `stockRadius: 10 → 12`, native Success with 4 DOF and no diagnostic IDs/issues. The four actual arc endpoint radii are `12.000000000000004`, `12.000000000000007`, `12`, `12`; the construction circle's radius becomes exactly `12`. The radius expression, both existing equality operands/order, new sibling equality and every string-driven point remain exact. Independent structural/radius checks pass unchanged.

The endpoints retain free angular degrees of freedom, so this solve legitimately redistributes their numeric angles. It is **not** evidence of uniform scaling, fixed tooth/part shape or preserved unexpressed angular intent. Product verification should check the actual solved geometry/material and stated constraints, not assume those extra properties.

One separately authorized contradictory batch fixes A at its radius-10 position `[-8,6]` while requesting radius 12. `CadSession.editPrepared` rejects with **`sketch-conflicting`**, actual native conflict IDs `stock-radius` and `fixed-radius-10`, no redundancy IDs, and native Failed status. The exact original session snapshot and `stockRadius=10` remain accepted; neither the fixed relation nor the parameter advances. These IDs come from the real native result, not a fabricated independent diagnosis.

This is a bounded go for the proposed retained-support interpretation with this ordinary driver composition. Fixed or additional driver configurations may still safely reject; no general independence or solver-convergence guarantee is claimed. Actual constructors, stale intent, consumed-area references and complete human/agent part acceptance remain subsequent integration gates.

## Shared preparation integration

After the go decision, root authorized changes only to existing `cadSketchTrimPreparation.test.ts` and `cadSketchExtendPreparation.test.ts`. The obsolete matching-radius rejection first fails under the new approved policy (`tmp/sketch-arc-radius-owner-obsolete-red.log`). Its replacement exercises the actual public middle-Trim query/constructor, complete native candidate equality, unchanged old radius/peer equality records and the one ordinary sibling equality. It then prepares the real R12 parameter edit on a document containing the explicit selected-area Pad, and rejects the independent fixed-R10/R12 contradiction without advancing that session. The new start-side Extend case uses the actual query/constructor and verifies the exact diameter record while the arc's start identity changes. No extra fixture file or native binding was added.

Both affected existing suites pass **13/13** (`tmp/sketch-arc-radius-owner-integration-tests.log`); scoped checking of the two test paths and their dependencies exits cleanly (`tmp/sketch-arc-radius-owner-integration-types.log`). This is shared source/preparation evidence; full UI/native-solid acceptance remains root's gate.

## Consumed area reference after resizing

A read-only check against the already solved R12 graph keeps the original post-Trim one-cell selector valid and byte-structurally unchanged. Its current packed reference is identical: one cell before/after, material area **253.07963267948966 → 354.69129053248287 mm²**. The complete document with the original Pad definition passes strict parsing. Evidence: `tmp/sketch-arc-radius-owner-consumed-read.{mts,log,json}`; this check performs no additional native solve or solid build. The automated preparation case above also accepts the same Pad through the ordinary parameter edit.

Boundary topology changes still need the existing explicit repair; this particular numeric resize preserves the referenced identities/events, so forcing another repair would be incorrect. The measured R12 area comes from the actual free-angle solution and is not a uniform-scale expectation.
