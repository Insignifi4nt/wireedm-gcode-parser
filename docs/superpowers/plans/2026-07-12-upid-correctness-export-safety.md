# UPID Correctness and Export Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the active historical and verified DXF/UPID defects, fail closed on unsafe topology, preserve valid G40 centreline cuts, finish the Contour Workbook interactions, and expose machine-controlled post precision.

**Architecture:** External G-code receives one shared lexical/modal interpreter. DXF import becomes strict and provenance-preserving before indexed path planning. A structural UPID validator and post result gate prevent unsafe bodies from reaching Download while keeping diagnostics inspectable. Existing UI and persistence flows consume these focused APIs.

**Tech Stack:** TypeScript, React, Vitest, Testing Library, Vite, Playwright.

## Global Constraints

- Preserve old external editor behaviour and the existing cleanup/display pipeline for `.gcode`, `.nc`, `.iso`, and `.txt` files.
- Keep browser-cache and one-off imports working when directory picker APIs are unavailable.
- V1 output remains header/body/footer G-code; do not generate feeds or invent machine-specific thread/rethread lifecycle codes.
- Output extension remains a filename choice and cannot alter program text.
- Current UPID geometry is a `G40` wire-centre path. A valid open centreline operation remains postable.
- Do not infer or emit `G41`/`G42`, compensation-register changes, or automatic lead-in/lead-out moves in this plan.
- Reversal changes segment traversal and arc direction only; it must not claim compensated dimensional correctness.
- No non-finite coordinate may enter a DXF entity, UPID segment, validator-approved document, or formatted G-code word.
- Approximate geometry must retain its source lineage and set `source.exact` to `false`.
- Branching, duplicate, self-intersecting, corrupt, or unexpectedly discontinuous executable geometry must produce a blocked export with an empty body.
- Do not discard or overwrite the in-progress Contour Workbook files already present in the working tree.
- Follow TDD for every behaviour change: record a focused RED result, implement, then record GREEN.

---

### Task 1: Shared external G-code lexical and modal interpreter

**Files:**
- Create: `src/domain/editor/gcodeBlockInterpreter.ts`
- Modify: `src/domain/editor/gcodeParser.ts`
- Modify: `src/domain/editor/gcodeStructure.ts`
- Test: `src/domain/editor/__tests__/gcodeParser.test.ts`
- Test: `src/domain/editor/__tests__/gcodeStructure.test.ts`

**Interfaces:**
- Produces: `createGCodeInterpreterState(): GCodeInterpreterState`.
- Produces: `interpretGCodeBlock(state, rawLine, lineNumber): GCodeBlockResult`.
- `GCodeBlockResult.motion` is `null` or a resolved `G0`/`G1`/`G2`/`G3` move with start/end and optional centre.
- The interpreter owns comment stripping, word scanning, XY absolute/incremental state, IJ absolute/incremental state, modal motion, and R-arc centre resolution.
- `gcodeParser.ts` remains the public preview parser; `gcodeStructure.ts` remains the public header/body/footer and contour API.

- [x] **Step 1: Add failing parser regressions**

Add tests equivalent to:

```ts
it('preserves words after parenthesized inline comments', () => {
  expect(parseGCodeProgram('G1 X1 (note) Y2').path.at(-1)).toMatchObject({ x: 1, y: 2 });
});

it('tracks G91 XY independently from incremental IJ mode', () => {
  const result = parseGCodeProgram('G91\nG0 X10\nG1 X1\nG1 X1');
  expect(result.path.map((point) => 'x' in point ? point.x : point.endX)).toEqual([10, 11, 12]);
});

it('parses setup and motion words in one block', () => {
  expect(parseGCodeProgram('G90 G0 X5 Y5').path.at(-1)).toMatchObject({ x: 5, y: 5 });
});

it('resolves minor and major R arcs without inventing an IJ zero centre', () => {
  expect(parseGCodeProgram('G0 X0 Y0\nG2 X10 Y0 R5').path.at(-1)).toMatchObject({
    centerX: 5,
    centerY: 0
  });
  expect(parseGCodeProgram('G0 X0 Y0\nG3 X10 Y0 R-10').errors).toHaveLength(0);
});
```

