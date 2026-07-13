# Controller Compensation and Machine Profiles Design

Date: 2026-07-13

## Goal

Add dimensionally correct controller-side wire compensation to UPID output while turning the existing single-profile settings form into a reusable machine-profile library. Closed DXF contours should use compensation by default when the selected profile supports it, but every decision must remain reviewable and unsafe or unresolved output must fail closed.

The first target is a Charmilles Robofil 100 using an editable “Charmilles Robofil Classic” preset with offset-table selection `D0`. The design must remain controller-neutral so later Charmilles, Fanuc, Mitsubishi, and custom posts do not require changing UPID geometry semantics.

## Product Decisions

- Programmed DXF coordinates describe the desired finished contour, not the wire-centre path, whenever controller compensation is enabled.
- New DXF projects record a reviewable geometry basis: `finished-contour` or `wire-centre`. Compensation requires `finished-contour`; existing legacy projects synthesize `wire-centre` and remain G40.
- Compensation is enabled by default for new projects created with a compensation-capable, verified machine profile.
- Existing projects and legacy generic profiles remain G40 centreline jobs until a compensation-capable profile is explicitly selected and reviewed.
- UPID stores machining intent, never a literal G41 or G42. The post derives G41/G42 from kept-material intent and the final executable winding.
- Confident `exterior` and `island` contours suggest `keep-inside`; confident `hole` contours suggest `keep-outside`.
- `ambiguous`, degenerate, intersecting, or open geometry never receives automatic closed-contour compensation.
- Every operation can be overridden to `keep-inside`, `keep-outside`, or `centerline`.
- D selects a controller offset-table entry only. The app does not write the wire radius, spark gap, or offset-table value into the controller.
- The Robofil preset initially selects `D0`. Its index and formatting remain editable.
- Machine profiles live in a reusable workbench library. A normalized snapshot is copied into each project so later library edits cannot silently change an existing job.
- Machine profiles can be serialized as portable versioned JSON documents. Folder-backed workbenches remain directly editable through `workbench.json`; exported artifacts may also be kept under `machines/` and imported deliberately.
- Users can create a valid blank profile, then configure or import controller details. Blank profiles are unverified and G40-only until compensation support is configured.
- The first compensation milestone does not invent threading, wire-cutting, erosion-power, flushing, stop, or rethread commands. Those require a separate controller lifecycle design.

## Safety Invariants

1. G41/G42 is computed from the final `PathOperation.segmentRefs`, not `PathOperation.direction` or persisted contour-orientation metadata.
2. Reversing a compensated path flips G41/G42 while preserving the same kept-material region.
3. Rotating the start point without reversing traversal does not change the compensation side.
4. G40 is active before every rapid and between operations.
5. Controller compensation cannot be combined with already-offset geometry.
6. Compensation cannot activate directly on an unvalidated sharp corner or cancel without a validated transition.
7. A compensated operation cannot post without a resolved machining intent, executable winding, D-table selection, supported transition strategy, and verified controller policy.
8. Free-form header or footer compensation commands cannot compete with operation-level compensation.
9. Profile changes that affect controller syntax or compensation lifecycle invalidate the profile’s verification acknowledgement.
10. No output is described as machine-ready merely because its geometry post succeeds; controller setup and offset-table values remain operator responsibilities.
11. Automatic transitions require a finite positive conservative maximum offset for collision-envelope validation. A D index without a known validation envelope is insufficient.

## Compensation Semantics

### Operation intent

Closed operations gain semantic intent independent from contour classification:

```ts
type ClosedContourCompensationIntent =
  | { mode: 'controller'; keptMaterial: 'inside' | 'outside'; source: 'automatic' | 'manual' }
  | { mode: 'centerline'; source: 'manual' | 'legacy' };
```

Classification supplies an automatic suggestion, not an immutable truth:

| Contour classification | Suggested intent |
| --- | --- |
| `exterior` | keep inside |
| `island` | keep inside |
| `hole` | keep outside |
| `ambiguous` | unresolved; review required |
| `open-chain` | centreline unless a future open-path left/right design is added |

The operation persists whether the result was automatic or manual. A manual contour-role change refreshes an automatic suggestion but never overwrites a manual compensation decision.

The document also stores `geometryBasis: 'finished-contour' | 'wire-centre'`. New DXF projects created with a compensation-capable profile default visibly to `finished-contour`; the user can review or change it. Legacy documents synthesize `wire-centre`. Controller compensation is blocked unless the basis is `finished-contour`, because an already offset or wire-centre DXF cannot be detected reliably from geometry alone.

An automatically eligible contour is closed, classified as `exterior`, `hole`, or `island`, nondegenerate under exact signed-area analysis, and free of blocking topology diagnostics. Numeric confidence alone does not enable compensation.

