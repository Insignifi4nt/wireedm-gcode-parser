# Direct graph-circle sizing

Local slice after `4fd7dee`. This completes an existing circle interaction in S07, without adding a circle tool, native equation or persisted schema.

## Interaction and ownership

A selected graph circle exposes a distinct circumference grip; a short leader keeps it clear of the center on small circles. Dragging it changes radius around the captured center; selecting its center retains the existing point-move behavior. Entity/point filters and multiple-selection rules remain authoritative. A numeric radius without a radial or equal-radius owner is eligible. An expression or existing size relation stays authoritative and gives a short reason to use its dimension instead. A global freedom count alone does not prove radius mobility.

Reuse the graph layer's captured source/version/frame, pointer threshold, temporary prepared document, submission and cancellation lifecycle. Radius and point intents are a discriminated union. Preview and acceptance create the same existing full `update-feature` intent, preserving every other source field; no hidden persistent dimension is added. Radius uses the cursor's distance from the captured center, with the same grid toggle/modifier suppression as other sketch gestures. Reject zero, nonfinite and unsupported bounds instead of clamping the source. Escape, lost capture/buttons, blur, source/frame changes and competing owners cancel. One accepted drag is one history step. Keyboard sizing uses the same target and operation.

## Acceptance

- Red-first source-control cases prove eligible/owned radii, exact unchanged points/relations/other entities, bounds and invalid targets.
- Gesture regressions exercise preview, final acceptance, cancellation/stale receipts, selection retention and locked-driver behavior; avoid styling/copy assertions.
- Actual browser workflow resizes a free circle, cancels another attempt, accepts one edit, adds a driving size, verifies the free grip cannot bypass that owner, extrudes and saves/reopens exact source. Check both Chromium and Firefox and the native in-app browser.
- Agent discovery already exposes graph entities, exact radii and complete feature updates. Verify that the same saved result can be produced through guarded WebMCP operations; a human grip is not a new API command.

Ordinary line/arc tangency remains explicitly open in its preflight note. Equal-radius direct dragging, general arc-radius gestures, Trim/Extend, Offset and external references remain separate acceptance work. The isolated arrangement module stays unwired. No push, PR, merge or deployment.