- [x] **Step 2: Add failing structure regressions**

Cover combined setup/motion classification and modal continuation length:

```ts
expect(organizeGCodeStructure(['G90 G0 X5 Y5']).body.lines).toHaveLength(1);

const structure = organizeGCodeStructure(['G1 X3 Y0', 'X3 Y4']);
expect(structure.body.contours?.[0].length).toBeCloseTo(7, 9);
```

- [x] **Step 3: Verify RED**

Run:

```bash
npm test -- --run src/domain/editor/__tests__/gcodeParser.test.ts src/domain/editor/__tests__/gcodeStructure.test.ts
```

Expected: failures reproduce BH-007, BH-016, BH-017, BH-018, and BH-020.

- [x] **Step 4: Implement the shared interpreter**

Use these public shapes:

```ts
export interface GCodeInterpreterState {
  position: { x: number; y: number };
  xyMode: 'absolute' | 'incremental';
  ijMode: 'absolute' | 'incremental';
  motion: 'G0' | 'G1' | 'G2' | 'G3' | null;
}

export interface GCodeInterpretedMotion {
  command: 'G0' | 'G1' | 'G2' | 'G3';
  start: { x: number; y: number };
  end: { x: number; y: number };
  center?: { x: number; y: number };
  clockwise?: boolean;
}
```

The comment scanner removes balanced parenthesized regions in place, stops at `;`, and reports an issue for an unclosed parenthesis. Scan all G words before choosing the block's motion. Apply `G90`/`G91` only to XY and `G90.1`/`G91.1` only to IJ. For R arcs, choose the centre whose directed sweep is minor for positive R and major for negative R; reject `abs(R) < chord / 2`, coincident start/end, and non-finite results.

- [x] **Step 5: Migrate both consumers and verify GREEN**

`gcodeParser.ts` maps resolved moves into its existing path/stats/bounds types. `gcodeStructure.ts` walks blocks with one state per program and calculates exact line/arc length from resolved geometry rather than reparsing isolated lines.

Run the Task 1 command again. Expected: all focused tests pass with no warnings.

- [x] **Step 6: Commit Task 1**

```bash
git add src/domain/editor/gcodeBlockInterpreter.ts src/domain/editor/gcodeParser.ts src/domain/editor/gcodeStructure.ts src/domain/editor/__tests__/gcodeParser.test.ts src/domain/editor/__tests__/gcodeStructure.test.ts
git commit -m "fix: share modal G-code interpretation"
```

---

### Task 2: Storage, settings, keyboard, construction, and Playwright regressions

**Files:**
- Modify: `src/domain/storage/connectWorkbenchDirectory.ts`
- Modify: `src/domain/storage/__tests__/connectWorkbenchDirectory.test.ts`
- Modify: `src/app/workbenchSettings.ts`
- Modify or create: `src/app/workbenchSettings.test.ts`
- Modify: `src/features/editor/EditorPage.tsx`
- Modify: `src/__tests__/editorMeasurement.test.tsx`
- Modify: `src/__tests__/editorPathNativeDraft.test.tsx`
- Modify: `playwright.config.ts`
- Modify: `package.json` only if the task-owned port needs a script argument.

**Interfaces:**
- `connectRememberedWorkbenchDirectory` must return `{status:'error'}` for handle-store read failures instead of rejecting.
- `SettingsDraft.sourceKey` identifies persisted settings content and adapter identity, never `manifest.updatedAt`.
- Measurement clear uses a dedicated shortcut that does not conflict with Copy.
- Construction commit uses the operation returned by `constructMagnetizedPoint`.
- Playwright owns port `3107`, starts this Vite app, and sets `reuseExistingServer: false`.

