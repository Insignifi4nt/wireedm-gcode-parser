# UPID Correctness and Export Safety Design

Date: 2026-07-12

## Goal

Close the still-active findings from the 2026-07-08 bug hunt and the verified DXF-to-UPID audit. The import, topology, editing, and posting pipeline must reject or surface unsafe geometry instead of silently producing plausible-looking machine text. Valid G40-style centreline paths, including open slots, must remain supported.

This change also finishes the in-progress Contour Workbook interaction work and leaves a deliberate boundary for the next phase: compensation-aware direction reversal plus lead-in and lead-out modelling.

## Scope

### Historical findings

The implementation closes BH-005, BH-006, BH-007, BH-009, BH-011, BH-015, BH-016, BH-017, BH-018, BH-019, BH-020, and BH-021. Findings already fixed in the current branch history remain covered by their existing tests.

### Verified DXF and UPID defects

The implementation also closes these reproduced defects:

- BLOCK base points are ignored during INSERT expansion.
- Unsupported curves inside referenced BLOCKs are not flattened.
- Flattened curve segments lose layer/source lineage and are incorrectly marked exact.
- Malformed numeric DXF values can survive as `NaN` and reach posted G-code.
- Exact endpoint grouping can have a diameter larger than its configured epsilon.
- Branching topology and duplicate geometry can become executable operations.
- An unexpected discontinuity inside an operation becomes a rapid move instead of a hard posting failure.
- Endpoint clustering scales quadratically on ordinary large drawings.
- Post coordinate precision is fixed rather than machine-profile controlled.
- The partial Contour Workbook refactor lost navigator-to-canvas hover behaviour and left stale UI expectations.

## Explicit Boundary for Compensation Work

The current geometry is a wire-centre path and the default machine template enters `G40`. An open chain is therefore not itself an export error; it can represent a centreline slot. Closed paths are also posted as centreline geometry until compensation is modelled.

This slice does not infer `G41` or `G42`, change a compensation register, or synthesize lead-in/lead-out moves when an operation is reversed. Reversal continues to reverse segment order and arc direction only. The next design must make compensation mode, desired part side, direction, and safe activation/cancellation moves one coherent operation-level decision. No code in this slice may claim that a reversed compensated contour is dimensionally correct.

## Architecture

### 1. Shared external G-code lexical and modal interpretation

External-program parsing and structure analysis will use one comment stripper and word scanner. Parenthesized comments are removed in place while text after the closing parenthesis is preserved; semicolon comments still consume the rest of the line. Motion words may appear anywhere in a block, including after setup words such as `G90`.

The modal interpreter tracks XY distance mode separately from IJ centre mode. It resolves modal continuation lines, combined setup/motion blocks, and both I/J and R-format arcs. R arcs are rejected with a line issue when radius/chord geometry is impossible or ambiguous rather than silently becoming a zero-centred I/J arc. Structure grouping and contour length consume the same interpreted moves so their coordinates and metrics cannot drift from the preview parser.

### 2. Strict DXF ingestion with explicit approximation provenance

The pair tokenizer retains blank value records and only trims the group-code line. Numeric readers accept finite values only. A malformed required coordinate rejects that entity and produces a warning; no non-finite coordinate may enter a `DxfEntity`.

BLOCK definitions retain their base point. INSERT expansion subtracts the BLOCK base point before array offset, scale, rotation, and insertion translation. This applies recursively and is recorded in insert provenance.

SPLINE fallback is parsed and flattened by the app with adaptive subdivision bounded by a configured chord error. It works in ENTITIES and referenced BLOCKs. Every derived line retains handle, layer, block/insert lineage, original entity type, and approximation metadata. UPID source refs set `exact: false` for these lines. Unsupported entities that cannot be approximated remain warnings and never masquerade as cut geometry.

Classic POLYLINE mesh, polyface, and 3D flags are rejected as non-2D cut geometry. Supported planar geometry with a negative-Z extrusion is normalized consistently; tilted planes are rejected rather than projected silently.

Known `$INSUNITS` scales are normalized to millimetres at the DXF-to-UPID boundary because the default post declares `G21`. Original units and the applied scale remain in source metadata. Unitless/unknown drawings retain their numeric coordinates but receive an explicit assumed-millimetres diagnostic. Layer filtering is exposed as a tested path-planning API so callers can opt into cut-layer selection without fake UI controls.

### 3. Geometry sanitization, indexed clustering, and topology diagnostics

A sanitization stage runs before endpoint clustering. It rejects non-finite and invalid segments, detects exact/reversed duplicates, and keeps only one executable representative while emitting an error diagnostic that references all affected sources. This prevents double cutting even before export gating.

