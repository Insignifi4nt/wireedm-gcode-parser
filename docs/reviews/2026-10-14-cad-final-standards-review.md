# CAD final standards review

Independent Standards-axis review of the working tree in `feature/parametric-cad-workbench`, against baseline `c16a15eb9f9805622ccaeda5b39dc2698ddfda8c`. HEAD is unchanged. Scope is `git -c core.autocrlf=false diff HEAD` plus complete untracked files, pinned by the 143-path `tmp/cad-hardening-final-source-manifest.json` captured at 2026-10-14T01:07:28.6988455Z. The original hash audit matched every path except the two coordinated review repairs below.

Standards sources were root `AGENTS.md`, the user-approved hardening checklist, storage/migration guidance and current native ownership records. No additional applicable CONTRIBUTING or coding-standards file was found. Fowler smells were treated as judgment calls, with repository rules taking precedence and tool-enforced matters excluded.

Review traced strict execution versus compact WebMCP discovery, controller/session workflow guards, version/cancellation checks, durable save destinations, isolated preview worker ownership/coalescing, reference picking, gesture/context integration, grouped parameters, immutable plugin packages and native shape cleanup. Public CAD/agent guidance and release compatibility were checked for hosted-app authoring and preserved records.

## Reproduced finding and repair

One actionable correctness issue violated `AGENTS.md`'s API-first, checked-operation and data-integrity requirements. `cadPluginStorage.ts` accepted an edited `wireedm.star-profile@1.0.0` package, then inventory silently substituted the bundled recipe. Changing its outer-radius default from 30 to 40 reproduced installation success with no conflict diagnostic. Built-in gear identities were already protected.

Four red cache/folder regressions established the false installation success and silent inventory conflict. `cadPluginStorage.ts:12` now centralizes the bundled identity check; installation calls it before writes at line 39 and inventory at line 68. Exact bundled packages remain valid and idempotent. Conflicting stored originals remain byte-exact and receive an actionable diagnostic. A new version installs and reads back the edited definition. No saved instances or package schemas change.

Verification: PluginStorage, Plugins and PluginsPanel passed 35 tests; the final recovery assertion rerun passed all 20 PluginStorage tests. `npx tsc -p tsconfig.app.json --noEmit` passed. Changed source paths are only `cadPluginStorage.ts` and `cadPluginStorage.test.ts`; the checklist was untouched.

No unresolved actionable Standards violation or Fowler heuristic remains from this review. The known pinned native destructor limitation remains explicitly documented; these checks do not prove universal native deallocation. Root owns refreshed source pinning, full suites, production build, public tool/browser journeys and final record preservation evidence. No PR, push, deployment or browser/saved-record mutation occurred here.

## Native package and corresponding-source follow-up

Scoped follow-up reviewed the modified dependency/lockfile, `distribute-cad-sources.ts`, old/new manifest variants, build record, four-file source patch, vendor package contents and rebuild recipe. The native implementation and calling ownership files remain owned by their implementation/review agents.

The distributor checks the installed ESM/WASM pair, all four local artifact hashes and ordered filenames before public writes. Build evidence must agree semantically with source/toolchain pins and the exact pair, package, patch and recipe descriptors. Original source-cache corruption fails without replacing its bytes. License/relink documentation stays separate from hosted CAD authoring instructions.

Independent read-only probes verified the vendor tarball's npm SHA-512 integrity, byte equality with every installed ESM/WASM/CJS/type artifact, unchanged five upstream archive descriptors and exact protected original ESM/WASM hashes. The installed CJS entry produced a 10 mm cube of 999.9999999999998 mm³, within native roundoff of the independently expected 1,000 mm³.

The manifest upgrade exposed two failing source-distribution tests: their baseline fixture inherited the modified descriptor without providing vendor artifacts. Coordinated repair at `cadSourceDistribution.test.ts:22` makes the old 1.1.0 fixture explicit; the modified fixture supplies its complete descriptor. Original modified-publication, corrupt-source and semantic-build-link regressions remain intact. Both source suites passed 17 cases, and the app TypeScript check passed.

Final distribution gate remains open. Recipe/build-record artifacts are still being refreshed after independent native fixtures; the observed stale recipe pin is correctly rejected before writes. Root must freeze and repin those artifacts, then rerun the actual distribution check. Mixed edit/export lifecycle reserve growth is still under separate diagnosis. The repaired default-gear plateau does not establish unlimited native deallocation or production readiness. No production script, package, native source or saved/browser record was changed by this follow-up.