- [x] **Step 1: Write focused failing tests**

Add:

```ts
it('returns an error result when the remembered handle store read rejects', async () => {
  const result = await connectRememberedWorkbenchDirectory({
    handleStore: { read: async () => { throw new Error('IndexedDB failed'); }, write: async () => {} }
  });
  expect(result).toEqual({ status: 'error', message: 'IndexedDB failed' });
});
```

Add a settings test proving an unrelated `manifest.updatedAt` change keeps the same `sourceKey`. Add an editor test dispatching Ctrl/Cmd+C with measurement points and asserting the points remain and the event is not prevented. Add a construction test that enters perpendicular/tangent mode without a preselected operation, sees a preview, clicks, and gets a saved point from the preview's operation.

- [x] **Step 2: Verify RED**

```bash
npm test -- --run src/domain/storage/__tests__/connectWorkbenchDirectory.test.ts src/app/workbenchSettings.test.ts src/__tests__/editorMeasurement.test.tsx src/__tests__/editorPathNativeDraft.test.tsx
```

Expected: the new assertions fail on BH-005, BH-009, BH-011, and BH-015.

- [x] **Step 3: Implement the root-cause fixes**

Move the handle-store read inside `connectRememberedWorkbenchDirectory`'s `try`. Remove only timestamp volatility from the settings key. Replace Ctrl/Cmd+C clearing with a non-conflicting documented shortcut such as Ctrl/Cmd+Shift+C and retain the visible clear action. In preview commit, remove the preselection guard for construction modes and pass `magnetized.operationId` through the edit. Keep `set-start` requiring explicit selection.

Set Playwright's base URL/web server URL to `http://127.0.0.1:3107`, invoke Vite with `--port 3107 --strictPort`, and set `reuseExistingServer: false` so the existing unrelated port-3000 app is untouched.

- [x] **Step 4: Verify GREEN and config isolation**

Run the focused test command. Then run:

```bash
npx playwright test --list
```

Expected: focused tests pass; Playwright lists this project's tests without connecting to port 3000.

- [x] **Step 5: Commit Task 2**

```bash
git add src/domain/storage/connectWorkbenchDirectory.ts src/domain/storage/__tests__/connectWorkbenchDirectory.test.ts src/app/workbenchSettings.ts src/app/workbenchSettings.test.ts src/features/editor/EditorPage.tsx src/__tests__/editorMeasurement.test.tsx src/__tests__/editorPathNativeDraft.test.tsx playwright.config.ts package.json
git commit -m "fix: harden editor and workbench edge cases"
```

---

### Task 3: Strict DXF parsing, BLOCK transforms, adaptive SPLINEs, units, and provenance

**Files:**
- Modify: `src/domain/dxf/types.ts`
- Modify: `src/domain/dxf/parseDxf.ts`
- Create: `src/domain/dxf/approximateSpline.ts`
- Create: `src/domain/dxf/normalizeDxfGeometry.ts`
- Modify: `src/domain/dxf/dxfToUpid.ts`
- Modify: `src/domain/dxf/importDxfProject.ts`
- Modify: `src/domain/path-intel/types.ts`
- Modify: `src/domain/path-intel/fromDxfEntities.ts`
- Test: `src/domain/dxf/__tests__/parseDxf.test.ts`
- Test: `src/domain/dxf/__tests__/parseDxfSplineFallback.test.ts`
- Test: `src/domain/dxf/__tests__/dxfToUpid.test.ts`
- Test: `src/domain/dxf/__tests__/importDxfProject.test.ts`

