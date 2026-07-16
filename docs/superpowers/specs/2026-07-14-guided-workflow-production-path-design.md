# Guided Workflow and Production Path Design

Date: 2026-07-14

## Goal

Turn the existing editor into a guided but non-rigid CAD/CAM workbench, then close the production gaps exposed by the Prisma evaluation: reviewed project-level initial wire position (`G92`), explicit per-operation entry and exit, and lossless partial-contour machining. Existing local-first storage, source geometry, compensation rules, controller verification, and fail-closed post behavior remain authoritative.

Machine-program-to-UPID conversion is outside this design and remains deferred.

## Product Decisions

- A central command registry is the source of command discovery and availability.
- Exactly one mutating tool session may own canvas input. Passive panels may stay open.
- Menus launch or focus tools; dock side is user layout, not workflow meaning.
- Tool sessions use explicit legal transitions and layered Back/Reset/Escape behavior.
- A completed workflow creates one labelled global document-history transaction.
- Layout persistence is independent from document history and active-tool state.
- Geometry placement, initial wire position, entry/exit, and machining participation are separate persisted concepts.
- New machining capabilities fail closed when state is stale, unresolved, unsupported by the selected post, or geometrically invalid.

## Command and Tool-Session Architecture

### Command registry

Every editor command is declared once with:

```ts
type EditorCommandScope =
  | 'workbench'
  | 'document'
  | 'operation'
  | 'contour'
  | 'segment'
  | 'point'
  | 'view'
  | 'machine'
  | 'export';

interface EditorCommandDefinition<Context, Session = never> {
  id: EditorCommandId;
  label: string;
  menuPath: readonly [string, ...string[]];
  scope: EditorCommandScope;
  toolWindowId?: EditorWorkspacePanelId;
  historyLabel?: string;
  evaluate(context: Context): EditorCommandAvailability;
  createSession?: (context: Context) => Session;
  execute?: (context: Context) => void;
}
```

Availability always contains either `enabled: true` or a concrete disabled reason. Menu items, tool controls, keyboard shortcuts, and contextual actions consume the same evaluation. Visibility is never used as a conflict test.

### Tool-session reducer

The editor owns `activeToolSession: EditorToolSession | null`. A session records command ID, target identity, current step, provisional inputs, preview state, and allowed transitions. Reducer events are `advance`, `back`, `reset`, `escape`, `apply`, and `cancel`.

- Escape removes the latest provisional input or returns to the preceding step when possible.
- Escape from the initial step cancels the session.
- Apply validates the complete draft and emits one typed commit request.
- The page applies that request through the existing path-document mutation/history boundary with the command's history label.
- Panel close does not implicitly commit or cancel a session; a close request while its session is active must use the same explicit cancellation path.

The first migrated sessions are Set Start, Measurement/Construction, Initial Wire Position, Entry/Exit, and Machining Participation. Existing commands migrate incrementally, but all newly changed mutating controls must use the registry/session boundary.

## Workflow Menus and Tool Windows

Top-level workflow menus are Project, Geometry, Machining, Construction, View, Machine, and Export. They organize commands rather than switching mandatory workspaces.

- Project: save and project metadata.
- Geometry: placement and transforms.
- Machining: operation semantics, cut sequence, initial wire position, entry/exit, and participation.
- Construction: measurement, perpendicular, and tangent construction.
- View: contour tree, statistics, diagnostics, cross-highlighting, and panel visibility.
- Machine: the project-pinned machine and machine-profile workflow.
- Export: readiness, preview, and download.

Cut Sequence is the only visible home for operation reordering. Header Undo/Redo is the single global history surface. Perpendicular and Tangent move to Construction. Cross-highlighting remains a passive view preference; magnetic/snap options belong to the active session that consumes them.

Every command and guided panel explains its target, prerequisites, effect, and next interaction. A menu command opens or focuses its tool in the remembered placement.

## Persistent Workspace Layout

Workspace layout is browser/workbench UI preference, not project machining data. A versioned record stores panel placement, dock order, floating rectangle, and dock width:

