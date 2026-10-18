# Sketch constraint feedback: independent review

Bounded working-tree review against `89bb5dd454f10cc556a45656da5c5eb8a2b65711`, 2026-10-16. Scope: GraphLayer, RelationsPanel and Workbench feedback ownership, plus their candidate-feedback/preparation/preview boundary. The [feedback plan](2026-10-16-sketch-constraint-feedback-plan.md) defines intent. The shared boundary was still being implemented during the initial pass; unfinished wiring was not treated as a regression. This reviewer made no production edit or broad test/build/browser run.

## Findings and disposition

1. **Inspecting a failure hid its correction field.** Diagnostic click cleared `activeRelationId`, unmounting the provisional Length/Distance editor. Root repaired it to change only diagnostic inspection, retaining the active editor and exact pending `12.5000` text. Diagnostic operand highlighting takes precedence without changing selection, draft or history.
2. **Cross-sketch failures could highlight unrelated local IDs.** Whole-document preparation can reject another sketch after a shared parameter edit. Feedback retains its `sketchId`, but Workbench originally stamped the active sketch ID on its subject. Matching local IDs could therefore highlight unrelated points. Root now gates inspection/callback by feedback owner. Other-sketch failures retain their message and disabled rows, with finish/cancel guidance instead of automatic navigation.

Both repairs were source-rechecked. The panel's same-sketch, Cancel, changed-source and colliding-ID cases pass in **16/16** (`tmp/sketch-feedback-panel-green.log`). Layer's focused cases pass **21/21** (`tmp/sketch-feedback-layer-green.log`).

Failed candidates remain outside accepted geometry/history. Inspection clears on source/candidate change, Cancel and teardown. Global sketch DOF is not point-level freedom; numeric coordinate write permission permits a guarded request without claiming independent motion.

The plan's silent unchanged-move gap was also repaired. Workbench reports a constrained move only for an authoritative unchanged snapshot, current signal and matching source/version/sketch, never from `void` or inferred point freedom. Its no-op/cancellation regression passes (`tmp/sketch-feedback-noop-green.log`). No extra solve/cache was added.

## Frozen boundary pass

The presenter preserves candidate-owned operands, frozen exact machine diagnostics and omission counts; human labels use graph ordinals. Preview retains source/edits/prepare identity and abort guards. The tool adapter preserves the typed error through the existing bounded analysis summary. The boundary owner reports 37 focused cases plus scoped TypeScript checks passing; this reviewer checked source/tests without repeating them.

Root also reproduced a missing Canvas capture invalidation and added `graphControls.inspection` to visual identity (`tmp/sketch-feedback-capture-red.log`); that source repair was rechecked. The combined four-file UI gate passed **149/149** (`tmp/sketch-feedback-ui-final.log`). Counts overlap. No actionable source issue remains in this bounded review. Build, native/browser proof and the broader sketch goal remain with root; no completion of those gates is claimed here.

## Root acceptance

The full production build, app TypeScript, shared UI check, documentation and pinned source distributions pass. The final 14 production sketch/region journeys pass in Chromium and Firefox against that completed build, including candidate highlighting, retained exact input, structured WebMCP conflict rejection, unchanged accepted source, Cancel/Undo, constraints, native solid/export and Save/reopen. Logs: `tmp/sketch-feedback-build-final.log`, `tmp/sketch-feedback-all-chromium.log`, `tmp/sketch-feedback-all-firefox.log`. The first browser run exposed an incomplete test setup: it asserted an editor survived without opening that editor after the preceding Apply. The corrected journey explicitly opens Dimension, types `40.0000`, then introduces the conflict and verifies the field survives inspection. No production change was needed for that setup correction.

The native in-app browser independently seeded A driven at the origin, B held horizontal at a 40 mm distance and an unrelated free C. A requested move of B kept the accepted version and showed the constrained-target info notice. A pending `41.2500` distance plus Vertical rejected; inspecting the distance highlighted exactly A/B while retaining the precise field. Cancel restored the source. Native WebMCP then returned the candidate `attempted-vertical` ID, correct operands and `sketch-conflicting`; accepted version and complete feature equality remained unchanged. Proof: `tmp/sketch-constraint-feedback.png`. The disposable unsaved tab was closed without saving records; the user tab was untouched. Public agent guide and icon location inventory updated.

No saved schema/storage migration, native solver/threshold change, installed post/machine change or remote action. Point-level native freedom is still unavailable through the pinned package, so unknown movement remains honestly described. Declared coincidence material joints, broader relations/topology and intersecting-cell integration remain separate work. This checkpoint does not complete sketch mode or the overnight goal.
