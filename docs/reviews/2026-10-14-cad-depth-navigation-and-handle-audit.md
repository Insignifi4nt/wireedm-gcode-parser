# Existing depth editing, navigation and the required physical handle

Date: 2026-10-14. Read-only product audit at `25b3994af33d3a7f011651a42603f8dd898af597` while that checkpoint's full CI runs. No production, existing test, settings, browser, native kernel or server changes were made. A disposable data fixture and this private record are the only new files.

## Current behavior and outstanding request

The app has no extrusion depth handle renderer or solid-handle preference. `CadPreferences` contains `navigationMode` and `showOnPartDimensions`; CAD Display explicitly describes the latter as editable controls beside selected sketch geometry. Physical optional Pad/Pocket distance interaction remains an unfulfilled user request within those existing features. It needs no new kernel feature kind. Through-all Pocket has a direction rather than a numeric depth.

Existing `CadExtrudeFields` edits signed distance and symmetry through `CadFields` inside the editor's scalar context. A sole named driver changes its shared numeric parameter while preserving the exact source expression, including whitespace. All dependent features preview together through the typed feature-plus-parameter batch. Compound expressions display their evaluated quantity read-only until the deliberate fx relation edit/unlink action. No-change quantities retain literal representation and exact precision. Invalid raw numeric/relation text preserves the previous valid preview but blocks Apply; old ready definitions cannot authorize a changed or invalid current batch.

`CadWorkbench` deliberately separates interaction from navigation locks. Pending scalar edits block body/source selection, topology and context commands, while mouse orbit/right-pan/wheel and trackpad pan/Alt-orbit/Ctrl-pinch remain available. `CadViewport` updates uploaded geometry without replacing its established camera or fitting subsequent candidates. Setting switches and changed layers cancel active pointer ownership, preserving camera/target. Trackpad deltas are normalized in the camera's actual right/up basis; wheel handlers are canvas-scoped. No actionable existing binding or navigation defect was established in this pass.

Public context/feature/document/viewport reads can describe the accepted draft during a pending human edit. Parameter inspection, mutation, history, viewport commands and viewport capture retain their existing workflow guards. A pending image must be observed through CUA; calling the public capture operation is intentionally refused. The public viewport exposes view name, zoom and revision, but not the full solid camera position/target. A revision can change on a geometry/reference repaint, so revision equality is not a sufficient or appropriate camera-stability assertion.

## Small real fixture for physical verification

File: `tmp/cad-linked-depth-navigation.cad.json`, 1,280 UTF-8 bytes, SHA-256 `ad8fd90e773801620aec0ef8c308649111eb88459c55b624f2274afda0623aa1`. It is validated declarative data, not a saved workbench record. Root may import it in a disposable browser tab through the shared public import operation; normal fresh document identity replacement is expected.

Parameter `depth = 10` drives five ordered features:

| ID | Definition |
| --- | --- |
| `stockSketch` | XY rectangle at `(0, 0)`, 20 by 20 mm, offset 0 |
| `stock` | New Pad from stockSketch, exact distance string ` depth `, not symmetric |
| `followerSketch` | XY rectangle at `(35, 0)`, 5 by 5 mm, offset 0 |
| `followerPad` | New Pad from followerSketch, exact distance string `depth * 2` |
| `follower` | Move consuming followerPad, translation `[0, 0, 'depth']`, rotation zero |

The shared parser accepted the complete fixture. A pure `CadSession` replay of the correlated depth edit and one Undo restored every definition exactly, with no remaining Undo step. That replay also verified evaluated distances and translation. No native build was run in this audit. Independent expected native results for root's physical check are:

| Accepted driver | Stock volume/bounds | Visible follower volume/Z bounds |
| --- | --- | --- |
| 10 mm | 4,000 mm³; `[0,0,0]` to `[20,20,10]` | 500 mm³; Z 10 to 30 mm |
| 20 mm | 8,000 mm³; `[0,0,0]` to `[20,20,20]` | 1,000 mm³; Z 20 to 60 mm |

Follower X/Y bounds stay `[35,0]` to `[40,5]`. Those are rectangular volume and placement predictions, not claims of an already observed browser/native result.

CUA/public sequence for the coordinator:

