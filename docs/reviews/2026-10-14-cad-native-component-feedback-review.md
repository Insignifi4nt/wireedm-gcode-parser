# Native component-count integration review

Reviewed against checkpoint 09795ec and the current unchanged seven production files below. The objective is accurate feedback for existing multi-solid bodies, with unchanged native material acceptance, saved definitions and resource limits.

The count comes from the final existing validation enumeration. Disposing its temporary solid wrappers does not change the array cardinality. Meshing receives that integer; no additional Boolean, topology query or geometry approximation is introduced. The worker boundary accepts missing legacy metadata and validates provided positive safe integers against the existing per-body topology bound. It does not confuse physical components with expanded work instances. Public body summaries expose null when unavailable.

The selected body appends a count only for multiple components. Preview count belongs to the exact current-ready candidate and to its terminal feature body; a consumed intermediate feature is not assigned another body's count. Pending, blocked and error states remain truthful and cannot authorize Apply. Join/Union guidance is in the existing contextual help.

Root's exact-source UI/API/preview/controller run passes 176 tests in 6 files. The full kernel-path run passes 31 files / 344 tests in 49.18 s; these suites overlap other evidence and are not summed. Production build, TypeScript, all 92 documentation/discovery/schema/link checks and pinned source distribution pass. Logs are tmp/cad-join-counts-ui-api-final.log, tmp/cad-join-counts-native-full.log and tmp/cad-join-counts-current-build.log.

Actual isolated production browser confirms one history body with two disjoint native solids and 8,064 mm³. Length 4→5 previews 8,080 mm³ with 2 solids, and Cancel preserves the accepted version and 8,064 mm³. A contained addition reports one solid / 8,000 mm³; face contact reports one solid / 8,064 mm³. Saved originals are unchanged; the temporary QA tab was closed without saving. Proof and exact JSON are in the primary workspace tmp/cad-join-counts-browser-report.json, cad-join-counts-qa-part.json, cad-joined-body-two-solids.png and cad-join-preview-two-solids.png.

No remaining actionable finding in this bounded count/feedback change. Export/save budget coherence remains a separate active hardening issue; this review does not complete the overall CAD goal.

| Production source | SHA-256 |
| --- | --- |
| src/domain/cad/cadDocument.ts | 42682674dd7b99780c0c9eb71def6af7fb6d26f998a6bc0caa84f7999308d5a5 |
| src/features/cad/kernel/cadKernelModel.ts | c7e8db348f2fc7eb739156870a97dbf3d181002e949c787e4a5a8a6f9c1c3aa7 |
| src/features/cad/kernel/cadKernelProtocol.ts | 71caf925d1573951e18745004370a2ea8414b2769658372fee4aec199df17fac |
| src/features/cad/cadSiteTools.ts | a3f63e30d0012c7a069165ef4135bff78d9c717f3b9178ecf216986ab44fa59d |
| src/features/cad/CadFeatureEditor.tsx | 0a73df8802349d323eb416d758d056d7e644c51f2beb72d3298e1c09cb818914 |
| src/features/cad/CadWorkbench.tsx | 46e057178f88287db326cfb790e55eb18782cb9f078980f5d177ef5ead17422a |
| src/features/cad/cadFieldHelp.ts | 86614fbc8b5a697cb4d98ef9e8646e7ac97efb746bddc5d021ada2f36ead80be |