**Interfaces:**
- `parseDxf(text, options?)` accepts `curveChordError?: number` and defaults to `0.001` source units.
- Approximate `DxfLineEntity` records `approximation: { sourceEntityType: string; maxChordError: number }`.
- `DxfInsertTransformSource` records `blockBasePoint`.
- `PathPlanningSourceMetadata` records original units and `coordinateScaleToMillimeters`.
- `PathPlanningOptions` accepts `includeLayers?: string[]` and `excludeLayers?: string[]`.
- Known units are scaled once, before segment construction; unknown/unitless coordinates are retained with an explicit diagnostic.

- [x] **Step 1: Add strict-token and finite-number RED tests**

Cover an explicit blank layer value without pair misalignment and malformed LWPOLYLINE coordinates:

```ts
expect(parseDxf(blankLayerDxf()).entities[0]?.layer).toBe('');
const malformed = parseDxf(malformedPolylineDxf());
expect(malformed.entities.flatMap(entityPoints).every(point => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
```

Assert a warning names the rejected malformed entity.

- [x] **Step 2: Add BLOCK and SPLINE provenance RED tests**

Create fixtures proving:

```ts
expect(insertedLine.start).toEqual({ x: 100, y: 200 });
expect(insertedLine.end).toEqual({ x: 105, y: 200 });
expect(insertedLine.source?.insertChain[0].transform.blockBasePoint).toEqual({ x: 10, y: 20 });

expect(blockSpline.entities.length).toBeGreaterThan(1);
expect(blockSpline.entities.every(entity => entity.layer === 'CUT')).toBe(true);
expect(blockSpline.entities.every(entity => entity.approximation?.sourceEntityType === 'SPLINE')).toBe(true);
```

Convert the SPLINE result to UPID and assert all derived sources are `exact: false` and retain block/insert lineage.

- [x] **Step 3: Add units, layer, and 2D-safety RED tests**

Assert an inch LINE from `(0,0)` to `(1,0)` becomes a UPID segment ending at `(25.4,0)` while source units remain inches. Assert `includeLayers: ['CUT']` excludes a `CONSTRUCTION` entity with a diagnostic. Assert classic POLYLINE flags 8, 16, or 64 and tilted extrusion geometry do not become entities; negative-Z planar geometry is normalized deterministically.

- [x] **Step 4: Verify RED**

```bash
npm test -- --run src/domain/dxf/__tests__/parseDxf.test.ts src/domain/dxf/__tests__/parseDxfSplineFallback.test.ts src/domain/dxf/__tests__/dxfToUpid.test.ts src/domain/dxf/__tests__/importDxfProject.test.ts
```

Expected: failures reproduce BH-006/BH-019 and the verified BLOCK, SPLINE, NaN, units, layer, and 2D-safety gaps.

- [x] **Step 5: Implement strict pairs and entity validation**

Keep every value line, including `''`; parse only code lines as integers. Add finite readers for repeated vertices. Return entity-level warnings rather than partially populated geometry. Preserve an explicit blank layer as `''`, distinct from a missing layer `null`.

- [x] **Step 6: Implement BLOCK base-point transforms and adaptive SPLINE approximation**

Store each BLOCK's group-10/20 base point. Transform local points as:

```ts
const local = {
  x: point.x - blockBasePoint.x,
  y: point.y - blockBasePoint.y
};
const geometryOffset = rotate({ x: local.x * scaleX, y: local.y * scaleY }, rotation);
const arrayOffset = rotate({ x: column * columnSpacing, y: row * rowSpacing }, rotation);
const world = add(insertion, geometryOffset, arrayOffset);
```

Scale and rotate block-local geometry, rotate row/column array spacing without scaling it, then apply insertion once. For a planar negative-Z OCS normal, map `(x, y)` to `(-x, y)` and reverse arc/bulge handedness; reject normals with a non-zero X or Y component. Parse SPLINE degree, knots, control points, optional weights, flags, layer, and handle. Evaluate with de Boor and recursively subdivide each non-empty knot span until midpoint-to-chord deviation is at most `curveChordError` (or depth 20). Remove duplicate adjacent points. Emit approximate lines before INSERT expansion so normal provenance/transform logic applies.