1. Preserve current device preferences, import the fixture in a disposable tab and call `cad_build` at its fresh accepted version. Read the complete accepted document and record no Undo/Redo. Select `stock` through `cad_set_viewport`; set Front and Fit once while accepted. Record zoom, view and actual stock base-edge screen endpoints. Front exposes signed XY depth vertically and separates the follower horizontally.
2. Focus the exact textbox `Length mm`, initially 10, and type 20. Wait for real `Preview · Apply to keep` and enabled Apply. Observe both bodies changing in the screenshot and stable stock base-edge endpoints/zoom/view. Read accepted context/document: same accepted version, depth still 10 and all source bindings unchanged; workflow open. Try a public viewport command or capture and require `WORKFLOW_OPEN`. Public `cad_build` must not replace the private preview during this workflow.
3. Click Cancel. Require the original accepted version, exact full document, no Undo/Redo and unchanged deliberate camera framing. Native readback again must describe the 10 mm row above. Repeat 20, wait for current readiness, then Apply. Read depth 20 with all five exact feature definitions unchanged. `cad_build` must report the 20 mm row above. One `cad_history` Undo at the new current version restores the complete 10 mm document and leaves no earlier Undo step; the old accepted version must reject any stale mutation. Undo advances the document version normally.
4. Select `followerPad`: Length displays 20 at depth 10 and is read-only. Opening `Edit Length relation` must show `depth * 2`. Close the help without a relation action and require no geometry/history change. No invented drag control is expected in this checkpoint.
5. In accepted state, choose Trackpad in CAD Navigation, then reopen stock's numeric depth edit. While pending, two-finger scroll pans with zoom unchanged, Ctrl/pinch zooms and Alt-scroll orbits. In Mouse mode, right-drag pans and left-drag orbits without selecting another body or opening a menu. Record the camera after deliberate navigation, then change the quantity again: candidate completion, Cancel, Apply and Undo must preserve that deliberate framing. Restore the original device preferences before closing the disposable tab. Camera movement caused by those intentional gestures is expected; candidate installation must not add a Fit.
6. After a valid 20 preview, type blank or `-`: earlier visible geometry may remain, but Apply is disabled. Correction to another valid depth needs its own ready preview. Focused Escape cancels the feature draft; native text Undo remains owned by the input. A late response from an invalidated/cancelled preview cannot restore it or create history.

## Smallest sound implementation seam after the current gate

Keep `CadFeatureEditor` as the only provisional feature/parameter owner. Extract its existing numeric scalar intent into one pure helper shared by `ScalarValueField` and a depth controller: unchanged literal preserves representation; literal edit changes the feature scalar; alias edit changes the parameter; compound edit returns a locked relation. Deliberate fx editing/unlinking remains separate. Reuse `cadFeatureCandidateEdits`, `cadFeatureCandidateKey`, complete-document validation, private preview coordinator and the existing atomic `applyFeature` seam. A new visual control must not implement another binding policy or call a session edit directly.

Expose only an internal selected-extrusion interaction controller between the editor, Workbench and viewport: evaluated quantity/binding plus begin, provisional quantity change, release and gesture cancellation. Its owner identifies the editor, feature/source, accepted document/version and current source definition. A gesture snapshots the current provisional batch so pointer cancellation restores that batch rather than discarding earlier typed edits. Full feature Cancel/Escape restores the accepted draft. Release settles the latest candidate; existing Apply performs the single accepted Undo step. Pending raw relation text, stale owner/base, unavailable source/native result and compound bindings reject movement with actionable relation context. No new agent tool or schema kind is needed: agents use existing structured feature/parameter edits and the same validation.

Add one optional CAD Display preference for these solid handles, independent of documents/history. Old device preferences must parse with a defined default for the added setting and keep their original stored content until a user makes a preference change. Disabling the setting during a gesture cancels that gesture. On-part sketch dimensions remain a separate setting.

The renderer must use `resolveCadSketchPlacement`/the resolved datum frame and Float64 world-to-local projection, not body bounding-box Z. For local source anchor `q`, base frame origin `O`, normal `n`, signed offset `o` and depth `d`, the station is `O + u*q.x + v*q.y + n*o`. The one-sided endpoint adds `n*d`; symmetric endpoints add `±n*d/2`. XY normal is +Z, XZ is −Y, YZ is +X; datum axes come from the actual frame. Both positive and negative depths work, and zero remains an invalid pending candidate rather than being silently clamped. Through-all shows no distance handle. Selected historical/consumed Pads use their source frame and existing highlighted source reference, with clear selected-feature context; placing a handle at a later transformed body's extreme would edit the wrong station.

Keep pointer capture and a handle's geometry gesture separate from OrbitControls ownership. Suppress camera gestures only while actively dragging that handle; outside the gesture preserve current readonly navigation during numeric previews. Frozen drag projection and source/version ownership must survive the gesture's own preview mesh/reference publications without self-cancellation. Escape, pointercancel, lost capture, blur, source/accepted version change, settings switch or renderer loss cannot accept a batch. An axis projected nearly end-on must offer the existing exact Length field/rotation context rather than jump, invent a direction, rotate the camera automatically or create nonfinite values.

One correlated-frame policy needs explicit agreement before implementation. A source sketch offset `depth` with Pad distance `depth` has endpoint Z `2*depth`; mapping a 10 mm screen-derived world endpoint displacement to depth+10 would move the true endpoint 20 mm. The symmetric positive endpoint is `1.5*depth`. Shared datum rotations make this mapping nonlinear. Numeric editing already handles all these relations correctly. A handle may either edit displayed depth deltas measured in the gesture-start frame, or follow the world endpoint through a mathematically justified correlated-frame mapping. These are different interaction promises. It must not silently detach/freeze the source relation, infer a numeric solver from a mouse delta, or claim the pointer follows the endpoint if it does not. This is a design boundary for the requested new interaction, not a discovered defect in the current numeric implementation.

