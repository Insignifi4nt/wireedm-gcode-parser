# Segment Geometry Presentation Design

## Problem

Expanded Geometry-tree segments currently use one generic presentation for every
shape: `From`, `To`, `Length`, a curve summary, and two verbose endpoint cards.
This duplicates coordinates and labels, and it misrepresents full circles as
having two distinct geometric endpoints plus a meaningful `360°` sweep.

The Inspector repeats the same problem in a denser form. Geometry, path
direction, source provenance, endpoints, angles, and tangents appear in one
undifferentiated definition list.

## Goals

- Give lines, arcs, and circles type-specific summaries and details.
- Keep the Geometry tree compact and consistent with the Program-tree density.
- Preserve endpoint selection, hover, diagnostics, and topology data.
- Represent a full circle as center/radius geometry with an operational cut
  start, without discarding its underlying closure sides.
- Keep exact and advanced geometry available without making it the default view.
- Drive the tree and Inspector from the same semantic presentation model.

## Non-goals

- Change path geometry, DXF parsing, topology inference, or machining behavior.
- Change coordinate precision or units.
- Redesign unrelated contour, lead-in, diagnostics, or measurement interfaces.

## Shared Presentation Model

Add a pure builder that consumes the oriented segment geometry, start/end
coordinates, length, and whether a circle has exceptional closure topology.
It returns:

- a type label;
- type-specific summary measurements;
- primary point rows;
- type-specific derived fields;
- advanced fields;
- the endpoint role attached to each selectable point.

The builder owns semantic labels and field selection. The Geometry tree and
Inspector own their respective layout and density.

## Type-specific Content

### Line

- Summary: `Length`.
- Primary points: `Start`, `End`.
- Derived geometry: `ΔX`, `ΔY`, `Heading`.
- Advanced: start/end tangents only when requested.

### Arc

- Summary: `Radius`, `Arc length`, and combined direction/sweep such as
  `CCW 90.000°`.
- Primary points: `Start`, `End`, `Center`.
- Advanced: start/end angles and tangents.

### Circle

- Summary: `Radius`, `Circumference`, and direction.
- Primary points: `Center`, `Cut start`.
- Do not show `From`, `To`, a duplicate end coordinate, or `Sweep 360°` in the
  normal presentation.
- `Cut start` selects the underlying start endpoint role.
- If start/end coordinates differ or either closure side carries diagnostics,
  expose both `Start side` and `End side` so exceptional topology is never
  hidden.
- Advanced: start angle and start tangent. Do not repeat equivalent closing
  angle/tangent values in the clean case.

## Geometry Tree

The collapsed row remains the segment-selection target and gains a concise,
type-specific summary:

- Line: kind plus length.
- Arc: kind, direction/sweep, radius, and arc length.
- Circle: kind, direction, radius, and circumference.

The expanded body contains only the complementary point and derived-geometry
rows. It must not repeat the collapsed-row summary. Selectable points use a
single compact coordinate row with one clear action. Center is informational.
Topology metadata and diagnostics appear only when non-clean or otherwise
actionable.

Existing data attributes may remain for compatibility, but visible duplicated
labels such as `Endpoint / Endpoint / START / Endpoint START / XY` are removed.

## Inspector

Replace the single long definition list with these groups:

1. `Geometry`: shared type-specific summary, primary points, and derived fields.
2. `Path`: forward/reversed orientation and segment sequence navigation.
3. `Source`: layer and DXF/edit provenance.
4. `Advanced geometry`: collapsed disclosure for angles and tangents.

The Inspector may repeat the selected segment identity because it is a separate
inspection surface, but it must not repeat the same fact within a section.

## Interaction and Accessibility

- Preserve segment and endpoint selection behavior.
- Preserve pointer, mouse, keyboard-focus hover projection.
- Preserve `aria-label`, `aria-describedby`, and selected-state semantics.
- For clean circles, selecting `Cut start` selects the raw start role.
- Center rows are not selectable because no current center-selection behavior
  exists.
- Diagnostic badges remain visible on the owning segment or point.

## Testing

- Unit-test the shared builder for line, arc, clean circle, and exceptional
  circle outputs.
- Integration-test the Geometry tree for compact type-specific rows and point
  counts/labels.
- Integration-test the Inspector group structure and the absence of circle
  endpoint/sweep duplication.
- Preserve existing endpoint interaction, reversal, topology, and exact-arc
  coverage.
- Run the focused test files, full suite, build, and browser interaction checks.

## Delivery Constraint

Create one final commit containing the complete implementation and verification
updates. Do not create incremental commits.
