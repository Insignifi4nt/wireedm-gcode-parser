# Reusable Path-Point Inference Design

## Goal

Make path-point selection predictable and reusable across Construction, Set Start, and Entry/Exit. A hover preview must identify the geometric relation being offered, and a click must commit that exact previewed result.

## Domain model

Add one pure `pathPointInference` module as the only implementation of path projection and construction inference.

An inferred candidate contains:

- the exact point and relation: `endpoint`, `nearest`, `midpoint`, `perpendicular`, `tangent`, or `nearest-fallback`;
- operation, path-element, segment, and segment-index identity;
- oriented segment parameter `t` and tangent;
- the reference/source point when the relation depends on one;
- an optional guide from the source point to the inferred point.

The module accepts an operation filter when the caller must remain on a selected contour. Candidate selection is driven by the cursor hint after candidates are constructed.

## Relations

- `endpoint`: nearest oriented segment endpoint.
- `nearest`: closest point on a segment to the cursor.
- `midpoint`: parameter `0.5` on a line or arc.
- `perpendicular`: orthogonal projection of the source point when that projection lies on the finite segment.
- `tangent`: tangent point from an external source to a circle or arc.
- `nearest-fallback`: explicit nearest-point result when a requested perpendicular or tangent cannot be constructed. It is displayed as a fallback, not silently treated as the requested relation.

## Workflow integration

Construction uses the latest measurement point as its source for perpendicular or tangent inference.

Set Start exposes `Endpoint`, `Nearest`, `Midpoint`, and `Perpendicular` selection. Perpendicular uses the reviewed initial-wire point as its source. Endpoint never splits geometry; the other relations may split a closed operation when their candidate is not already an endpoint.

Entry/Exit uses perpendicular inference from the operation start or end point to the hovered contour segment. The preview guide communicates the proposed straight transition, and the committed transition uses the previewed point.

All three workflows call the same inference module. Existing projection and tangent implementations are removed from `pathDocumentOperations`; there are no compatibility wrappers or duplicate fallback implementations.

## Interaction contract

The canvas renders the inferred point, a short relation label, and the source guide where applicable. Hover state stores the complete candidate. Click handlers commit that stored candidate after confirming it still belongs to the active operation and mode; they do not independently recompute a raw cursor projection.

## Testing

Pure domain tests cover lines, arcs, circles, endpoint and midpoint selection, valid and invalid finite-segment perpendicular projections, tangent selection, explicit fallback, and operation filtering. Workflow regression tests cover Set Start midpoint/perpendicular behavior and verify that preview and commit use the same candidate identity. Existing Construction tests continue through the shared implementation.