### Post-time resolution

The post computes signed area from the final oriented segment refs using exact line/arc/circle area logic. Positive area is CCW and negative area is CW.

| Kept material | Traversal | Wire side | Output |
| --- | --- | --- | --- |
| inside | CCW | right | G42 |
| inside | CW | left | G41 |
| outside | CCW | left | G41 |
| outside | CW | right | G42 |

The resolver is a pure domain function. It returns a typed result containing actual winding, kept-material side, wire side, resolved code, and any blocking reason. It does not emit text or inspect UI state.

## Machine-Profile Library

### Library and project ownership

- `WorkbenchManifest.machineProfiles` remains the canonical reusable profile library.
- Folder-backed users may deliberately edit that array in `workbench.json`; changes are normalized on the next connection.
- Portable files under `machines/` are explicit import/export artifacts, not live bindings whose edits could silently change active output.
- `activeMachineProfileId` is the default for new work, not a live binding for existing projects.
- Settings expose select, create blank, duplicate, rename, edit, set-default, delete, import, and export operations.
- Profile IDs are stable and unique. The last profile cannot be deleted. Deleting the active profile selects a deterministic fallback.
- DXF import explicitly selects a library profile, initially the active default.
- `WorkbenchProject.machine` remains a full normalized snapshot, including profile ID and controller policy.
- A later “Change Project Machine” action replaces the snapshot only after confirmation and recomputes fit and export readiness.

### Portable profile files

Each profile can be serialized as one file named `<safe-id>.wireedm-machine.json`:

```ts
interface PortableMachineProfileDocument {
  format: 'wire-edm-machine-profile';
  schemaVersion: 1;
  exportedAt: string;
  profile: MachineProfile;
}
```

The portable file is deliberately separate from the manifest. Saving or importing a profile updates the canonical manifest library. Export downloads or writes the portable document without creating a live link. Existing open projects remain pinned to their stored snapshots.

Import validates the wrapper and normalized profile before writing. A new ID is added directly. An identical existing ID selects the existing profile. A conflicting existing ID is imported as a copy with a newly generated stable ID; it never silently overwrites another machine. Imported profiles reset controller verification to `unverified` because verification is a local safety acknowledgement. Export produces the same portable document and never includes project geometry or offset-table values.

`createBlankMachineProfile()` returns a complete safe record named “Untitled Wire EDM” with custom/template-managed controller policy, millimetre output, unset work area, compensation unsupported, empty editable header/footer templates, and unverified status. It is editable immediately but cannot generate G41/G42 until configured.

### Structured configuration

The profile expands beyond free-form header/footer text:

```ts
interface MachineProfile {
  id: string;
  name: string;
  controller: {
    family: 'generic-iso' | 'charmilles-robofil-classic' | 'custom';
    verification: {
      status: 'unverified' | 'user-verified';
      verifiedAt?: string;
      verifiedFingerprint?: string;
    };
    blockFormatting: 'spaced' | 'compact';
    coordinateSystem: 'template-managed' | 'work-offset' | 'wire-position-g92';
    programEnd: 'M02' | 'M30' | 'template-managed';
  };
  compensation: {
    supported: boolean;
    enabledByDefault: boolean;
    offsetSelection: {
      address: 'D';
      index: number;
    };
    activation: 'linear-lead' | 'charmilles-g38';
    cancellation: 'linear-lead-out' | 'charmilles-g39';
    validationLeadLengthMm: number;
    expectedMaximumOffsetMm: number | null;
  };
  templates: GCodeTemplateSet;
  output: OutputFormat;
  workArea: MachineWorkArea;
  notes: string;
}
```

Exact field decomposition may be split into focused types, but these concepts and ownership rules are required. `validationLeadLengthMm` and `expectedMaximumOffsetMm` validate geometry only; they are never emitted as D values.

For automatic explicit leads, `expectedMaximumOffsetMm` is required and positive. `null` is allowed only for centreline output or a controller-native strategy whose physical transition remains blocked pending controller verification.

The initial output-unit contract remains millimetres. Supporting G20 requires coordinate conversion in the post and is outside this specification.

### Robofil preset

The built-in preset is named “Charmilles Robofil Classic,” not “Robofil 100 verified.” It provides:

- compensation supported and enabled by default after verification;
- offset-table selection `D0`;
- editable compact or spaced blocks;
- both explicit-linear and optional G38/G39 strategies;
- no hardcoded G54 assumption;
- editable M02/M30 and coordinate-system policy;
- an unverified initial status.

The local editable Robofil profile may begin with conservative validation-only defaults such as a 2 mm lead and 0.5 mm maximum offset envelope. These values remain user-editable and are never written into D0.

