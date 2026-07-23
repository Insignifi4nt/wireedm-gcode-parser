# Reviewed Optional Lead Intent Design

## Goal

Allow an operator to export a Robofil v2 operation without fabricated lead geometry when the controller lifecycle supports that choice, while keeping accidental omission blocked.

## Model

Entry and exit transitions each gain a typed `none` strategy:

```ts
{ strategy: 'none'; review: 'reviewed' | 'required' }
```

This is distinct from a missing transition. Missing means the operator has not made a decision. `none` with `reviewed` means the operator explicitly chose direct contour entry or contour-end exit.

Setting `entry: none` removes any manual lead-in override. Setting a geometric entry replaces the `none` intent and restores the canonical override. No parallel compatibility field is introduced.

## Machine policy

The UI offers reviewed no-entry/no-exit choices only for the verified Robofil v2 operation-scoped lifecycle. Other controller envelopes keep their existing transition requirements.

Robofil v2 export requires an explicit reviewed entry decision and an explicit reviewed exit decision for every operation:

- reviewed straight or circle-center entry, or reviewed `none`;
- reviewed straight exit, or reviewed `none`.

Unreviewed or missing decisions block export with an actionable diagnostic.

## Posting

For reviewed no-entry, positioning ends at the canonical operation start while compensation is cancelled. The post activates the resolved compensation code immediately before contour moves and emits no fabricated lead-in cut.

For reviewed no-exit, the post emits no lead-out move and closes the operation lifecycle normally with compensation cancellation at the next boundary or program end.

## UI

Entry/Exit shows the current explicit decision and provides `Use no entry` and `Use no exit` actions when the active machine permits them. These actions are visibly reviewed choices, not default absence.

## Testing

Tests cover missing, unreviewed, reviewed-none, geometric, and conflicting lead states; v2 posting without fabricated moves; portable UPID validation; UI availability by machine policy; and replacement between none and geometric strategies.
