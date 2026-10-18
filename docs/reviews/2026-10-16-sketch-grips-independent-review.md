# Sketch grips independent review

Reviewed the uncommitted sketch-grip slice against `e6c9b11f23292df0ad64ec9958006c93abef6b51` on `feature/sketch-workspace-polish`, including new `cadSketchHandles.ts`, shared edits, canvas/picker lifecycle, tool discovery and documentation. General constraint solving and writable arc-connected joints are outside this slice. Both confirmed findings below are repaired; no unresolved actionable finding remains in the reviewed scope.

## Findings

1. **Resolved: a visible grip could edit another profile.** The initial picker pooled all profiles and let the last equal-distance hit win. With profile A selected and a later B sharing a vertex, dragging the visible A grip resolved B, including when A's grip was locked. `cadSketchPicking.ts` now accepts `pick(point, millimetersPerPixel, preferredProfileId?)`. In-tolerance preferred-owner grips win, otherwise the nearest grip wins, and equal distances retain prepared order. All three Canvas coordinate-pick calls now supply `selectedProfileId`. A realistic overlap regression failed against the original behavior before the repair and passes afterward.

2. **Resolved: overlapping grips within one profile could select the wrong operation.** For a tiny circle, the painted center and radius grip circles overlap. The later radius circle can receive pointerdown at a position nearer the center; coordinate picking then translates the center instead of editing radius. Selected-profile priority cannot distinguish these handles. Root's `CadSketchCanvas.tsx:224` repair resolves an explicit grip key against the accepted prepared table for pointerdown, hover and ordinary click, retaining drag-click suppression. It neither reconstructs geometry nor trusts parsed indices from DOM data. The DOM-target regression verifies a radius edit with a nearer center candidate and an unchanged center. Reviewer rechecked the source integration.

## Other reviewed behavior

Free coordinate components move while dimensioned sizes and original expression scalars remain authoritative. Straight-path joints update both adjacent line endpoints. Plugin contours expose no grips. The shared edit boundary checks owner IDs, validates the complete resulting document atomically and preserves accepted input on rejection; session deduplication prevents no-op history. Indices are revision-scoped and documented accordingly.

Grip motion uses the existing pointer-capture lifecycle and candidate-only preview. Version/geometry changes, cancellation, lost capture, missing button state, blur and unmount release ownership. Canvas keyboard grips have names, pressed/disabled states and keyboard edits. Agent handle inspection rechecks version, workflow, cancellation and workspace availability after lazy import; paginated responses and on-demand edit descriptions retain strict execution validation.

## Verification and limits

Reviewer-owned picker tests pass **8/8**. They cover overlapping owners, locked-hit precedence, deterministic ties, nearest fallback and pixel tolerance. The reviewer changed only the two picker files and this record; no broad suite, build, browser or saved-record mutation was performed. Root reports **39 focused picker/gesture cases passed** after the explicit-key repair. Its earlier 130 focused cases and actual Chromium drag/cancel/Undo/keyboard/save-reload journey passed before that repair. Root owns final integration/build/browser checks. No large-sketch performance, universal accessibility or general solver certification is claimed.
