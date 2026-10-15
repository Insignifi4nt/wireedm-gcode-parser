# Iteration 4 focused coverage

| ID | Decision | Finding |
| --- | --- | --- |
| `body` | reference | The shared body primitive has exact 8/4 projected top-face edges. |
| `datum-plane` | retain | The v3 datum contour intentionally reuses body’s exact top-face rhombus, without support ticks. |
| `revolve` | iterate | Compare a stepped closed profile about an axis with a stepped turned result and rotation cue. |
| `loft` | iterate | Compare closed oblique section rhombi joined by corresponding generators. |
| `sweep` | iterate | Compare closed tube without a centerline against a visible end seam plus centerline. |
| `select-face` | iterate | Isolated face target; exact body projection and shared pointer modifier. |
| `select-edge` | iterate | Isolated edge target; exact body projection and shared pointer modifier. |
| `select-body` | iterate | Review current 7/4 mini-cube against the body source’s 8/4 projection. |
| `boolean` | retain | Two operand boxes and the overlap-result rectangle are all closed; no decorative ticks. |
| `boolean-union` | retain | The concave union-result silhouette ends with Z; the plus cue is a separate open mark. |
| `boolean-subtract` | retain | The concave subtraction-result silhouette ends with Z; the minus cue is a separate open mark. |
| `boolean-intersect` | retain | The output rectangle is closed. The two partial operand guides are intentionally open contextual edges. |
