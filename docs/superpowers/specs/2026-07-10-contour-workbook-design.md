# Contour Workbook Design

Status: implemented in Task 6 on 2026-07-12.

## Goal

Replace the diagnostic-style Contour Tree with a compact workbook that helps an operator understand and select cut contours in execution order. Preserve canvas cross-highlighting, selection, start-point editing, diagnostics, and nested-contour navigation.

## Information hierarchy

- A contour is a workbook card, identified by a prominent cut-order number and human-readable name.
- The card header shows only operational facts: contour role, open/closed state, cut length, direct segment count, and issue count.
- Source identifiers, provenance, nesting metrics, edit counts, direction, and full topology summaries move to hover/focus help.
- An open card contains a clearly labelled `Cut path` ledger.
- Each segment is one numbered cut step (`S1`, `S2`, …) showing geometry, length, direction, and a compact start-to-end summary.
- Segment details are closed by default and independently expandable. Details contain exact coordinates, arc geometry, endpoint topology, diagnostics, and start-point actions.
- Child contours live in a visually bounded `Nested contours` section with parent context. Hierarchy is expressed through cards and section labels, not indentation alone.

## Interaction

- Selecting or hovering a contour, segment, or endpoint continues to cross-highlight the canvas.
- Pointer entry/leave and keyboard focus/blur use the same shared hover projection for contour, segment, endpoint, and lead-in rows.
- The contour disclosure controls the whole workbook card; existing expand/collapse-all actions remain.
- Every segment has a separate disclosure control that does not change selection.
- Selecting an endpoint from the canvas or a projected diagnostic reveals its owning contour and segment details. A subsequent explicit Collapse action remains authoritative until a different endpoint selection requests reveal.
- Controls remain keyboard reachable and expose explicit accessible labels and expanded state.
- Existing `data-upid-*` semantic hooks are retained where their underlying concept remains.

## Export readiness integration

- Unsafe UPID output is labelled `Export blocked`, with blocking diagnostic counts and messages kept selectable through the normal geometry projection.
- Download is disabled and guarded at both preview and page boundaries.
- A blocked preview displays header/footer machine context but no posted operation, move, or body-program rows, even if a caller supplies an inconsistent payload.
- Ready G40 centreline exports retain their existing trace and download behavior. This work does not add compensation, feeds, or automatic lead moves.

## Visual direction

- Dense technical-workbench styling with thin borders and restrained color.
- Strong grouping through card headers, numbered markers, ledger rows, and nested-section bands.
- No repeated labels such as `CONTOUR`, `SEGMENT`, or explanatory action sentences on every row.
- Hover/focus help supplements the layout; it never contains the only name or primary action.

## Verification

- Focused component tests cover the workbook hierarchy, independent segment disclosure, selection, endpoint reveal/collapse, pointer and keyboard hover, and safe export readiness.
- A production build catches TypeScript and composition regressions; the known bundle-size advisory remains non-blocking.
- A final live browser pass for density, overflow, hover help, and narrow-width layout remains the explicit visual caveat for the integrated verification phase.