Endpoint grouping uses a spatial hash keyed by the active epsilon/tolerance instead of comparing every endpoint to every other endpoint. A candidate joins an exact group only when the resulting group diameter remains within `coincidenceEpsilon`; the stored method therefore matches the stated guarantee. Near-snap matching remains conservative and reciprocal, but candidate lookup is limited to neighbouring grid cells.

Topology analysis detects branch nodes, duplicate/overlapping geometry, and self-intersections with a bounds index before exact geometry checks. Diagnostics that mean the operation cannot be followed unambiguously use severity `error`. Valid open centreline chains retain the existing `open-chain` warning and remain exportable.

### 4. Structural UPID validation and fail-closed posting

A pure validator checks the persisted UPID graph before posting:

- schema and project identity;
- finite points, radii, lengths, bounds, and metrics;
- unique IDs and valid references across segments, clusters, chains, contours, path elements, and operations;
- operation continuity and closed-loop closure;
- agreement between segment refs, operation endpoints, and referenced contours;
- blocking topology diagnostics such as branches, duplicates, invalid geometry, and self-intersections.

Validation returns a report rather than mutating the document. Project loading rejects structurally corrupt UPID state. Export composition carries readiness and blocking diagnostics to the preview. A blocked preview can still explain and select affected geometry, but its Download action is disabled and no executable body is produced.

The post never inserts `G0` to hide a discontinuity inside one operation. A within-tolerance repaired join remains an explicit cut bridge with a diagnostic. A larger gap returns an error and blocks the body.

Open centreline paths are allowed. Multi-operation output remains header/body/footer G-code as required by V1; machine-specific thread, cut, stop, and rethread lifecycle commands are not invented. Their absence remains visible as operation boundaries in the structured post result and belongs with the upcoming machine/compensation design.

### 5. Machine-controlled coordinate precision

`OutputFormat` gains a normalized coordinate precision setting with a conservative supported range. Existing projects without the field normalize to the current three decimal places, preserving compatibility. The setting is editable with the other machine output settings and is passed to the UPID post. Formatting rejects non-finite values and normalizes negative zero.

### 6. Historical UI, storage, and harness fixes

- Copy remains a browser/editor command. Measurement points receive a dedicated non-conflicting clear shortcut and button behaviour.
- Construction previews resolve their owning operation from the magnetized result; a visible preview can always be committed.
- Remembered-directory storage reads are inside the recoverable boundary so browser-cache startup remains available.
- Settings drafts key off persisted setting values, not manifest timestamps.
- Playwright uses a task-owned port and never reuses an unrelated server.
- Contour Workbook rows restore hover/focus cross-highlighting, independent segment disclosure, endpoint reveal, and accessible help while retaining the compact layout.

## Data Flow

```text
DXF text
  -> strict pairs + entity parsing
  -> BLOCK/INSERT expansion + adaptive approximations
  -> unit normalization and optional layer filter
  -> segment sanitization
  -> indexed endpoint clusters
  -> chains + contour/topology analysis
  -> operation plan + path elements
  -> persisted UPID
  -> structural/export validation
  -> precision-aware post
  -> header/body/footer composition
```

External G-code follows a separate source-preserving path:

```text
program text
  -> shared comment/word lexer
  -> modal motion interpreter
  -> preview geometry + structure/metrics
```

## Error Handling

- Parse failures are attached to source entities/lines where possible.
- Approximation is never labelled exact.
- Recoverable warnings remain visible and do not silently alter source identity.
- Ambiguous or unsafe topology is an error and prevents executable-body generation.
- Corrupt persisted UPID throws a descriptive load error before editor state is created.
- No formatter may emit `NaN`, `Infinity`, or `-Infinity`.

## Testing and Acceptance

Each reproduced defect receives a failing regression test before its implementation. Acceptance requires:

- focused parser, DXF, path-intel, UPID, storage/settings, editor, and configuration tests pass;
- the bundled `z18f25.dxf` still produces one clean closed contour with no topology errors;
- BLOCK base-point and nested BLOCK SPLINE fixtures transform correctly with retained provenance;
- malformed numeric fixtures never produce a non-finite entity or G-code word;
- branched and duplicated fixtures produce no downloadable executable body;
- a valid open G40 centreline fixture remains postable;
- a 4,000-segment clustering benchmark no longer exhibits quadratic growth and completes within a stable test budget;
- configurable precision changes coordinates without changing operation geometry;
- Contour Workbook selection/hover/disclosure tests pass;
- the full Vitest suite, production build, and Playwright suite run against this app on the owned port.

## Migration and Compatibility

UPID schema version remains 1; the validator accepts documents created before this change when their graph is structurally sound. Missing output precision normalizes to three decimal places. New source metadata fields are additive. Existing browser-cache and folder workbenches continue to load through the normal profile normalization path.

The changes intentionally preserve header/body/footer composition and do not add feed generation or automatic kerf offsets.