Available Charmilles documentation supports G40/G41/G42, D-table selection, G92 part coordinates, and M02/M30 on related Robofil controls. Older Robofil training material also documents G38/G39. Because no exact Robofil 100 programming manual or proven machine program has been supplied, the preset must not claim exact-controller verification. A graphics/dry-run check followed by explicit user acknowledgement changes the profile to user-verified. Editing dialect, coordinate system, program-end code, D selection, activation, cancellation, or block formatting resets that acknowledgement.

## Transition Geometry

### Explicit linear strategy

The default controller-neutral lifecycle is:

```gcode
G40
G0 X... Y...
G41 D0 G1 X... Y...
... contour ...
G40 G1 X... Y...
```

G42 replaces G41 when resolved by the compensation table.

For an automatically chosen start, the lead generator evaluates contour segment endpoints and exact tangents. A candidate linear lead-in approaches the contour start along its tangent; a lead-out continues along the closing tangent. The compensated wire remains on the resolved scrap side. The generator checks:

- finite, nonzero geometry;
- configured minimum lead length;
- expected maximum offset when configured;
- intersections with the operation and other contours;
- cancellation at a sharp corner;
- operation and machine work-area bounds;
- coordinate-precision representability.

If the operation has a manual start, the generator does not silently move it. An unsafe manual start produces a blocking diagnostic and offers manual lead placement. If the start is automatic, the generator may choose another safe contour endpoint and records that choice in the export trace.

The existing circle-centre radial lead-in is centreline-only. It meets the circle at a sharp tangent discontinuity and therefore blocks controller-compensated posting until replaced by safe transition geometry.

### Charmilles native-transition strategy

Profiles may instead emit structured controller transitions:

```gcode
G40
G0 X... Y...
G38 G41 D0
... contour ...
G39 G40
```

The exact block layout is produced by the selected dialect and formatting policy. Native transitions are represented explicitly in the posted block model and preview; they are not disguised as zero-length moves. When the actual D-table value is unknown, the preview labels the physical transition envelope as estimated. The strategy remains blocked until the machine profile is user-verified.

Native G38/G39 output is not part of the first physical milestone. Adjacent-controller documentation is insufficient to enable it for the Robofil 100; the initial compensated post implements explicit linear transitions and keeps native transitions blocked until exact-controller evidence or graphics verification is recorded.

## Structured Post

The current posted-move model only represents G0–G3 motion. Compensation adds a posted-block union with stable operation and source tracing:

- setup/rapid;
- compensation activation;
- lead-in;
- contour move;
- lead-out;
- compensation cancellation;
- operation boundary.

Each block records its generated text, modal effect, operation ID, optional segment ID, start/end points when applicable, and reason. Existing move metrics are derived from motion blocks; modal blocks do not pretend to be moves.

For each operation the post:

1. validates the machine snapshot and header/footer modal state;
2. requires a finished-contour geometry basis for controller compensation;
3. ensures G40 before any rapid;
4. resolves automatic/manual compensation intent;
5. computes actual winding from final refs;
6. resolves G41/G42 and D selection;
7. validates or generates transitions and their physical offset envelope;
8. emits the operation through the selected dialect;
9. confirms compensation cancellation before the next operation;
10. records traceable blocks and diagnostics for the export preview.

Centreline operations retain the existing G40 path. A mixed document may contain centreline and compensated operations as long as each boundary returns to G40.

## Header and Footer Policy

Free-form templates remain supported for setup commands and user comments, but the export validator interprets their modal words.

- G41 or G42 in a header/footer is a blocking conflict for a UPID operation-level post.
- A header may contain G40; duplicate cancellation is harmless but normalized preview should make it visible.
- G20 is blocked while the post emits millimetre coordinates; G21 is accepted.
- Controller-sensitive coordinate-system and end-code choices are compared with the structured profile and produce a blocking conflict when contradictory.
- External imported G-code keeps its existing source-preserving pipeline and is not rewritten by these rules.

## UI and Review

### Settings

The Machine & Output panel gains:

- profile selector;
- New Blank, Duplicate, Delete, Set Default, Import, and Export actions;
- controller family and verification status;
- coordinate-system and program-end policy;
- compensation support/default toggle;
- D-table index;
- activation/cancellation strategy;
- validation lead length and optional expected maximum offset;
- block formatting;
- existing header/footer, precision, extension, line ending, and work area.

Advanced custom-template controls remain an escape hatch, not the primary path. Invalid combinations show inline errors and cannot be saved as verified.

### Import and project editor

DXF import selects a machine profile and snapshots it into the project. The operation inspector shows compensation intent and whether it is automatic or manual. Confident contours are automatically initialized; uncertain contours receive a visible review state.