- [x] **Step 7: Implement unit normalization and layer filtering**

Scale points, radii, drawing extents/base point, approximation error, and relevant tolerances exactly once. Keep original `$INSUNITS` and record the applied scale. Add deterministic `layer-filtered` and `units-assumed-millimeters` diagnostics to the path document. Do not add UI-only controls.

- [x] **Step 8: Verify GREEN and the real fixture**

Run the Task 3 tests. Add/run a regression using `DXF-test-subjects/z18f25.dxf` and assert 72 exact segments, one closed contour, no error diagnostics, and finite geometry.

- [x] **Step 9: Commit Task 3**

```bash
git add src/domain/dxf src/domain/path-intel/types.ts src/domain/path-intel/fromDxfEntities.ts
git commit -m "fix: preserve DXF geometry and provenance"
```

---

### Task 4: Indexed clustering, duplicate sanitization, topology checks, and performance

**Files:**
- Create: `src/domain/path-intel/spatialIndex.ts`
- Create: `src/domain/path-intel/sanitizeSegments.ts`
- Create: `src/domain/path-intel/intersections.ts`
- Modify: `src/domain/path-intel/types.ts`
- Modify: `src/domain/path-intel/fromDxfEntities.ts`
- Modify: `src/domain/path-intel/endpointClusters.ts`
- Modify: `src/domain/path-intel/chains.ts`
- Modify: `src/domain/path-intel/contours.ts`
- Test: `src/domain/path-intel/__tests__/pathPlanning.test.ts`
- Create: `src/domain/path-intel/__tests__/pathPlanningPerformance.test.ts`

**Interfaces:**
- `sanitizePathSegments(segments, options): SegmentBuildResult` returns finite, non-duplicate executable segments plus diagnostics.
- `SpatialHash<T>` supports point and bounds insertion/query without leaking path-specific policy.
- New diagnostic codes: `non-finite-geometry`, `duplicate-segment`, `overlapping-segment`, and `intersecting-topology`.
- Duplicate/overlap/branch/intersection diagnostics are severity `error`; valid `open-chain` remains `warning`.

- [x] **Step 1: Add exact-cluster diameter RED test**

Use three endpoints at `0`, `0.9e-6`, and `1.8e-6` with `coincidenceEpsilon: 1e-6`. Assert every `method: 'exact'` cluster has `maxPairDistance <= 1e-6` and the extremes are not in one cluster.

- [x] **Step 2: Add duplicate, branch, and intersection RED tests**

For two identical rectangles, assert only four executable segments remain, a `duplicate-segment` error exists, and total planned cut length is one rectangle rather than two. For a T shape, assert `branching-topology` is an error. Add line-line, line-arc, and arc-arc crossing fixtures and assert `intersecting-topology` references both segments without treating shared consecutive endpoints as intersections.

- [x] **Step 3: Add a deterministic performance RED test**

Build 4,000 sequential line segments and time endpoint clustering after a warm-up. The test must use a generous CI-safe limit and also compare growth, for example requiring the 4,000 case to take less than eight times the 1,000 case. Record the pre-fix timing in the task report; do not use an unrealistically tight absolute threshold.

- [x] **Step 4: Verify RED**

```bash
npm test -- --run src/domain/path-intel/__tests__/pathPlanning.test.ts src/domain/path-intel/__tests__/pathPlanningPerformance.test.ts
```

Expected: diameter, duplicate/intersection, severity, and scaling assertions fail.

- [x] **Step 5: Implement sanitization and spatial indexing**

Reject non-finite geometry before calling segment constructors. Canonicalize line endpoints and arc/circle geometry using `coincidenceEpsilon` for duplicate keys; retain the first segment and emit one diagnostic referencing every duplicate source. Use a grid cell size based on epsilon for exact endpoints and endpoint tolerance for near candidates. Before adding a point to an exact group, compare it to every current member so the complete-link diameter guarantee holds.