```ts
interface EditorWorkspaceLayoutV1 {
  schemaVersion: 1;
  placements: Partial<Record<EditorWorkspacePanelId, EditorPanelPlacement>>;
  dockOrders: Record<EditorDockSide, EditorWorkspacePanelId[]>;
  floatingGeometries: Partial<Record<EditorWorkspacePanelId, EditorFloatingPanelGeometry>>;
  dockWidths: Record<EditorDockSide, number>;
}
```

It is normalized against current panel IDs, viewport bounds, and minimum sizes. Invalid or obsolete entries are ignored. Writes are debounced to local storage under an application-versioned key. Active tool, selection, document history, and provisional state are never persisted in this record. Browser-cache and folder-backed workbenches use the same layout preference and neither requires directory permission.

## Initial Wire Position and G92

### Data model

The UPID project document gains optional setup state:

```ts
type InitialWirePosition =
  | {
      kind: 'geometry-linked';
      point: Point2;
      reference: { kind: 'circle-center'; segmentId: SegmentId };
      review: 'reviewed';
    }
  | {
      kind: 'manual';
      point: Point2;
      review: 'reviewed' | 'required';
      reviewReason?: 'geometry-transformed';
    };

interface PathProjectSetup {
  initialWirePosition?: InitialWirePosition;
}
```

Geometry-linked points are resolved from their semantic segment reference and follow transforms. Manual coordinates are exact part-relative coordinates; any later geometry transform marks them review-required. The setting is project intent, never a machine profile constant or a geometry transform.

### Workflow and readiness

The Initial Wire Position session offers eligible semantic points and exact X/Y entry. Its preview shows the declared point, the first operation entry, and the resulting first connection. Apply requires a finite point and an explicit review acknowledgement.

For profiles whose coordinate system is `wire-position-g92`, export readiness requires a reviewed, resolvable initial wire position. The structured post emits `G92` using that point and initializes modal position tracking from the same point. If the first entry equals the initial wire position within path tolerance, no contradictory zero-length rapid is emitted. If they differ, planning and post trace expose the connection from G92 to the first entry.

Legacy projects remain loadable. They do not silently acquire a reviewed setup; controller-specific export requiring G92 is blocked until the operator reviews it. Existing post-version safety rules remain unchanged apart from consuming reviewed setup data.

## Per-Operation Entry and Exit

### Model

The compact `leadIn` override is normalized into extensible transition intent:

```ts
type OperationEntry =
  | { strategy: 'none' }
  | { strategy: 'circle-center'; move: 'cut'; from: Point2; to: Point2; sourceSegmentId: SegmentId }
  | { strategy: 'manual-straight'; move: 'cut'; from: Point2; to: Point2; review: 'reviewed' | 'required' };

type OperationExit =
  | { strategy: 'none' }
  | { strategy: 'manual-straight'; move: 'cut'; from: Point2; to: Point2; review: 'reviewed' | 'required' };
```

Legacy circle-center and manual-point lead-ins normalize losslessly. Strategy labels always derive from actual strategy, fixing the Contour Tree's universal Pierce label. Unsupported normal, tangent, curved, overlap, return, and controller-specific strategies are extension points only; the UI does not claim them until geometry and controller evidence exists.

Entry/Exit is a selected-operation tool session. It supports canvas points and exact coordinates, previews cut versus non-cut motion, and commits entry plus exit atomically. Exterior manual entries require explicit operator review unless modeled stock can prove clearance. Transforms update geometry-linked points and mark uncertain free points for review.

The planner routes from the previous operation's configured exit (or operation end) to the next operation's configured entry (or start). Entry/exit contributes to metrics, bounds, trace, compensation-transition validation, and post diagnostics. Robofil v2 continues to use its verified `G39/G40` cancellation and may emit a geometric exit only when the modeled transition passes its existing policy checks.

## Partial-Contour Machining

### Participation overlay

Source segments remain unchanged. A separate participation model identifies active spans:

```ts
interface MachiningSpan {
  id: string;
  sourceSegmentId: SegmentId;
  range: { start: number; end: number };
  participation: 'active-cut' | 'inactive-reference';
}
```

