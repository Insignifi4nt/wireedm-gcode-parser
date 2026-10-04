# G-code inspection and posted-output review

## Purpose

Make controller text useful to inspect both on its own and after UPID output generation. UPID remains the source of geometry, machining intent, readiness and saved controller revisions. Inspection explains the posted text and a limited XY projection; it does not certify controller execution or reverse engineer a new UPID project.

## Implementation groups

1. Consolidate command knowledge and block interpretation. Report unknown and unmodeled commands even alongside recognized motion. Explain G39 in explicit controller context. Expose line state, command coverage and preview limitations through a pure inspection operation. Preserve source text and supported legacy behavior.
2. Add one shared inspection workspace: original-order lines, search and line navigation, selected-block modal details, diagnostics, command inventory and linked XY preview. Open external files or pasted text without creating a project. Retain the existing editable import/cleanup workflow and offer inspection of its draft.
3. Open exact generated artifacts from controller export and saved revisions, carrying pinned revision/machine/post provenance and only evidence-backed interpretation defaults. Inspection must not alter output bytes, saved revisions, installed packages or UPID state.
4. Verify realistic standalone and exported programs, unsupported blocks, modal arcs, keyboard navigation and compact layouts. Review independently, document compatibility, release through a reviewed PR.

## Scope controls

- No new post/package/storage schema or output preferences.
- No universal meaning inferred for controller-specific G/M codes.
- No automatic normalization in inspection; existing editable imports keep their established cleanup path.
- Keep initial loading light: standalone and artifact inspection load on demand.
- Bound file/source rendering work; expose omissions or limits explicitly.
- Preserve existing test intent and add only behavior/regression coverage.

## Completion

All four implementation groups are complete. Independent review, full regression tests and targeted native browser verification are recorded in [the review report](../reviews/2026-10-04-gcode-inspection.md). Release 0.0.695 records the unchanged post/output contracts and deliberately conservative preview behavior.
