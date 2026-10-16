# Start Dimension from the canvas

Local-only work after accepted linked references `2bf808e`. Sketch mode remains incomplete. No push, PR, deployment, version bump, native change or saved-model change.

## Observed workflow

Root created a part entirely through the human UI: dashboard → Sketch → XY glyph → rectangle → fixed origin → width50/height25 → circle → Ø6 → origin-to-center X25/Y12.5 → Finish → Pad5. Read-only WebMCP inspection afterwards confirms eleven relations, zero freedoms, no conflicts/redundancy and one **6108.628330588458 mm³** native solid. Geometry was not seeded or selected by an agent tool. Proof: `tmp/sketch-blank-human-proof.json`, `tmp/sketch-blank-human-solid.png`. Ten Undo steps restored the disposable draft empty; no user record was saved.

That route works. The confirmed restriction is narrower: Dimension cannot start without an eligible preselection. A person wanting to choose the command before its edge must first discover the selection dependency. This slice lets the same command guide one edge pick, then hands off to the existing dimension editor.

## Bounded implementation

- Preserve current preselected line length, line-pair angle, point-pair dimensions and legacy profile routes verbatim.
- With no eligible preselection, enable Dimension when the current graph contains a driveable line, arc or circle. Exclude linked construction owners and circles whose radius follows an expression without an explicit radial dimension.
- Arm one operation-local, accepted-document/version/sketch-owned **edge** pick using the existing canvas `entityPick`. Display a short instruction and Cancel in the current inspector. Do not introduce another toolbar, selection service or sketch tool enum.
- The existing picker handles overlap and pointer/keyboard activation and prevents geometry mutation. Picking a line opens ordinary Length; an arc/circle opens the current radial editor. Retire the picker before publishing that editor. Preview, scalar ownership, Apply, Cancel, native validation and history remain unchanged.
- Escape/Cancel restores the prior selection and tool without editing. A source/version/sketch change invalidates the request and old callbacks. Pending ownership blocks Finish, tree navigation and other commands while retaining viewport navigation. Existing pick cancellation stays under the canvas frame owner.
- This first pick route explicitly asks for an edge. It does not claim sequential point-pair picking, inferred angle sectors, persistent reference dimensions or measurement-only annotations. Existing point-pair/line-pair preselection remains supported. No agent tool for clicking Dimension is needed: the same existing typed dimension/relation operations remain the authoring interface.

## Acceptance before checkpoint

Write a real mounted Workbench regression before implementation: remove preselection, invoke Dimension, reject ineligible source callbacks, pick an eligible edge, Cancel with exact source/history, then accept through the existing editor. Exercise revision change and stale callbacks at that owner. Preserve the current preselection routes.

Extend a complete drawing/editing journey so Dimension is deliberately invoked before its edge; verify the actual native result and private Finish/global Undo. Verify pointer/keyboard picking, Cancel, source expressions and saved/reopened intent through existing operations. Use focused tests first, then full production types/build/shared-control checks and the affected complete journeys in Chromium/Firefox. Inspect the real app after the frozen build. Do not add copy/label-presence tests or rerun unrelated suites for this UI-only change.

## Separate recorded friction

The selected point-pair inspector can grow to nine incident relation rows for this small plate. That is real information density, visible in the disposable walkthrough, not missing geometry. Consider a compact shared disclosure separately; do not mix relation-storage/solver changes into this picking slice. The screenshot `tmp/sketch-blank-human-dimensions.png` caught an intermediate native frame while Y was still being edited; it is not proof of the final 12.5 value. The exact accepted proof JSON is authoritative.

## Independent design review

Reviewed against accepted `2bf808e` and the actual Workbench, Canvas, GraphLayer and existing Length/radial editor seams. Bounded design is sound. No production edits, tests, probes, builds or browser actions by this reviewer. Root's measured human-created part establishes that the original authoring route works; it does not establish this unimplemented fallback.

Keep the state in Workbench: one immutable pick request containing document/version/sketch ownership, the prior tool and graph/profile selection, and the eligible entity IDs. No new form, solver operation, tool enum or generic picker hook is needed. Derive this stage's pending status from the request itself; another child publishing `setEditorPending(false)` must not release the picker. The existing `entityPick` already excludes point/box/profile/drag mutation, filters overlap candidates, and supports pointer and keyboard activation.

Keep request identity stable while its own Canvas menu publishes drawing pending. That pending and the resulting navigation lock are not foreign work; treating them as cancellation would repeat the repaired Mirror/reference menu-owner problem. Source/version/sketch changes, cancellation and actual competing commands must invalidate the current request and its old callbacks. Canvas already pins an open menu to source, version and frame; changing the frame closes that captured menu while the command can remain available for a fresh pick.