Meaningful red-first work after agreement: shared scalar intent/full precision; literal and alias/compound behavior; positive/negative and symmetric endpoints on principal and datum frames; correlated source offset/rotation; one full-document provisional batch affecting stock and follower; release/Cancel/Undo; latest-invalid/late-native/stale store/version refusal; projection degeneracy and far placement; pointer ownership and readonly navigation; settings lifecycle; actual browser geometry/camera/source proof. No test should merely assert a new icon or field exists.

## Checks and immutable source references

Node24.22.0 focused read-only execution selected 11 existing cases across `CadFeatureScalarValues`, `CadFeaturePreviewEditor`, `CadFeaturePreviewRetention` and `CadViewport`; all 11 passed. The remaining 47 cases were excluded by the explicit test-name filter, not newly skipped or weakened. Log: `tmp/cad-depth-navigation-readonly-focused.log`. No broad/heavy/native reruns were performed by this agent. The coordinator's subsequent actual CUA/native proof is recorded below.

| File | SHA-256 |
| --- | --- |
| `CadWorkbench.tsx` | `46E057178F88287DB326CFB790E55EB18782CB9F078980F5D177EF5EAD17422A` |
| `CadViewport.tsx` | `D3ABDE1B86BC928B88036C6A9FBC03E00C07379F6CDA791EF209684CEFBBF8AE` |
| `CadFeatureEditor.tsx` | `0A73DF8802349D323EB416D758D056D7E644C51F2BEB72D3298E1C09CB818914` |
| `CadFields.tsx` | `042BAB0E6A9BA25B01D60DDC107BB1E4C11253B73484CF85F0C729933A42C664` |
| `cadFeaturePreview.ts` | `A4B72626779D86027ADB5309BCE866E2E8FE64A3FDB83AFC5501A865C858E7F7` |
| `cadPreferences.ts` | `5B14241950727C81353B93B632DAEB0F4213A4F7C78A32EA3039E64E44FD063B` |
| `CadExtrudeFields.tsx` | `88CC4C43EB6EEAB469D5C9F274FEE70CC2B294F5DEC15E5EE868677E30CF8C9E` |
| `src/app/CadSettingsPanel.tsx` | `46C69C5A28FFC4FDD7293599318CDF79EFE63A7251BED80383FFB12EB9316C08` |
| `src/domain/cad/cadPlanes.ts` | `1FF00C9441D3D8151D42208DE6A4531D063E902A79C86F71613C2E129E11B842` |
| `src/domain/cad/cadDatumPlanes.ts` | `1EA93936532CF178E2F818756F32442AFDBF640A8EC1E55958C6EC7818F28845` |

Feature filenames above reside in `src/features/cad`. Existing vendor-reference research is recorded separately in `2026-10-14-cad-reference-interactions.md`; it does not certify local handle/region parity. Production remains frozen for the coordinator's actual CI gate.

## Subsequent actual linked-depth browser proof

The parent imported the exact disposable fixture in tab 22 using the `25b3994` production bundle. Primary-checkout `tmp/cad-linked-depth-browser-report.json` SHA-256 is `8746602C909DF22BA77C2BEB9A0B133C2CAC1A63432047AAFB081FB59FDA2F55`. I read that report, independently asserted its source/context/build/navigation facts and viewed the before/ready-preview PNGs.

The initial native body volumes are 3999.999999999999 and 499.9999999999999 mm³, with the exact predicted follower bounds `[35,0,10]` to `[40,5,30]`. The human Length 10→20 ready preview visibly doubles the stock height and moves/enlarges the follower; the stock's base edge remains at the same screen pixels and the inspector reports 8,000 mm³. Accepted version `bbddfff1-5077-460e-886a-83c0758751f6` and accepted depth 10 remain unchanged while that preview owns the workflow. Both actual public capture and edit attempts return `WORKFLOW_OPEN`.

Actual trackpad pan changes reported revision 11→12 while retaining Front and exact zoom `2.432661546513554`; the parent observed the candidate remaining ready. Cancel restores the same accepted version and no Undo/Redo while preserving the chosen framing. Repeat editing and Apply accepts depth 20; native readback reports stock 7999.999999999998 and follower 999.9999999999998 mm³, with follower bounds `[35,0,20]` to `[40,5,60]`. The parent also inspected Compound depth Pad's Length 40 and read-only state.

One public Undo restores all five exact feature definitions, every source string including stock distance whitespace, depth 10 and the original native bounds/volumes. My independent deep comparison of `undoneSource.features` and parameters against the local canonical fixture passed. Undo correctly advances version and leaves no earlier Undo step, with Redo available. No Save occurred. This is bounded physical/source proof for current numeric editing and trackpad pan; it does not claim that physical handles exist, that every mouse gesture or correlated-frame handle case was exercised, or that a solid viewport revision alone proves complete camera identity. Primary screenshots are `tmp/cad-linked-depth-before.png`, `cad-linked-depth-preview.png` and `cad-linked-depth-preview-panned.png`.
