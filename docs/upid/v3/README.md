# UPID v3 travel-distance stops

UPID v3 preserves the v1/v2 geometry and document structure. Envelope and document both declare `schemaVersion: 3`. It adds one placement to an operation's `programStops`:

```json
{ "kind": "after-contour-distance", "travelLengthMm": 5 }
```

Distance is measured from the contour endpoint along its straight exit lead, then along the existing positioning move toward the next contour's entry start. It does not include the next entry lead or cutting, create travel, change contour order, or infer missing threading/compensation choices. The distance must be finite, positive and strictly less than that available path. With no next contour, a stop can lie within an existing exit lead. A source contour split into multiple active runs cannot use this placement; review its travel separately. Disabled stops retain finite positive parameters without requiring an executable route.

The compiler splits only the chosen exit or positioning move at the exact point and inserts a normal `program-stop`. Source geometry remains unchanged; stop trace and operation ownership identify the contour that owns the stop, including when its pause occurs during the next operation's positioning. Threading, compensation and existing stops keep their boundaries. A distance stop exactly at an exit endpoint cannot duplicate an enabled `after-exit` stop.

Positioning that performs `automatic-during-positioning` wire separation cannot be split. Use a boundary stop or a reviewed, supported separation-before-positioning strategy. The app does not change installed packages to enable this route.

## Existing placements

| Placement | Meaning |
| --- | --- |
| `before-entry` | At the current wire position, before wire separation and positioning toward this operation |
| `after-positioning` | At the entry start after positioning, before threading, compensation and entry cutting |
| `before-operation-end` | On the contour, with `remainingCutLengthMm` still to cut; entry/exit leads excluded |
| `after-contour` | At the contour endpoint before the exit lead and compensation end |
| `after-exit` | At the exit-lead endpoint before compensation end and next positioning |

Without an exit lead, `after-contour` and `after-exit` pause at the same point. Existing saved choices remain intact. Manual rethreading can already generate a pause after positioning; an authored stop there is another pause.

## Compatibility

New travel-distance intent promotes only the edited project to v3. Readers still accept v1/v2; their placement meanings and execution remain unchanged. Older apps reject v3. Saved revisions and installed packages are never rewritten.

Post schema, engine API and execution event kinds are unchanged. The `program-stop.placement` vocabulary adds `after-contour-distance`. Posts that exhaustively check placement values or assume one unsplit exit/positioning motion may reject new jobs or need a separately reviewed package update. Controller output can contain split moves and an extra stop; generate and inspect it with the exact installed setup. Software checks do not verify controller resume behavior or physical machining. The app does not generate feeds for this feature.