- [x] **Step 6: Implement bounds-indexed exact intersection checks**

Use the spatial bounds index only as broad phase. Narrow phase must calculate line-line, line-circle/arc, and circle/arc-circle/arc intersections analytically, then filter by segment sweep and epsilon. Collinear overlap is `overlapping-segment`. Shared endpoints of adjacent segments are not intersections; interior crossings and non-adjacent endpoint touches are errors.

- [x] **Step 7: Verify GREEN and benchmark output**

Run Task 4 tests twice to ensure the performance assertion is stable. Run all `src/domain/path-intel` tests. Expected: all pass; 4,000-segment growth is sub-quadratic under the stated ratio.

- [x] **Step 8: Commit Task 4**

```bash
git add src/domain/path-intel
git commit -m "fix: harden UPID topology planning"
```

---

### Task 5: Structural UPID validation, fail-closed post, and configurable precision

**Files:**
- Create: `src/domain/upid/validateUpidDocument.ts`
- Create: `src/domain/upid/__tests__/validateUpidDocument.test.ts`
- Modify: `src/domain/upid/projectUpid.ts`
- Modify: `src/domain/upid/upidDocument.ts`
- Modify: `src/domain/upid/__tests__/projectRail.test.ts` only if diagnostic projection gains codes.
- Modify: `src/domain/upid/__tests__/upidDocument.test.ts`
- Modify: `src/domain/path-intel/postGcode.ts`
- Modify: `src/domain/path-intel/__tests__/pathPlanning.test.ts`
- Modify: `src/domain/workbench/types.ts`
- Modify: `src/domain/workbench/defaultProject.ts`
- Modify: `src/domain/machine/machineProfiles.ts`
- Modify: `src/domain/machine/__tests__/machineFit.test.ts` or create `machineProfiles.test.ts`.
- Modify: `src/app/workbenchSettings.ts`
- Modify: `src/app/MachineOutputSettingsPanel.tsx`
- Test: relevant app/settings component test.

**Interfaces:**
- Produces: `validateUpidDocument(document): UpidValidationReport`.
- `UpidValidationReport` contains `valid`, `diagnostics`, and `blockingDiagnostics`.
- `GcodePostResult` contains `status: 'ready' | 'blocked'`; blocked results have `body: ''`, zero moves, and error diagnostics.
- Low-level `postPathPlanToGcode(plan, segments, options)` blocks only invalid/non-finite/discontinuous plan geometry; document-level topology gating happens in `postUpidToGcode(document, options)` after `validateUpidDocument` supplies the blocking diagnostics.
- `UpidGCodeExport` contains `canDownload` and `blockingDiagnostics`.
- `OutputFormat.coordinatePrecision` is an integer from 0 through 6, normalized to 3 when absent/invalid.
- `GcodePostOptions.coordinatePrecision` controls X/Y/I/J formatting.

- [x] **Step 1: Add validator RED tests**

Mutate otherwise valid documents to contain a missing segment reference, duplicate ID, non-finite coordinate, mismatched operation endpoint, and broken closed-loop continuity. Assert `valid === false` and a descriptive error diagnostic for each. Assert a normal closed fixture and a valid open centreline fixture are valid.

- [x] **Step 2: Add fail-closed post RED tests**

Through `postUpidToGcode`, assert branched/duplicate documents return `status: 'blocked'`, `body: ''`, no moves, and blocking diagnostics. Through `postPathPlanToGcode`, construct an operation with a gap larger than endpoint tolerance and assert it no longer contains an `unexpected-gap` G0. Assert a within-tolerance bridge remains ready with `post-bridged-gap`.

- [x] **Step 3: Add precision RED tests**

Assert profile normalization defaults old data to 3, clamps/rejects invalid precision, and retains an allowed value. Post the same geometry at precision 3 and 5 and expect `X1.235` versus `X1.23457`. Assert `-0` formats as `0.000` and non-finite formatting blocks.

