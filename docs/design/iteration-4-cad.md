# CAD icon iteration 4 review

Iteration 4 corrects the v3 projection mistake and narrows the remaining feature drawings. All alternatives are isolated in `scripts/icon-revisions/cad-v4.mjs`; the renderer writes review images only. This review did not edit the shared icon source or generated catalog assets.

## Recommendations

| ID | Recommendation | Why / remaining limit |
| --- | --- | --- |
| `revolve` | Prefer `stepped-lathe-result` from v4 for the next integrated review. Keep `stepped-profile-axis` as the input-metaphor comparison. | The source-profile option improves closure but still reads as a bracket at 14px. The symmetric stepped result plus central axis and outer rotation cue reads as a turned form at 14–24px. It still needs a CAD-context check against a generic body icon. |
| `loft` | Prefer `oblique-section-rhombi` from v4. | The two closed rhombi are separated vertically, scale differently, and connect corresponding vertices. The ±0.5 slopes match the isometric body family. This avoids the cup silhouette from v2/v3 and the flat orthographic sections from v3. At 14px it is compact, but the two loops and generators survive. |
| `sweep` | Prefer `tube-no-centerline` from v4. | The closed curved body reads as a swept result while avoiding the centerline’s doubled detail at 14–16px. The end profile remains the closing segment of the contour. `tube-centerline-end-seam` is the comparison if the end section needs extra emphasis at larger sizes. |
| `select-face` | Use the isolated top-face rhombus plus the select-body pointer shape translated so its tip lands inside the face. | The face uses the exact body top-face vertices, preserving the target distinction instead of showing another full cube. |
| `select-edge` | Use the isolated body-aligned top edge, endpoint marks, and the same pointer shape with its tip on that edge. | The edge vector `(12,4) → (20,8)` has the same 8/4 projection as the body. It remains distinct from face selection. |
| `select-body` | Reuse the exact `body` paths, then append its current pointer modifier. | The source select-body cube uses 7/4 edges, while the shared body uses 8/4. The v4 path removes that small but visible family mismatch. |
| Boolean family | Retain current paths. | The operation-result contours are closed and logical; the open strokes are the separate plus/minus cues or partial operand guides. No decorative marks are needed. |

The current `datum-plane` v3 contour uses the exact same rhombus as the `body` top face and as the target outline for `select-face`. That reuse is intentional. The standalone datum plane has no pointer; select-face adds the pointer; body shows the full solid. Those surrounding marks distinguish the meanings without changing the projection.

The earlier pad-pocket plus/minus candidate remains a better direction than two overlapping arrowheads: one orthographic stepped profile with plus/minus marks. It is not changed in this v4 pass.

## Geometry checks

The v4 revolve profile candidate is closed and stepped around the axis. The turned-result candidate uses a closed, symmetric stepped silhouette, an axis, and a separate circular cue.

The v4 loft uses two closed four-sided oblique loops: the upper loop spans `(8,5)` to `(16,5)` and the lower spans `(4,18)` to `(20,18)`. Four generator paths join corresponding vertices. Each rhombus uses the exact 2:1 horizontal-to-vertical edge slope of the body’s isometric top face.

The sweep result is a closed path with two curved boundaries and a connecting end segment. The centerline/end-seam variant keeps that end segment as a separate stroke; the line is not left open. The no-centerline option removes the inner trajectory, which stays visually cleaner at toolbar sizes.

Boolean result closure was checked directly against source paths:

- `boolean` is two closed operand boxes and a closed overlap rectangle.
- `boolean-union` is a closed concave union silhouette; its plus sign is a separate open mark.
- `boolean-subtract` is a closed concave remaining-solid silhouette; its minus sign is a separate open mark.
- `boolean-intersect` uses a closed output rectangle. Its two partial operand-guide paths are intentionally open context edges, not open result geometry.

The previous mirror and linear-pattern paths already contain explicit `Z` closures. No path-closure changes are justified there.

## Comparison sheet and validation

`scripts/icon-revisions/render-cad-v4.mjs` compares current source, the relevant v3 candidate, and each v4 option at actual 14, 15, 16, and 24px. It generates dark and light sheets at each size in `docs/design/icon-review/iteration-4-cad/`. It also writes `boolean-and-focus-coverage.md` with a disposition for Revolve, Loft, Sweep, selection targets, and all four Boolean IDs.

The renderer validates every v4 path for 24-unit viewBox bounds and non-empty output at all four target sizes. This v4 pass proposes no changes to CAM icons, files, or CAD implementation.
