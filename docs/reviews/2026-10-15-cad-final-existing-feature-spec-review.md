# Bounded final existing-feature Spec review

2026-10-15; checkpoint `70f45e978c77c67cc3f6f73e2822c5684daba11d`. This pass compares the latest user direction with current interaction records and checks implementation only for plausible gaps. It does not independently approve the reviewer's own capture repair; that has Explicit's separate hashed review. No tracked product/test/package source, browser, server, build, commit or push was changed. Complete new-head CI is parent-owned and was running during this review.

## Request coverage

| Current requirement | Current evidence and limit |
| --- | --- |
| Tree directly over the complete design area, meaningful hierarchy, no feature sequence numbers, distinct parent context/child selection | The current tree has real part/Reference/Parameters/Model branches and retains history position only as data. `is-context` differs from selected rows. The overlay is absolute, transparent outside controls and has no reserved column. Actual laptop/canvas proofs are in the checklist's restored-layout checkpoint; the long-label initial-Fit defect has a separate actual before/after record. Manual branch changes do not refit. |
| Stable compact configuration and contextual commands | Latest bottom-right configuration and bottom contextual dock supersede older left-panel requests. CSS anchors the floating inspector without resizing the modeling area. The View drawer keeps controls mounted, makes closed contents inert and dismisses its portaled help. Actual keyboard close/reopen and unchanged camera/draft proofs are recorded. No obsolete sidebar or history strip is rendered. |
| Finish sketch in the active editing panel | The active inspector header contains the guarded accessible checkmark, including its minimized header. Existing finish tests preserve source/history. |
| Free shapes without invented dimensions, native annotations and precise relations | Explicit size/angle intent drives annotation creation; free analytic geometry uses dimension/move/contextual fillet actions. Circle diameter and rotated-slot leader proofs are retained. Exact expression/raw value editors and unlink intent have independent regressions. The supported tiny-value display gap below is real; it does not corrupt geometry. General constraint solving remains a disclosed capability boundary, not a newly discovered regression. |
| Contextual grouped Fillet/Chamfer | Model commands share the group. Sketch context offers only supported rectangle filleting, rounding its four corners and preserving the corner scalar/relations; unsupported generic sketch chamfer is not offered. Actual edge resolution is version/build guarded. The face-selection scope gap below concerns a fallback within this existing command, rather than adding a new operation. |
| Direct principal/datum planes, source profiles and closed areas | Sketch creation requires a selected principal or supported datum frame. Owned eligible source overlays work through opaque targets. Actual Pocket annulus/centre selection, default whole-sketch parity, candidate-only state, Apply/Cancel and one exact Undo are documented in the current browser checkpoint. Adjacent selected cells cancel shared boundaries in the existing native path. Face-based sketch attachment is disclosed separately and is not claimed here. |
| Optional direct depth and clean human/agent separation | Display settings are opt-in. Actual linked physical drag/Cancel/Apply/one Undo and exact alias/native volumes are retained. Compound drivers are locked rather than silently replaced. The agent reads explicit cells, quantities, exact source, pins and bounded pages through shared operations; the human sees compact Areas/quantity controls. |
| Standalone DXF | File > Export DXF opens a separate source selector for sketch, reference curve or reviewed section with body/plane/height. Exact native sections are recomputed at the guarded download boundary. The export is not embedded in the sketch editor. Broader projection capability is not implied. |
| Errors as toast plus notification history | Completed current-build/operation diagnostics use the app status operation; dismissed toasts retain notification entries. Current actual failed-fillet/cut proofs include retained preceding material and blocked invalid exports. The old 10,000-element policy is superseded by the later capacity work; its historical diagnostic record is not a current limit. |
| Clear CAD settings, horizontal subsections, trackpad navigation | App settings have a real CAD section; Navigation/Display tabs have keyboard focus semantics. Mouse/Trackpad, on-part dimensions and optional depth handles retain device preferences, with truthful session-only feedback when persistence fails. Actual 2D/3D pan/pinch/orbit proofs are recorded. |
| Accurate gear roots, correlated plugin inputs/groups and informative help | Pinned V3 distinguishes automatic/custom generating-tool radius, recalculated bounds/shift, accuracy and derived values. Tool-tip radius produces a rack-generated transition with changing curvature, not a constant-radius finished-gear fillet. Info/help diagrams use actual resolved geometry, including far-position local-coordinate proofs; the cutter guide distinguishes opposing numbering and does not certify an individual form cutter. Plugin groups/provenance and parameter usage inspection are real, guarded operations. |
| Reliable agent use | Complete schema discovery, atomic edit/build distinctions, guarded workflows, exact source chunks and versioned/paged reference/region inspection are documented and independently tested. The actual discovered region journey passed on the retained checkpoint. This review does not substitute those prior proofs for the currently running complete CI. |

## Two actionable findings

### Explicit face selection silently broadens to the entire body's edges

Trigger: select a real face on an accepted Pad, then choose bottom-dock Fillet or Chamfer. `selectTopology` captures the version/build-pinned face and selects its body (`CadWorkbench.tsx:497–500`). `startFeature` invokes the selection resolver only when the first pick is an **edge** (`:408`); a face therefore falls through to `featureDraft`, which creates an unscoped all-body edge treatment (`:118–119`). The resulting editor says Scope = All edges of the body. The existing native resolver explicitly rejects faces for these purposes (`cadKernelTopology.ts:231–233`), and the face context menu correctly offers Shell rather than face filleting (`CadWorkbench.tsx:474–475`). The bottom command is inconsistent with that explicit selection intent.

