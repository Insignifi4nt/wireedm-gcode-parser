# Independent review: explicit tangent-chain workflow

2026-10-15; bounded product review against `3f70f4dc32374b44351942ce88289d7c3ce55874`. **Review complete and clean after the same-owner boolean-slot correction below.** This closes the review of this concrete workflow repair; root owns fresh built UI/native proof and release integration. The parked native Copy experiment was not reopened. No production/test, build/server/browser, install or commit changes were made by this reviewer.

## Shared behavior and compatibility

The strict shared feature schema accepts optional boolean `tangentPropagation` only for Fillet/Chamfer. Current parsing preserves absent/false/true exactly without synthesizing defaults or rewriting old files. Shared feature edits and tool discovery reuse that schema. This is additive support in the current reader; older strict readers can reject documents containing the new field, including explicit false. Root's release compatibility warning states that limitation and preserves saved originals, installed posts and CAM contracts.

Absent/false retains the original selected-edge policy. Only literal true bypasses the existing native contour-completeness refusal; native Add/Build still computes its existing tangent contours. Exact seed queries, individual and union expected counts, supported seed geometry, body availability and current-build selection checks run unchanged first. Expected counts continue to describe picked seeds, not the expanded contour. There is no authored tangent solver, approximation, native-package change or new handler. The all-body branch ignores the flag and retains its previous behavior; deliberately choosing that scope in the editor clears selected-chain intent. Unsupported face selection is not broadened.

The helper keeps existing builder/result/temporary cleanup. Selected Edge wrappers remain borrowed from model-owned topology; no new edge owner is introduced. The model still validates and meshes an operation before replacing its target. Wrong counts and native failures retain the preceding valid body. Real native cases exercise one74mm outer straight seed and one bore semicircle for both operations, compare explicit complete-rim controls, retain exact unrelated/bottom rim descriptors, and independently check bore-Chamfer removed material. The original strict tangent-negative fixture is unchanged and passes.

The selected-scope checkbox is explicit and unchecked for new absent intent. Its label distinguishes picked seeds plus tangent chains. Full candidate identity includes the flag, so an older strict ready preview, another owner or a replaced document version cannot authorize it. Radius aliases and selectors remain unchanged; Cancel restores exact document/version/history, Apply is one shared feature edit, and one Undo/Redo restores complete definitions.

## Reproduced no-op defect and narrow correction

Initial frozen sources passed their78-case gate but missed valid JSON property-order cases. An accepted false flag preceding selection, toggled on/off, was removed then appended; JSON-based draft identity stayed changed. The symmetric accepted-true off/on sequence had the same problem. Two ignored independent fixtures reproduce these failures without changing owner tests or assertions:

- `tmp/cad-tangent-property-order-independent.test.tsx`, SHA`5A1EF29924D87FC340A0374C670668254AC8F96B6A8C8576F2A07E3AB58D83E4`; original red log`5821BC5CCAE8F952438381CD92031CB039DD6345483FC0F3C68DB5DA08DD3170`.
- `tmp/cad-tangent-true-property-order-independent.test.tsx`, SHA`07FFF9AAACD29288B3B10517C34610D7FB5CCF8B9DCA612D463FDE7D4FCF50C9`; original red log`336B62389833FD00EA7C581EC93860C928FDF3A089E8BEF07CABD7E21BA820D3`.

The same owner promoted absent/false-before/false-after/true-before/true-after cases and corrected only the off-handler's accepted-boolean condition/draft spread. An already authored boolean slot is overwritten in place; a flag introduced from absence is removed. This preserves field order and other provisional edits, without changing global equality, domain/native policy or preview ownership. All-body clearing remains an intentional change. Both ignored originals and their failure logs remain untouched; unchanged reruns now pass2/2 and1/1 respectively (other cases unselected by test-name filters, no code skips added).

## Independent verification and source identity

Node24.22.0:

- Initial complete affected gate **78/78 across five files**,24.03s: domain Topology, real kernel Topology/Model, TangentPropagationEditor and FeaturePreviewEditor; `tmp/cad-tangent-propagation-independent-focused.log`. Initial app TypeScript exits0.
- After the boolean-slot repair, complete affected UI/domain suites **42/42 across three files**,2.57s; `tmp/cad-tangent-property-slot-independent-focused.log`, SHA`E52E842E7171C4F3E89DFCD3A93494D150C6968FB4EF754A50574B3D2A8C78BA`. The six other domain/native source/test paths match the initial freeze exactly; the independently passed39 native cases need no repeat. This gives81 distinct current affected cases, not a sum of overlapping runs.
- Original ignored property-order probes rerun unchanged, logs `tmp/cad-tangent-property-order-independent-green.log` and `tmp/cad-tangent-true-property-order-independent-green.log`. Final app TypeScript exits0 with empty `tmp/cad-tangent-property-slot-independent-type.log`; scoped whitespace check passes.

Final owner freeze `tmp/cad-tangent-propagation-property-slot-source-freeze.json` SHA`8247CFEA1EB8024BEA1A2F31E6F5377ECC2662C572F5F15D78E0F36516F5C24A`: all16 current source/evidence and41 protected entries match. The original78-case manifest remains historical at SHA`7B9AD85D5895E309EF0F0C3C03A6B61CEEB3F3D1B8D596FB22C42A3AB4DD72DD`; intermediate false-only evidence is also retained. Current owner record SHA`FC00B45C18A5AADED438687B7A6BD1C6762BB0789B481DBCD3B74934A950826D`.

| Production file | Reviewed final SHA-256 |
| --- | --- |
| `src/domain/cad/cadDocument.ts` | `6A594CE10C337E6831478CCC15F95E1F0368393BBEDBC3260B15B67AAF598FD7` |
| `src/domain/cad/cadSchema.ts` | `A500F4F2CCBB99089C397E4F1F0168EB529713CB8E1823626A3ECA6059FF9FBA` |
| `src/features/cad/kernel/cadKernelOperations.ts` | `B60656A5A2AFB85D38FBEBCC0A6BA73ECB8F2303BD5ACFC2F1126675B8273972` |
| `src/features/cad/kernel/cadKernelModel.ts` | `B087A98255DD3283FA1DDF2E3C5EF36CA842FA79C6B10874FC0AAD447FE30F92` |
| `src/features/cad/CadFeatureEditor.tsx` | `EC7BD73FCDEBECAAF393B0F7E942C051676D01F874EA2402678F0F1D53B6FF55` |

Root's separate two-string `cadSiteTools.ts` integration, SHA`14F7100CBCF791B95FE58D90EEBA7DA37153577499571B8508F4D8F15BBDCAFA`, accurately states selected-seed true versus absent/false semantics without changing handlers or budgets. Hosted CAD/agent guides explain opt-in continuation, seed-count/stale guards, dormant all-body behavior and older-reader compatibility. Root reports the existing discovery/site/agent journey25-case gate green; it was not needlessly repeated here. Fresh built end-to-end proof is not inferred from these source/DOM/native checks, and remains root-owned.

## Separate copy-only follow-up after published ab1944a

Bounded four-file diff review against `ab1944a25f5897b5a0ec2943be7fc4adcd5c724e` is clean. The new default `Extrude n` is assigned only by the new-feature factory, with the existing ID/sequence logic; accepted and user-authored names are never rewritten. It stays neutral when the new extrusion's operation becomes new/join/cut. Compact `1 edge + tangents` / plural wording changes only the selected option label, and selector summaries now pluralize edge/face counts correctly. Their values, seed counts, state transitions, API, geometry and preview/acceptance guards are unchanged. The existing tangent test updates only its intended label expectation. No new tests, broad gate, native work, build or server operation were performed by this reviewer for these reversible copy edits; root is running the existing relevant suites. Earlier repair evidence above remains historical and unchanged.