- [x] **Step 4: Verify RED**

```bash
npm test -- --run src/domain/upid/__tests__/validateUpidDocument.test.ts src/domain/upid/__tests__/upidDocument.test.ts src/domain/path-intel/__tests__/pathPlanning.test.ts src/domain/machine
```

Expected: validator/readiness/precision assertions fail.

- [x] **Step 5: Implement graph validation**

Validate each ID collection once with maps/sets. Check all point/bounds/metric fields using finite guards. Resolve every ref and verify oriented operation continuity within `coincidenceEpsilon`; closed operations must end at their start. Convert existing blocking document diagnostics into the report without duplicating IDs. `projectUpidDocument` calls the validator after schema/project checks and throws `Invalid UPID document: ...` for corrupt persisted data.

- [x] **Step 6: Make posting and export fail closed**

Run document validation before composition. Refactor unexpected-gap handling to return an error, abort the in-progress post, and return an empty body/move list. Keep valid open centreline operations ready. For a blocked result, compose the configured header and footer around an empty body so the preview retains machine context, set `canDownload: false`, and expose no posted operations or moves; callers must never receive an enabled executable download from a blocked result.

- [x] **Step 7: Thread precision through the machine profile and settings UI**

Normalize the integer range 0..6. Add a labelled numeric field alongside line ending/extension. Pass project machine precision into `composeUpidGCodeExport` and the post. Use one formatter instance per post and reject non-finite values before interpolation.

- [x] **Step 8: Verify GREEN**

Run Task 5 tests plus all `src/domain/upid`, `src/domain/path-intel`, `src/domain/machine`, and relevant app settings tests. Expected: all pass with pristine output.

- [x] **Step 9: Commit Task 5**

```bash
git add src/domain/upid src/domain/path-intel/postGcode.ts src/domain/path-intel/__tests__/pathPlanning.test.ts src/domain/workbench src/domain/machine src/app/workbenchSettings.ts src/app/MachineOutputSettingsPanel.tsx src/__tests__
git commit -m "fix: validate and gate UPID exports"
```

---

### Task 6: Export readiness UI and Contour Workbook completion

**Files:**
- Modify: `src/features/editor/EditorPage.tsx`
- Modify: `src/features/editor/EditorUpidExportPreview.tsx`
- Modify: `src/features/editor/EditorPathNavigatorPanel.tsx`
- Modify: `src/__tests__/appDxfProjects.test.tsx`
- Modify: `src/__tests__/editorPathNativeDraft.test.tsx`
- Modify: `src/features/editor/__tests__/EditorWorkspacePanels.test.tsx` if affected.
- Preserve and finish: `docs/superpowers/specs/2026-07-10-contour-workbook-design.md`
- Preserve and finish: `docs/superpowers/plans/2026-07-10-contour-workbook.md`

**Interfaces:**
- `EditorUpidExportPreview` receives `canDownload` and `blockingDiagnostics`.
- A blocked preview labels itself clearly, disables Download, renders/selects the blocking diagnostics, and shows no posted cut rows.
- Contour, segment, endpoint, and lead-in rows call `onHoverPathElement` on pointer enter/focus and clear it on leave/blur.
- Segment detail disclosure remains independent from contour-card disclosure.

- [x] **Step 1: Add blocked-export UI RED test**

Build a path document with branching/duplicate error diagnostics, open Export Preview, and assert:

```ts
expect(screen.getByRole('button', { name: /download upid export/i })).toBeDisabled();
expect(screen.getByText(/export blocked/i)).toBeInTheDocument();
expect(downloadSpy).not.toHaveBeenCalled();
```

Select a blocking diagnostic and verify the affected path element becomes selected.

- [x] **Step 2: Restore Contour Workbook behaviour tests**

