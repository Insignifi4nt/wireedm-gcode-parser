# Machining Transition Ownership Design

Status: implemented on `fix/machining-transition-ownership`.

## Goal

Make program origin, contour traversal, cutting transitions, and between-operation
positioning distinct concepts in the model and editor. Each control must say what it
changes, expose its prerequisites, and avoid mutating a different concept indirectly.

## Rejected Approaches

### Copy-only repair

Keep the existing panels and add warnings when the initial wire is missing. This would
explain one silent failure while preserving misleading rapid fields and duplicated
lead state.

### One combined machining wizard

Put G92, contour start, entry, exit, rapid positioning, and threading in one ordered
wizard. This would show sequence well, but it would make independent per-operation
edits cumbersome and conflict with the dockable workbench.

### Ownership cleanup

Use focused panels backed by one authoritative value for each concept. Derive route
segments instead of editing them as independent geometry. This is the selected
approach.

## Canonical Motion Model

The executable sequence is:

1. Resolve the project-level initial wire position and emit `G92` once.
2. For the first operation, begin at that resolved position. For every later
   operation, begin at the previous operation's resolved exit.
3. Perform the configured between-operation separation/rethread lifecycle.
4. Rapid to the selected operation's entry source. With reviewed no-entry intent,
   rapid directly to its contour start.
5. Activate compensation as authorized by the post.
6. Cut the entry from its source to the contour start when an entry exists.
7. Cut the contour from its independently selected start, in its selected direction.
8. Cut the exit from the contour end to its configured exit target when an exit
   exists.
9. Use that resolved exit as the source for the next derived rapid.

The first operation differs only in where step 2 begins. G92 is not a per-contour
start and does not supply a hidden start-point inference source for later operations.

## Single Ownership

### Program Start / G92

`setup.initialWirePosition` is the only program-start coordinate. It is project-level,
reviewed, and used once. The panel explains that it declares the wire's current
part-relative coordinate; it does not move geometry, choose a contour start, or create
a lead.

Profiles requiring wire-position G92 block export until this point is reviewed. A
blocked diagnostic links or steers directly to Program Start / G92.

### Contour Start

Every operation always has a valid planned start derived from its ordered geometry.
An explicit manual start is optional unless a separate geometry or controller
validation says otherwise. Opening the panel must therefore show the current start
and remain clean; it must not claim that the user is already picking or that an
explicit override is required.

The user deliberately starts `Change contour start`, then chooses:

- existing endpoint;
- nearest point to the cursor;
- midpoint of the hovered segment;
- perpendicular foot from the applicable approach source onto the hovered segment.

Every mode previews the approach-source-to-candidate line while hovering. Midpoint and
perpendicular first lock to the hovered segment; perpendicular then computes the true
foot from the initial wire position for the first operation or the preceding resolved
exit for later operations. Cursor-nearest remains a separate pointer projection.
Merely changing the inference selector is transient UI state and must not dirty the
document workflow.

Applying a start updates only the selected operation's traversal start and any
transition endpoints that are explicitly anchored to that start.

### Cut Entry / Exit

Entry and exit are per-operation cut geometry:

- entry source to contour start;
- contour end to exit target;
- reviewed direct/no-entry and direct/no-exit intent.

The panel labels both endpoints and motion type. It may offer a normal/perpendicular
entry strategy from a chosen per-operation approach point, because that source is part
of the entry definition. It never uses project G92 as an implicit source.

The transition model is authoritative. Runtime code must not dual-write or fall back
between `operation.transitions.entry` and `operation.overrides.leadIn`. Existing data
is normalized at one load/import boundary if support is retained, after which saved
and edited documents contain only canonical transition state.

### Between Contours

Rapid positioning is derived, not authored as a free-standing route:

- source: initial wire for operation one, otherwise previous resolved exit;
- destination: next entry source, otherwise next contour start;
- motion: non-cut rapid;
- lifecycle: separation, positioning, and rethreading according to the selected
  transition and verified machine capability.

The existing editable `Planned rapid source` and `Planned rapid destination` fields
are removed. Their setters and handlers are removed because they currently mutate
legacy start fallbacks, previous contour starts, lead sources, or the selected contour
start depending on context.

The Between Contours panel presents a read-only route summary and owns project-default
plus per-transition rethreading choices. Operation one instead shows its initial
connection in Program Start / G92.

## Panel Structure and Steering

The Machining menu exposes:

1. Contour Setup
2. Contour Start
3. Cut Sequence
4. Program Start / G92
5. Entry / Exit
6. Between Contours
7. Machining Participation
8. Program Stops

Each mutating panel begins with a compact status card:

- what is currently configured;
- whether a decision is required or optional;
- what this panel changes;
- the next unresolved prerequisite, with a direct action that opens the owning panel.

Examples:

- Contour Start: `Current automatic start X… Y…. Changing it is optional.`
- Entry / Exit: `Entry ends at the contour start selected in Contour Start.`
- Program Start / G92: `Required for this machine profile before export.`
- Between Contours: `Derived rapid: previous exit → next entry source.`

Export diagnostics use the same ownership names and target the same panels. No hint
may say “pick” unless a canvas-pick mode is active.

## Data and API Changes

- Remove perpendicular-from-initial-wire from Contour Start state and APIs.
- Add preview metadata for nearest-line perpendicular guidance without persisting the
  pointer as a machining source.
- Remove editable planned-rapid APIs and UI handlers.
- Make `PathOperationTransitions` the canonical entry/exit representation.
- Remove runtime dual reads and writes of `overrides.leadIn`.
- Derive route summaries from initial wire, operation order, canonical entries, and
  canonical exits.
- Split Entry / Exit and Between Contours panel ownership without changing the
  controller-specific post sequence.

## Validation and Failure Behavior

- Missing reviewed G92 blocks only profiles that require it and points to Program
  Start / G92.
- Missing entry/exit review points to the selected operation in Entry / Exit.
- Invalid threading or separation points to the relevant transition in Between
  Contours.
- A contour start remains valid without a manual override.
- Disconnected entry/exit geometry fails closed and identifies both the transition
  endpoint and its expected contour anchor.
- Derived rapid routes cannot be edited directly and therefore cannot contradict
  their owning endpoints.

## Verification

Domain tests cover:

- first route begins at reviewed initial wire;
- later routes begin at previous resolved exits;
- destinations resolve to entry sources or contour starts;
- changing a contour start updates anchored entry/exit endpoints only;
- canonical transition persistence has no dual lead representation;
- direct/no-entry and direct/no-exit routes remain valid when the machine authorizes
  them.

Editor tests cover:

- Contour Start opens clean and describes automatic versus manual state accurately;
- endpoint, cursor-nearest, midpoint, and perpendicular previews and commits;
- every inference mode renders a clearly visible approach guide during hover;
- perpendicular selects the hovered side before constructing the approach-source foot;
- Entry / Exit edits only cut transitions;
- Between Contours route coordinates are read-only and threading remains editable;
- actionable diagnostics focus the owning panel.

Browser verification uses a multi-contour project to confirm:

- G92 appears once;
- every contour start is independently configurable;
- lead-in/out graphics are visibly cut motion;
- rapid graphics are visibly non-cut derived motion;
- later transitions use previous exit and next entry rather than initial G92;
- panel descriptions and active canvas hints match the current action.
