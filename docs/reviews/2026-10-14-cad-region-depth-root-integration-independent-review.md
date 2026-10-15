# Independent region/depth integration review

2026-10-14; base `fba236e004fb863e29d81bfc029be36b001397ac`, dirty shared working tree. This bounded review covers the parent's fields, picker command, Workbench and setting integration, plus the editor contract they use. It excludes the reviewer's own Viewport/area renderer and Explicit's emerging depth renderer. Hashes below identify the read/test snapshot, not a claim that concurrent sources have stopped changing.

## Findings and ownership

Research independently reproduced a Workbench ownership defect: a new accepted native `buildId` cancels a `pick-regions` command with the same accepted document/version/prepared cells. Source reading confirms the common build-ID guard also governs this analytic mode. Research supplied the meaningful red harness and the parent owns the narrow correction; this review neither duplicates that patch nor counts the candidate as independently fixed. Ordinary reference/topology modes still require their original render guards.

No further actionable integration defect was established. The region field prepares the complete current source and only its preceding datum, avoiding an unrelated invalid datum. Undefined selection means legacy whole-sketch material; explicit empty selection remains an invalid provisional draft. A real source-ID change explicitly resets area selection; unavailable stored sources are not silently substituted.

Editor callbacks retain token, accepted-document identity and version ownership. Late select/finish/cancel cannot affect a replacement document or a newer picker. Done keeps area selection provisional; Cancel restores the pre-picker feature and preserves earlier shared parameter drafts. Current readiness, scalar validity and picker completion all gate Apply. The actual session test accepts area selection plus a named quantity in one batch and restores the exact prior document with one Undo.

Depth publication is qualified by the captured accepted document/version/feature, the optional setting and current dialog/source/region workflow. The editor control retains an immutable pre-gesture provisional snapshot; no renderer call directly edits accepted history. Exact aliases, formula locks, source-placement coupling locks and high-precision literal no-ops remain meaningful. Settings retain existing navigation/dimension choices, remain opt-in for old preferences and report a session-only save truthfully when device storage fails.

The next renderer integration must preserve a valid depth gesture when its own pending flag or unrelated candidate meshes are published, block Orbit/wheel while that gesture owns the pointer, and consume gesture Escape before the whole-feature Escape handler. Those are pending renderer work, outside this independent integration conclusion.

## Verification

Node **24.22.0**, focused full files: `CadExtrudeFields`, `CadWorkbench`, `CadFeatureRegionPickEditor`, `CadExtrudeDepthEditor`, `CadSettingsPanel`, `cadPreferences`, `cadDepthPreferences`: **107/107 passed across seven files**. Log: `tmp/cad-region-depth-root-independent.log` (10.91 s).

No tests, product files, browser, server, build or commits were changed by this review. Combined TypeScript is deferred until Explicit's deliberately red depth-helper file settles; the prior reported missing-helper error is not hidden or patched here. Parent owns the fresh combined native/browser gate and the Workbench finding.

## SHA-256 snapshot

| File | Hash |
| --- | --- |
| `src/features/cad/CadSketchRegionsField.tsx` | `EE8CBF92F43780154112E42D1E6D27A3D7FDFEAABFE07D5AED6BA1CA4390D767` |
| `src/features/cad/CadExtrudeFields.tsx` | `00CDBA1F91AA91A4DD2FD54D59D70B2F5F389C6475AE968A69A37F74E0FBDD2A` |
| `src/features/cad/CadExtrudeFields.test.tsx` | `11938C9BEBDA37E278D641125B6FBE08E39B24F6F6BF9EB0740D6CC78A33F62E` |
| `src/features/cad/cadFeatureReferencePicking.ts` | `0D12053A183AD074D87DAF8595728F18A44F69C2B52887D97E97DC5FF298FE4B` |
| `src/features/cad/CadWorkbench.tsx` | `D57D792A41DB70D85B1C79AB0EE36E749F817BCAD202400A62BA81A4C1C59EDC` |
| `src/features/cad/CadWorkbench.test.tsx` | `4C0DE97140A1DFBBA1C3C97A2EDE9CBB63112AD0BA2C8DE04A5D31C80002CBAC` |
| `src/app/CadSettingsPanel.tsx` | `907C2286CFE525DD5EB6B1756E8914AF9847750AF08418C4F6C2B1E41AF402B5` |
| `src/app/CadSettingsPanel.test.tsx` | `71EB6741B85DD662809B71AE1E4F57EEBAC0DBBDE381E7C9A18F5D224435160F` |
| `src/features/cad/CadFeatureEditor.tsx` | `A041DB36475A1D77422147564D8165F8E4E2ADF32A619D2AE2CB2D14C7872E42` |
| `src/features/cad/CadFeatureRegionPickEditor.test.tsx` | `6E4EFDC7D60289522F5D3FDBFCBFCC61DD413510C980B765C0B9F916D007C789` |
| `src/features/cad/CadExtrudeDepthEditor.test.tsx` | `1B34043960B7E86305398031D8D8A911FB72DEE47A954CC1B50749169D630FE5` |
| `src/features/cad/cadPreferences.ts` | `2CEEC42933BCC0FABC5224F16E752A51599FBF3D9926F482E71C7D9FD6461036` |
| `src/features/cad/cadDepthPreferences.test.tsx` | `9C0394AFC2E4CBB7AD5A5057E6BD9D4FB8C7EFD9FF9DCF631D445F6A986C079B` |
