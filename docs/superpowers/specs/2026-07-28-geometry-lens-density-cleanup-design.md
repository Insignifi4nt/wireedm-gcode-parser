# Geometry Lens Density Cleanup Design

Date: 2026-07-28

## Goal

Make the persistent Geometry lens as calm and legible as the Program lens while preserving contour selection, segment selection, canvas cross-highlighting, endpoint disclosure, nested-contour hierarchy, and diagnostics.

## Observed Problem

At the established 1280×720 workbench viewport, a single 72-segment contour fills the entire Geometry rail with boxed rows. The contour header repeats role, closure, length, and segment count, while the permanent toolbar and hover-assist checkbox consume space before the hierarchy starts. Each segment adds another bordered index box, coordinate summary, length, secondary arc metadata, and detail disclosure.

The Program lens is easier to scan because it uses flat indented tree rows, concise labels, disclosure on demand, and small status marks instead of nested cards.

## Selected Direction

Use the Program lens's visual grammar for Geometry:

- Render contours as flat tree rows with an ordinal, concise name/role, status mark, and disclosure chevron.
- Keep contour hierarchy expanded by default so nested contours remain discoverable.
- Add one compact `Cut path · N segments` child beneath each expanded contour.
- Keep each cut-path child collapsed by default.
- Automatically reveal the owning contour and cut path when a segment or endpoint is selected from the canvas, diagnostics, or the tree.
- Render revealed segments as flat indented rows containing only segment ordinal, geometry kind, arc direction/radius when relevant, and length.
- Keep exact endpoints, coordinate spans, provenance, and diagnostics in the existing segment detail disclosure.
- Replace the permanent Expand All, Collapse All, and hover-assist row with one compact options popover.
- Retain the existing information tooltip as a compact icon beside the options control.

## Interaction Rules

- Selecting a contour still selects the whole contour on the canvas.
- Selecting a segment still selects the corresponding canvas segment.
- Hover/focus cross-highlighting remains governed by the existing hover-assist preference.
- Expanding or collapsing tree rows never changes selection.
- `Expand all` expands contour nodes and segment lists.
- `Collapse all` collapses contour nodes and segment lists.
- A later external segment/endpoint selection overrides a collapsed state only for the owning contour and cut path, so the selected item is visible.
- Segment detail disclosures remain independent of contour and cut-path expansion.

## Accessibility

- Existing named selection and disclosure buttons remain separate.
- The options popover has a named trigger and named actions.
- Cut-path disclosure exposes `aria-expanded`.
- Reduced default expansion removes dozens of segment buttons from the initial tab sequence.
- Data attributes used by application tests and cross-feature integrations remain stable where their represented element still exists.

## Non-goals

- No change to DXF parsing, UPID projection, containment, machining order, or generated program text.
- No search, filtering, virtualization, or new inspector behavior.
- No change to the Program lens.
- No restoration of `View > Contour Tree`.
- No commit.

## Verification

- Regression-test the collapsed cut-path default.
- Regression-test cut-path disclosure and automatic reveal after canvas endpoint selection.
- Regression-test compact options behavior, including expand/collapse all and hover assist.
- Run focused editor tests, the production build, and the full test suite.
- Inspect the Geometry lens at 1280×720 with `npx agent-browser`, including a 72-segment DXF.