Update stale text-only expectations to the approved compact workbook hierarchy, but retain behavioural assertions for selection, canvas cross-highlight, contour disclosure, independent segment disclosure, nested contours, endpoint reveal, keyboard focus, and hover help. Add a focused regression that hovering each row kind calls the shared hover callback and leaving clears it.

- [x] **Step 3: Verify RED**

```bash
npm test -- --run src/__tests__/appDxfProjects.test.tsx src/__tests__/editorPathNativeDraft.test.tsx src/features/editor/__tests__/EditorWorkspacePanels.test.tsx
```

Expected: blocked readiness and lost hover regressions fail; stale tests identify only approved layout changes.

- [x] **Step 4: Implement readiness and finish the workbook**

Pass `canDownload` through `EditorPage`. Disable the preview action with `aria-disabled`/`disabled`, show the count and messages of blocking errors, and guard the download handler as defense in depth. Restore hover/focus handlers with the same `EditorPathElementRef` used by selection. Keep exact coordinates and start actions inside independently expanded segment details. Preserve all meaningful `data-upid-*` hooks.

- [x] **Step 5: Verify GREEN and build**

Run the Task 6 tests, then:

```bash
npm run build
```

Expected: focused tests and TypeScript/Vite build pass; only the known chunk-size advisory may remain.

- [x] **Step 6: Commit Task 6**

```bash
git add src/features/editor src/__tests__/appDxfProjects.test.tsx src/__tests__/editorPathNativeDraft.test.tsx docs/superpowers/specs/2026-07-10-contour-workbook-design.md docs/superpowers/plans/2026-07-10-contour-workbook.md
git commit -m "fix: complete safe UPID editor workflows"
```

---

### Task 7: Integrated verification, ledger closure, and final review

**Files:**
- Modify: `docs/superpowers/2026-07-08-bug-hunt-ledger.md`
- Modify: this plan to check completed tasks if useful.

**Interfaces:**
- The ledger records each historical finding as fixed with its regression-test evidence.
- No production behaviour is added in this task.

- [x] **Step 1: Run domain and focused integration suites**

```bash
npm test -- --run src/domain
npm test -- --run src/__tests__/editorMeasurement.test.tsx src/__tests__/editorPathNativeDraft.test.tsx src/__tests__/appDxfProjects.test.tsx
```

Expected: all pass with no unexpected console errors.

- [x] **Step 2: Run the full unit suite and build**

```bash
npm test -- --run
npm run build
```

Expected: all tests pass; build succeeds. The existing bundle-size advisory is non-blocking but must be reported accurately.

- [x] **Step 3: Run Playwright against the owned server**

```bash
npm run test:e2e -- --reporter=line
```

Expected: the server starts on 127.0.0.1:3107, page title belongs to Wire EDM Workbench, and all non-explicitly-skipped scenarios pass. Do not stop or reuse the unrelated process on port 3000.

- [x] **Step 4: Re-run real-fixture and performance checks**

Run the `z18f25.dxf` regression and the path-planning performance test in the final tree. Record exact segment/contour/diagnostic counts and timings in the implementation report.

- [x] **Step 5: Update the bug ledger**

Mark BH-005/006/007/009/011/015/016/017/018/019/020/021 fixed and cite the test file for each. Keep historical verification notes; do not rewrite the ledger as if the bugs never existed.

- [x] **Step 6: Request the final whole-branch review and address every Critical/Important finding**

Generate a review package from the branch base through HEAD. The reviewer must assess the entire change against the design, including safety gating, compatibility, tests, and the explicit compensation boundary. Any fixes must re-run their covering tests before re-review.

- [x] **Step 7: Commit verification documentation if changed**

```bash
git add docs/superpowers/2026-07-08-bug-hunt-ledger.md docs/superpowers/plans/2026-07-12-upid-correctness-export-safety.md
git commit -m "docs: close UPID correctness audit"
```
