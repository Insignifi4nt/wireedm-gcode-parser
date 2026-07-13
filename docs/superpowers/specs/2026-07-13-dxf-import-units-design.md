# DXF Import Unit Confirmation Design

Date: 2026-07-13

## Goal

Prevent unitless or incorrectly declared DXF files from silently becoming incorrectly sized UPID geometry. DXF selection should open a compact confirmation step that shows the chosen source unit, resulting millimetre dimensions, and selected machine profile before the project is persisted.

This is a separate delivery from controller compensation so it cannot delay the first compensation-ready gear output.

## Product Decisions

- UPID geometry remains canonically stored in millimetres.
- A recognized DXF `$INSUNITS` value is the primary source-unit choice and is visibly labelled “Declared by DXF.”
- Missing, unitless, malformed, or unknown `$INSUNITS` requires explicit user confirmation before import.
- The selected machine profile may suggest a preferred DXF import unit, but it never silently determines the file’s units.
- Machine output units and DXF source units are separate concepts. G20/G21 must not be used to infer the CAD file’s units.
- The confirmation step always shows the resulting part bounds in millimetres and whether they fit the selected machine work area.
- Geometry is normalized exactly once from the raw DXF. An already-normalized UPID is never multiplied in place to reinterpret units.
- Original DXF unit metadata and the applied user decision are both persisted for provenance.
- Reinterpreting an existing project requires rebuilding from its persisted raw DXF.

## Scope Decomposition

This design uses the machine-profile selector created by the machine-library work but owns only source-unit confirmation and exactly-once geometry normalization. Machine compensation, controller dialects, and G41/G42 are out of scope.

## Import Flow

The current one-call import is split into read-only preparation and mutating commit stages.

```text
select DXF file
  -> read text
  -> parse entities, drawing metadata, and $INSUNITS
  -> build unit candidates
  -> calculate candidate millimetre bounds and machine fit
  -> show Import Confirmation
  -> user selects machine and confirms source unit
  -> normalize original parsed geometry exactly once
  -> build UPID
  -> persist raw DXF + project snapshot + manifest entry
  -> open editor
```

Cancelling the confirmation performs no storage writes and creates no project or manifest entry.

## Unit Resolution

### Candidate priority

1. Recognized `$INSUNITS`, labelled “Declared by DXF.”
2. Selected machine profile’s optional `preferredDxfImportUnit`, labelled “Machine suggestion.”
3. Millimetres as a visible unconfirmed fallback.

The dialog still permits a user override when the DXF declares units. Overriding declared units produces a persisted warning and requires explicit confirmation.

Initial supported choices are millimetres and inches because they cover the active workflow and have exact scales. Additional recognized DXF units may be displayed and accepted when the parser already provides a finite positive scale. Arbitrary custom scale entry is outside the first delivery.

### Persisted provenance

Raw `$INSUNITS` remains unchanged in `source.units`. A distinct applied record captures the actual import decision:

```ts
interface AppliedDxfUnits {
  label: string;
  scaleToMillimeters: number;
  basis: 'dxf-declared' | 'user-confirmed' | 'legacy-assumed';
  confirmed: boolean;
  confirmedAt?: string;
  suggestion?: {
    kind: 'machine-profile';
    profileId: string;
  };
}
```

`source.coordinateScaleToMillimeters` equals `source.appliedUnits.scaleToMillimeters`. Validation rejects disagreement. `source.units` continues to describe the raw file even when the user overrides it.

## Machine Selection

- The import confirmation includes the workbench machine-profile library.
- The active profile is preselected as the default for new work.
- Choosing a different profile for one import does not silently change the workbench default.
- The selected normalized profile is copied into `project.machine`.
- Part bounds and machine-fit warnings update immediately when either source units or machine selection changes.
- A machine profile may store `preferredDxfImportUnit: 'millimeters' | 'inches' | null`. This is a suggestion only and is distinct from post output units.

## UI

The compact import confirmation shows:

- file name;
- supported-entity and warning counts;
- DXF Units selector;
- source badge: Declared by DXF, Machine suggestion, Not declared, or User override;
- resulting width, height, and bounds in millimetres;
- Machine Profile selector;
- work-area fit status;
- Import & Open and Cancel actions.

The editor and export trace retain a small read-only unit summary showing raw declaration, applied unit, scale, and decision basis.

Changing units after import is not an ordinary transform. A separate “Re-import with Different Units” action:

- reads the persisted raw DXF;
- warns that geometry-derived edits and lead decisions will be rebuilt;
- produces a new normalized path document after confirmation;
- blocks if the raw DXF is unavailable.

Confirming millimetres on a legacy assumed-millimetre project is metadata-only and preserves edits because the numeric scale remains 1.

## Output-Unit Safety

The current post emits internal millimetre coordinates unchanged. Therefore:

- G21 is compatible with the current post;
- G20 in a UPID machine template is a blocking error until inch coordinate conversion is implemented;
- the machine’s preferred DXF import unit does not alter post units;
- no profile or header may cause a second scale application.

## Error Handling

- Files with no supported geometry fail during preparation before the dialog is shown.
- Non-finite source or scaled geometry rejects the affected import.
- Missing/unknown units cannot commit without explicit confirmation.
- A user override of declared units persists a warning in UPID and export trace.
- Invalid or deleted machine-profile IDs fail clearly instead of falling back silently.
- Storage writes occur only after a valid preparation and confirmed selection.
- If a commit write fails, existing workbench recovery behavior applies and no successful import is reported.
- Reinterpretation never rescales normalized UPID fields in place.

## Migration and Compatibility

- New `appliedUnits` metadata is additive.
- Existing documents with recognized units and a matching scale synthesize `dxf-declared` semantics when read.
- Existing unitless documents with scale 1 synthesize `legacy-assumed`, unconfirmed semantics and keep their current geometry.
- Loading legacy projects never triggers automatic rescaling or a blocking modal.
- A later save may persist synthesized metadata.
- The raw imported DXF remains the authoritative source for any nontrivial reinterpretation.

## Testing and Acceptance

Implementation is test-driven. Acceptance requires:

- recognized `$INSUNITS` preselection and exact once-only scaling;
- missing, code-zero, malformed, and unknown units require confirmation;
- millimetre and inch choices show correct millimetre bounds;
- declared-unit override persists raw and applied provenance plus a warning;
- selected machine snapshot is persisted without changing the global default;
- candidate unit or machine changes recompute fit display;
- Cancel performs no writes;
- successful confirmation persists raw DXF, UPID, project, and manifest once;
- validator rejects applied-scale disagreement and non-finite values;
- legacy assumed-millimetre projects load without geometry changes;
- changing a legacy scale rebuilds from raw DXF and blocks when raw is missing;
- G20 conflicts block UPID output while G21 remains supported;
- full Vitest suite, production build, and relevant DXF-import Playwright flow pass.

## Delivery Boundary

This workflow is implemented as its own commit after the first compensation-ready milestone. It may reuse the machine-profile selector but must not alter compensation semantics or delay G41/G42 delivery.
