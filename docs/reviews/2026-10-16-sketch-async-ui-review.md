# Asynchronous CAD interaction checkpoint review

Bounded review of the working tree on 16 October 2026: shared edit submission and prepared preview, controller preview preparation, feature preview coordination, Workbench/Canvas/tree rename lifetime, and profile candidate publication. This does not accept full sketch mode or the later graph drawing/selection work.

## Confirmed and repaired

- **Profile preview ownership:** `CadProfileEditor` located its owning sketch by profile ID alone. Two sketches may legitimately share that local ID. Editing the second profile therefore published a whole-document preview changing the first sketch, although Apply targeted the second. A mounted-editor regression reproduced the wrong geometry and name. Preview ownership now requires the exact accepted profile object; detached standalone profiles do not guess a source sketch. The regression failed before the two-line fix and passes afterward.
- **Synchronous rejection ownership:** Canvas and Workbench both explicitly opened a workflow before submitting a command. On a synchronous rejection, React could batch the submission hook's applying state from true back to false, leaving no dependency change for the pending publication effect. A real radius-to-zero keyboard edit left Canvas ownership open; a real source suppression rejected by its dependent solid did the same in Workbench. Both are reproduced by failing regressions and fixed at their respective helpers. Canvas restores ownership from its unfinished points/path. Workbench retains the pending state that already existed before the command. Real overlapping-contour rejection and invalid part-name tests verify that unfinished user input stays owned and survives until correction or cancellation.

The Workbench regression supplies the stable workflow callback used by the actual app. The older test harness's freshly allocated callback forced the layout effect to run again and hid this failure. No production callback identity workaround was introduced.

## Checked boundaries and evidence

Prepared previews match their source document, edit identity and preparation callback; new input and unmount cancel prior work. Controller preview preparation captures edits before lazy initialization and rechecks signal, document version, workspace and workflow. The feature coordinator retains a separate last valid candidate and prevents late preparation or native results from authorizing another input. Submission cancellation prevents late UI success/error callbacks from clearing a newer editor. Tree rename retains failed text and restores row focus; drawing and grip rejection preserve accepted document/version/history.

Focused verification: **26 profile/panel/feature-preview cases**, the **94-case gesture/picking/tree/coordinator/retention group**, and **77 Workbench cases**. The gesture group initially found one old assertion expecting the former one-argument drawing callback; its existing assertion now also checks the intended `AbortSignal`, and that 23-case picking suite passes. Tests target actual geometry, accepted state, ownership and cancellation rather than removed copy or source text.

Full production/browser verification belongs to the integrating task. Known unfinished graph editing tools and the recorded native arc precision limits remain outside this review; no push, merge or deployment was performed.