The user can choose keep inside, keep outside, or centreline for the selected closed operation. Reversal updates the displayed actual winding and resolved G code immediately without changing kept-material intent.

### Export preview

Each operation row displays:

- contour role and confidence;
- actual CW/CCW traversal;
- kept-material intent and decision source;
- resolved wire side and G41/G42;
- D-table selection;
- activation/cancellation strategy;
- lead geometry or native-transition estimate;
- profile verification status;
- blocking diagnostics.

Download remains disabled when any compensated operation is unresolved or unsafe.

## Error Handling

- Invalid profile fields are rejected during normalization and settings save.
- Legacy profiles normalize to compensation unsupported, G40 centreline output.
- Missing compensation fields never default a legacy project into G41/G42.
- Open, ambiguous, degenerate, self-intersecting, or non-finite paths cannot receive automatic closed-contour compensation.
- Stale persisted contour orientation is ignored during compensation resolution.
- Missing D selection, invalid D index, unverified native transition, conflicting header/footer modal state, unsafe lead geometry, or compensation active before rapid blocks export.
- Missing finished-contour basis or missing automatic-lead offset envelope blocks controller compensation.
- A failed post returns structured diagnostics and no executable body.

## Migration and Compatibility

- UPID schema version remains 1 if additive optional fields remain sufficient; otherwise a deliberate version migration is required rather than accepting partially interpreted records.
- Legacy operations without compensation intent behave as G40 centreline operations until initialized by a compensation-capable project workflow.
- Legacy documents synthesize `geometryBasis: 'wire-centre'`; they never acquire automatic G41/G42 merely by loading under a newer app version.
- Legacy machine profiles normalize with `compensation.supported: false` and preserve their existing text and output choices.
- Existing project snapshots remain unchanged when their library profile is edited.
- The workbench’s top-level output/template mirrors remain compatibility data until a separate manifest migration makes the profile library the sole persisted representation.
- External G-code import/edit remains source-preserving and does not gain automatic compensation.

## Testing and Acceptance

Implementation is test-driven. Acceptance requires:

- exhaustive pure resolver tests for the four kept-material/winding mappings;
- reversal flips G41/G42 and preserves kept material;
- start rotation preserves G41/G42;
- exact line, arc, circle, mixed-segment, and rejected-degenerate winding coverage;
- automatic classification suggestions and manual override persistence;
- profile create/duplicate/select/delete/default operations and legacy normalization;
- portable profile serialization, manual manifest-edit reload, import collision handling, export, and malformed-file failures;
- a blank profile remains valid, editable, unverified, and G40-only;
- project snapshots remain stable after library edits;
- verification resets after every controller-sensitive edit;
- explicit-linear golden post tests using D0, plus tests that keep unverified Charmilles-native G38/G39 output blocked until a later verified dialect milestone;
- G40 before every rapid and after every compensated operation;
- safe tangent lead generation plus intersection, sharp-corner, bounds, and precision failures;
- header/footer G41/G42 and G20 conflicts block output;
- reversed gear output changes compensation side while retaining the same kept-inside intent;
- finished-contour basis enables compensation while legacy/wire-centre basis remains G40;
- automatic leads reject a missing or non-positive maximum offset envelope;
- editor controls, preview trace, persistence, and download gating tests;
- full Vitest suite, production build, and relevant Playwright flows pass.

Before first physical use on the Robofil 100, the generated program must pass the controller’s graphics/verification mode with the intended D0 table value confirmed by the operator.

## Research References

- [Charmilles Robofil programming manual for CT-Millennium controls](https://www.scribd.com/document/459168666/FIX40-cc-SL-program-vH-en-pdf): G40/G41/G42, D-table selection, G92 part coordinates, M02/M30 examples, and compensated linear transitions.
- [Classic Robofil 290 training material](https://es.scribd.com/document/657758974/manual-charmilles-robofil-290): legacy G38/G39 transition descriptions and `G41Dd`/`G42Dd` syntax. This is adjacent controller evidence, not proof of Robofil 100 behavior.

## Delivery Boundaries

Implementation uses separate, reviewable commits:

1. Machine-profile library domain and Robofil preset.
   This includes portable files, blank-profile creation, import/export, and the selected Windows workbench profile.
2. Compensation intent, suggestions, resolver, persistence, and validation.
3. Structured compensated post, explicit-linear safe transitions, review UI, and Robofil output. This is the first compensation-ready milestone.
4. Native G38/G39, additional controller presets, and lead optimization only after the first milestone is verified.

The DXF unit-confirmation workflow is specified and delivered separately so it cannot delay the compensation-ready milestone.
