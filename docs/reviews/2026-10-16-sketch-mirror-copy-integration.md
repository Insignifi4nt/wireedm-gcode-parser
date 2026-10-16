# Mirror copy integration evidence

2026-10-16, following local `979e2f6`. The first section is an authorized known-candidate preflight, before the source API implementation. No reflection constructor, solver mapping, saved schema or tolerance was changed for it.

## Pinned native go/no-go

Ignored evidence: `tmp/sketch-mirror-native-preflight.{mts,log,json}`. Stable paired-bore source/candidate documents: `tmp/sketch-mirror-paired-bore-fixture.json`. Node 24 execution exited 0.

- A quarter arc, closing chord and inner circle reflected about **x=30** form an exact native candidate: **Success, 11 DOF**, empty conflict/redundancy/partial-redundancy/independent-issue arrays. The original closure uses two Coincident relations through an unselected alias point. The copy preserves only the two selected members with one fresh internal Coincident relation; it does not copy or attach to the outside alias. All old records/drivers remain exact. The reflected arc is R10 with signed sweep `-π/2`; the full compiler reports four nonconstruction cycles, preserving both closed outlines and their circles.
- A 60×30 plate with original center `['15','15']`, radius source `' boreDiameter / 2 '` at parameter 6, and construction axis x=30 accepts an independent numeric R3 copy at `[45,15]`: **Success, 3 DOF**, whole graph exactly unchanged and no diagnostic IDs/issues.
- Ordinary preparation adds a new diameter source `'8.000'` to the copy: source radius remains 3, copy becomes 4. Changing only original `boreDiameter:6→10` then makes source radius 5 while the copy remains R4 at `[45,15]`. Both solves return Success, 2 DOF, clean diagnostics; all original point/entity records and expression text remain exact. Existing material resolution measures **1721.460183660255 mm²**, then **1671.1947012028186 mm²**. Their Pad-5 equivalents are `9000−125π` and `9000−205π`; no native solid was built in this preflight.

This is a bounded native **go** for the known x=30 candidates. No oblique/scale/overlap sweep was run. The actual reflection arithmetic, oblique support certificate, deterministic allocation, rejection policy, public constructor and interaction ownership remain implementation gates; numeric native acceptance alone cannot establish them.

## Shared seams to extend

`cadOperations.ts` needs one strict `mirror-sketch-geometry` edit embedding the request and calling the shared pure preparer. `appendCadSketchEntities` already checks graph namespaces plus legacy profile IDs; reuse that boundary rather than reconstructing another collision policy. Saved output remains existing schema-2 numeric points/entities and internal Coincident relations.

`cadEditPreparation.ts` must place Mirror in the existing **flush → construct → native solve → complete candidate equality** branch. Generic append/ordinary pending reduction alone would allow native changes to a supposedly exact copy. Keep one Mirror-specific intent error, current signal checks and prior source/axis parameter solves. No new native primitive or preparation service is needed.

`cadSketchRegionInspection.ts` needs one mutually exclusive `proposal.mirror` request with current numeric parameter override semantics, using the identical pure preparer inside `activeSketch`. Its source-only candidate permits later explicit consumer repair; it does not solve changed unsatisfied drivers or certify the full part. Shared tool schemas/discovery and existing captured version/proposal cache guards should inherit the arm, without another registered tool or inspection receipt state.

`CadSketchEditDraft.validateEdits` needs the new edit in its existing owned-sketch allowlist. Its bounded private history, source pin, minimal final snapshot, local Cancel and explicit area repair already serve appended geometry. A new hole can stale a plate's explicit selector; consumers must receive an inspected replacement in the same accepted batch/Finish.

For the human owner, reuse Offset's pinned document/version/source/prefix, shared prepared preview, Apply/Cancel and exact own-publication allowance. Canvas currently receives `editorPending` as a lock, and GraphLayer/Canvas/overlap/keyboard selection all eventually call normal selection callbacks. Axis choice therefore needs the plan's narrow operation-local eligible-line route, plus exemption only for its own current choose-axis stage. Source selections remain frozen; point/radius dragging, box/drawing/destructive commands and foreign workflow/storage locks must stay blocked. Do not overwrite the user's persisted Auto/Points/Edges preference. Existing menu source/frame capture and shared async cancellation remain authoritative; a captured axis ID can retain its meaning after normal navigation once chosen.

## Author-run adapter verification

The shared seams above are now implemented with one strict edit and one mutually exclusive proposal arm. No controller registry, saved type, migration, native primitive or solver policy was added. `CadSketchEditDraft` permits Mirror only on its owned sketch. Region reads construct the same source-only candidate; normal full-part preparation still requires a deliberate replacement for a stale plate selector.

Genuine adapter RED is recorded in `tmp/sketch-mirror-adapters-red.log`: seven new cases failed for the missing edit/proposal/discovery support while 50 existing cases passed. After the implementation, `tmp/sketch-mirror-adapters-first-green.log` records **57/57** across the new exact-native preparation suite and existing region/tool suites. The real pinned runtime accepts the complete paired-bore and mixed candidates unchanged, including the copied internal joint tree. A new copy diameter followed by a source diameter edit remains independent. Preceding numeric source-X and axis-X parameter solves occur before reflection: source 15→20 and axis 30→35 produce copy X=50. Injected native projection and an actual post-solve abort both leave the session snapshot/history unchanged; the former reports `sketch-mirror-intent`.

`tmp/sketch-mirror-private-storage.log` records **79/79** in the existing private-draft and storage suites. The private consumed plate keeps the source accepted part untouched, supports local Undo/Redo, refuses an unrepaired Finish, and publishes source plus explicitly packed two-bore area in one guarded global Undo. The existing browser-cache/folder adapter table saves and reopens an exact numeric copy, then saves an original parameter change without relinking its radius or changing any original graph record. These are ordinary schema-2 saves; storage production is unchanged.

Scoped TypeScript checking of the twelve owned source/test paths and their transitive imports exits 0 (`tmp/sketch-mirror-adapters-types.log`, config `tmp/tsconfig-sketch-mirror-adapters.json`). Scoped whitespace checking is clean. These are author-run integration results, not an independent review or a production/browser acceptance claim. Native preflight and focused checks do not establish UI completion, association, symmetry constraints or general CAD parity.

Final frozen-domain gate: the same five focused suites pass **136/136** in `tmp/sketch-mirror-adapters-final.log`; the scoped TypeScript check was rerun after domain freeze and again exits 0. No test/type process remains active.