On a valid pick, check the current request object and source/version/sketch plus eligible identity, retire that request, then select the edge and publish the existing Length/radial command in the same event. This prevents the old picker from accepting another result or cancelling its successor editor. Cancel restores the captured selection/tool only if the same source is still current; invalidation after a document/sketch change must discard the old state rather than restoring its IDs into a new context. Arming from an unfinished drawing remains blocked by the existing pending guard.

Eligibility should mirror the existing editor route, not guess general solvability from DOF. Keep the existing line-pair angle, point-pair, legacy profile and eligible singleton branches first. Reuse an existing length/radial owner and its exact driver rather than adding another relation. Exclude linked supports and expression-owned circles exactly as proposed; ordinary constraint conflicts remain the existing prepared editor's responsibility.

One concrete Canvas adjustment is necessary: its entity-pick overlap text currently distinguishes only Circle versus Line, because previous consumers accepted those kinds. This fallback admits arcs, so label the actual line/arc/circle kind consistently with GraphLayer. No copy-only test is needed; an actual arc choice/handoff case can cover the behavior if included in the focused route verification.

The planned mounted owner regression and complete part journey are sufficient implementation gates. In particular, exercise an owned overlap menu without self-cancellation, stale callback rejection, Cancel with unchanged history, and direct handoff to the existing editor. No schema, native setting, saved-model or agent-click interface change is required. This recommendation does not mark the broader sketch workflow complete.

## Independent actual-source review

Reviewed the implemented Workbench request and Canvas kind-label changes above `2bf808e`; no reviewer tests, builds, probes or browser actions. The request derives its own pending state, pins document/version/sketch and eligible IDs, and stays current while its Canvas menu owns drawing pending. Picking retires the request synchronously before selecting the entity and opening the existing Length/radial editor. Cancel restores the captured tool/selection only for the same source; source replacement discards the request. Existing preselected line, circle, point-pair, angle and legacy routes remain first. Arc overlap choices now use their actual kind.

Two narrow review items are repaired. Parameters already expanded in the tree and legacy dimension annotations initially omitted the new request from their existing command locks; they could replace the picker with another editor. Both locks now include `currentDimensionPick`, with a genuine missing-parameter-lock RED. The picker Cancel callback now checks its captured request identity before invoking cancel-current, so an old callback cannot close a newer request. Final source reread found no further actionable defect in this bounded slice.

Root's frozen evidence: 174 cases across the actual Workbench, Canvas and RelationsPanel suites pass (`tmp/sketch-dimension-pick-ui-first.log`); full `tsc -b` and shared UI checking pass (`tmp/sketch-dimension-pick-final-types.log`). Coverage includes the original no-selection RED, unchanged accepted document/history after Cancel, eligibility, stale source/callback handling and Arc-to-Radius handoff. A new snapshot object after workflow changes is expected; accepted content and exact document identity are the meaningful invariant.

Root extended the existing circle part journey to invoke Dimension before a keyboard rim pick. Final production build and browser/native acceptance are pending at this source-review freeze. No production acceptance or broader sketch-completion claim is made here.

## Root production acceptance

The frozen production build, full types, shared UI check, documentation and corresponding source distributions pass. All 29 complete journeys in the affected constraints, Mirror and linked-reference suites pass in Chromium (tmp/sketch-dimension-pick-production-chromium.log). Four targeted Firefox journeys pass: no-preselection Dimension, private consumed sketch editing, Mirror axis picking and linked Use (tmp/sketch-dimension-pick-production-firefox.log). The existing circle journey now clears selection before starting Dimension and activates the real SVG circle with Enter; it continues through native extrusion and save/reopen.

Actual native tab 22 used human controls only to create a circle from blank, clear its selection, start Dimension, Cancel, start again and pick its actual edge by pointer. The existing radial editor accepted diameter 8, leaving two positional freedoms and a read-only radius grip. Finish and Pad 5 produced one native solid, volume **251.32741228718345 mm³**, no diagnostics. Only after authoring did read-only WebMCP inspect the accepted feature definitions/build. Proof: tmp/sketch-dimension-pick-native-proof.json and tmp/sketch-dimension-pick-native-solid.png. Four Undo steps restored the disposable draft empty; the tab closed without saving. The original user tab was untouched.

Independent actual-source review is satisfied and this bounded interaction is accepted. No native/solver, stored schema, public authoring operation, version or remote change. This does not complete sketch mode: persistent reference dimensions, editable patterns, ordinary tangency and the broader usability audit remain open.