`range` is normalized from 0 through 1 in source orientation. Whole-segment decisions use 0 and 1; sub-span choices split only the executable derived geometry, retaining source ID, parameter range, edit provenance, and stable span ID. Re-enabling a span is lossless because no source geometry is deleted.

Planning derives active operation chains from contiguous active spans. A closed source contour may therefore produce intentional open operations. These operations have stable IDs derived from contour plus span boundaries, explicit direction, start/end, order, entry/exit, and metrics. Intentional openness is recorded as machining intent and must not produce the `open-chain` source-topology warning.

Open active spans require explicit kept-side or centerline intent; inside/outside inference is not sufficient. The post emits only active-cut spans. Inactive geometry remains available for display, selection, fit/collision context, and provenance.

The participation session supports whole-segment selection first and two-point sub-span splitting as a later step of the same model. Canvas and Contour Tree show active cut, inactive reference, entries/exits, and rapid travel distinctly.

## Configurable Program Stops

Program stops are typed machining events, not editable raw G-code fragments. An operation may own zero or more enabled stop events:

```ts
type OperationProgramStopPlacement =
  | { kind: 'before-entry' }
  | { kind: 'before-operation-end'; remainingCutLengthMm: number }
  | { kind: 'after-contour' }
  | { kind: 'after-exit' };

interface OperationProgramStop {
  id: string;
  enabled: boolean;
  placement: OperationProgramStopPlacement;
  reason: 'operator-check' | 'part-retention' | 'manual';
  note?: string;
}
```

`before-operation-end` is the part-drop workflow: the planner locates a stable point at the requested remaining active-cut distance, splits the executable span at that point without changing source geometry, and inserts the stop before the final cut portion. This is distinct from `before-entry`, `after-contour`, and `after-exit`. A between-contours pause is represented by the preceding operation's `after-contour`/`after-exit` event or the next operation's `before-entry`, so its physical/modal location is unambiguous.

The UI calls this a configurable Program Stop and explains that enabling it emits an unconditional controller stop. `M0` and `M00` are normalized to canonical `M00` output; this feature does not emit `M01` optional-stop behavior. The event is visible in sequence, canvas/trace, exact-controller preview, metrics, persistence, and Undo/Redo.

Machine profiles gain an explicit program-stop policy containing support, canonical code, and allowed placements/modal states. Generic evidence establishes `M00` as a program interruption, and adjacent Robofil documentation identifies `M00` as an unconditional stop, but no Robofil placement is enabled merely from generic semantics. A stop with controller compensation active, including a distance-before-end stop, requires explicit authorization by the selected verified profile. Unsupported placement blocks export with a concrete diagnostic rather than silently moving or dropping the stop.

## Threading and Rethreading Transitions

Threading is explicit transition intent, not an incidental side effect of a generic stop. The project stores a default threading policy, and each transition into an operation may override it:

```ts
type ThreadingMode = 'continuous' | 'manual' | 'automatic';

type WireSeparationStrategy =
  | 'already-separated'
  | 'manual-before-positioning'
  | 'automatic-before-positioning';

interface OperationThreadingTransition {
  mode: ThreadingMode;
  wireSeparation: WireSeparationStrategy;
  source: 'project-default' | 'operation-override';
}
```

`continuous` is valid only when the post can prove that the wire may remain threaded across the transition. It must not be selected for separate closed contours merely to avoid a stop. `manual` means the operator completes threading and resumes with Cycle Start. `automatic` means the verified machine profile owns the exact cut, positioning, preparation, threading, and failure behavior.

The canonical manual transition into a later operation is:

```gcode
G39
G40
G0 X<next-entry-x> Y<next-entry-y>
M00
G41 D0 ; or G42 D0
G1 ...
```

The rapid destination is the next operation's configured entry/threading point, not the previous contour endpoint. Compensation is cancelled before rapid positioning and reactivated only after the operator resumes, immediately before the validated cut entry. The sequence and exact modal blocks remain post-specific; the model describes intent and required physical states.