An ignored mounted real Workbench/Session/public-viewport-controls regression selects the exact accepted face and starts Fillet. It confirms the source is unchanged and resolver unused, then fails **expected scope not `all`, received `all`**. GPU rendering is stubbed; this establishes the UI state/routing defect, not a new physical-pixel claim. The same condition governs Chamfer. Parent can exercise the already proven plate face pick followed by the group command for physical confirmation.

Smallest existing-operation repair: when an explicit topology selection exists, do not fall back to a whole-body treatment merely because its kind is unsupported. Refuse a face with concise edge/body guidance, keeping the accepted selection/history and opening no candidate. Keep intentional body selection/no-topology all-edge operation and supported edge resolution intact. Do not add face-to-edge expansion or native geometry functionality in this repair. Meaningful tracked reds should cover both commands, unchanged source/history/no preview on refusal, supported edge routing, explicit clear-to-whole-body and existing Shell-from-face behavior.

### Accepted nonzero sketch dimensions display as zero

Trigger: an accepted rectangle has named `size = 4e-7`, exact width expression ` size `, height20 and an explicit width dimension. `parseCadDocument` and `CadSession` accept it: supported analytic widths must exceed `1e-7` (`cadSketchGeometry.ts:290–293`). The annotation formatter (`CadSketchDimensionControls.tsx:55,113,117`) and constraint-list formatter (`CadSketchProfilePanel.tsx:124`) round to six decimals and convert back to a number. Both actual mounted controls display **0 mm** despite the real nonzero width. The original document/history and alias remain exact; opening the editor already exposes the full quantity, so this is a presentation defect, not a scalar mutation.

The ignored real-component regressions fail **expected `4e-7`, received `0`** in both locations. This is the same supported-value class already repaired for the depth label, and not an unsupported sub-tolerance fixture.

Smallest repair: use the existing six-decimal display behavior for ordinary values and compact scientific fallback only when rounding would erase a nonzero quantity. A small display-only helper can share this established policy across these two controls and the depth label; keep all editable source text, evaluated values, aliases, preview keys and acceptance math unchanged. Meaningful tests should use accepted literal and named dimensions (including diameter scaling and signed tiny angle), unchanged normal labels and exact no-op/Cancel source/history; no test tolerance or numerical policy changes.

## Reproduction and source snapshot

Ignored three-case probe: `tmp/cad-final-spec-candidates.test.tsx`, config `tmp/cad-final-spec-candidates.vitest.config.ts`; Node24.22.0 run log `tmp/cad-final-spec-candidates-red.log`. All **3/3 desired invariants fail** on the frozen source; test work247ms, total4.66s. These new reds are not counted as a green unit gate. No expensive suite, application build or browser was run.

| Source/proof | SHA-256 |
| --- | --- |
| `CadWorkbench.tsx` | `BC8AC2B500EE53C02C9D88416CED0F98B29845B25E59D4254F27B4456C24FBEA` |
| `cadKernelTopology.ts` | `8537E8187BDCAD79F8F03B510C2374E0DEBD8F006BD6F389DBAC73C77AFA3A2B` |
| `CadSketchDimensionControls.tsx` | `B47F59FD18AAAE1B70A0CC6E8CEE61E20091D5E5A5FE9D0ABB25FA1948C1B25B` |
| `CadSketchProfilePanel.tsx` | `F990470131D1DA6B09164832098E6224C36D36D7165A9DFEDB39D7CAFFB8B6FB` |
| `CadFeatureTree.tsx` | `226EDDC46C12CA5E7444294541C42C94ADC1F82854850A1044817772922843E9` |
| `CadCommandDock.tsx` | `E16B3DA10032756EB795866C404A95CE65965F0E33F77B166BAE26757EA81C53` |
| `cad-workbench.css` | `0152274283AD34874D89BA9E94D0F338A1BB5339312C64FF31F1877C45B4C6FB` |
| `CadPluginFields.tsx` | `19A80B3A61E9C9BD6065BEF3EC543E102816AC0356E96CCC21C50656EB7DE1C9` |
| `CadGearHelp.tsx` | `4B465F4E50013C38AD06BD77DB833CB32CD619287C5387DA039FFA905E92E0BB` |
| `CadDxfExportDialog.tsx` | `EED972B6EFFB44F32CF058A048F6005572A2B10F38588F32E6E56CEEC5C8DD98` |
| `CadParametersPanel.tsx` | `7919DB04F9E541D927FBA62DC0B050BD04B56642568061B96D2E53BF3BD4B723` |
| `CadSettingsPanel.tsx` | `907C2286CFE525DD5EB6B1756E8914AF9847750AF08418C4F6C2B1E41AF402B5` |
| Current region/depth browser checkpoint record | `2F70246AAF52F2E786ACB9DB886885F6BB4249DC7500F1F12EC9DAE1C390FF7E` |
| Ignored probe | `FA57C2BF2C04C22118D87AC6C413C9B1E098A1B9831A4CA98B7C23F4923AE097` |
| Ignored red log | `C1E7FE08D1620D8655785721928B532DA5636D6F66D29E73CC155EC3B31732F0` |

File/line references are a checkpoint snapshot. No additional actionable gap was established in the bounded scope. The two findings remain proposed repairs, and the larger existing-feature goal remains active; neither current CI approval nor universal CAD parity is claimed.