When the operator must cut or break the wire before the positioning rapid, `manual-before-positioning` adds a separate pre-position operator stop after compensation cancellation. The resulting workflow is `cancel → M00 for wire separation → rapid to next entry → M00 for threading → activate compensation → cut`. This prevents the single post-position stop from falsely implying that intact wire can always be dragged between contours.

Automatic rethreading is profile-authorized capability. Adjacent Charmilles documentation describes machines and codes such as M50/M59/M60, but it also documents models without automatic threading hardware. Therefore the Robofil 100 profile remains manual-only until exact local-machine evidence verifies its commands, ordering, recovery behavior, and hardware. Unsupported automatic mode blocks export rather than falling back to manual or emitting adjacent-model codes.

Rethread stops are generated by the threading transition and displayed as `Manual rethread`, distinct from user-authored Program Stops. They participate in sequence preview, posted trace, diagnostics, persistence, and atomic history. Initial program threading remains part of Initial Wire Position setup and is reviewed separately from between-operation rethreading.

## Persistence, Migration, and History

- UPID schema version remains 1 while all additions are optional and strictly normalized.
- Project save/load and portable UPID paths preserve setup, transitions, participation, and review state.
- Legacy `leadIn` data migrates in memory and is preserved when saved through the new shape.
- Geometry transforms update semantic references and invalidate uncertain manual setup/transition points in the same atomic history transaction.
- One applied tool session equals one labelled Undo/Redo document transaction.
- Workspace layout never enters project history or portable files.

## Error Handling and Safety

- Non-finite setup, transition, or span coordinates are rejected.
- Stop distances must be finite, positive, and shorter than the active operation cut length; duplicate stops at one derived point are rejected.
- A transition with incompatible threading mode, separation strategy, entry accessibility, or machine capability blocks export.
- Missing segment references, invalid span ranges, overlapping contradictory spans, disconnected transition endpoints, stale review state, and unsupported controller transitions block export.
- The post never falls back to `G92 X0 Y0` for a profile requiring reviewed project G92.
- Planned and posted initial positions must match; mismatch is a blocking diagnostic.
- Intentional open machining bypasses only the source-open-topology diagnosis, not continuity, compensation, work-area, intersection, or post-policy validation.
- Import and picker flows expose pending, cancel, and error state so an intercepted chooser is not a silent action.
- Preview wheel/touch handling uses native non-passive listeners only where preventing default is necessary.

## Testing and Acceptance

Domain tests cover command availability and session transitions, layout normalization/persistence, G92 migration/readiness/post initialization, transform invalidation, transition migration/labels/routing, manual and automatic rethread lifecycle authorization, stable program-stop placement and profile authorization, span identity/splitting/re-enabling, intentional-open planning, compensation kept-side requirements, and fail-closed posting.

Component tests cover menu-to-tool focus, concrete disabled reasons, layered Escape, atomic history labels, remembered panel placement, Initial Wire Position review, Entry/Exit strategy labels, Cut Sequence ownership, participation editing, and visual state distinctions.

Acceptance uses a repository copy or temporary copy of the Prisma fixture; the external source and saved project are never mutated. The production result must include both holes and only the toothed top active span, show the reviewed initial wire coordinate explicitly in G92, omit a meaningless initial move when appropriate, emit no left, bottom, or right exterior cut moves, and support an explicitly configured and profile-authorized `M00` before the retained exterior span completes or at a selected operation boundary. Full Vitest, build, relevant Playwright, structured modal audit, and manual preview review are required before claiming production readiness.

## Delivery Slices

1. Command registry, explicit tool-session reducer, workflow menus, and persisted layout.
2. Initial Wire Position through project persistence, transforms, planning, UI, readiness, and post.
3. Entry/Exit model and workflow, including legacy migration and correct labels.
4. Manual/automatic threading policy and explicit between-operation rethread transitions.
5. Configurable operation-boundary and distance-before-completion program stops.
6. Participation overlay, intentional-open planning, kept-side intent, preview, and post.
7. Production-fixture-safe acceptance, passive listener cleanup, and Machine Program preview review without program-to-UPID conversion.
