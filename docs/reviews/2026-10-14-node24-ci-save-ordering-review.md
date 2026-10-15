# Node 24 CI and editor Save ordering review

Date: 2026-10-14. Diff baseline: `c36aa3b50a30f82ded3508652d9e7917c69b6b59`. Scope: `.github/workflows/pull-request.yml`, `.github/workflows/pages.yml`, `.node-version`, root package/lock metadata and the Simulation-to-Editor Save regression in `src/__tests__/appV2Workflows.test.tsx`. This is an independent read-only source review plus two focused executions; no production, workflow or test changes were made by this reviewer. Separate CAD work was active in the working tree.

## Result

No actionable finding in this slice. The test change observes real asynchronous operations and preserves its durable storage assertions. The runtime configuration is internally consistent; workflow event triggers, permission boundaries and release/deployment dependencies retain their previous behavior. This review does not certify a future GitHub run or the complete app under every permitted Node version.

## Actual async ordering and adapters

The added `vi.fn` delegates are the actual `createDxfImportServices(directDxfProcessor).commitDxfProjectImport`, `loadEditorProgram` and `saveEditorProgram` functions. The test helper already supplies this direct processor to app interaction tests; the change observes that same service seam. It does not substitute import data, bypass persistence, resolve a fake success receipt or introduce a separate storage implementation. Worker lifecycle remains outside this focused Save journey.

`useWorkbenchAppController.handleConfirmDxfImport` first awaits the durable import commit, updates the connected workbench and calls the real load operation. It then awaits load before `openEditorProgram`. The test awaits these exact observed promises inside `act`, checks each domain result, and requires the actual `path-project` editor context before opening Geometry. The controller's continuation was registered when the operation started, before the test observes its result promise. Waiting on the commit/load therefore follows actual completion and React publication rather than relying on the helper's two fixed microtask flushes to finish streamed storage I/O.

The journey still enters through the real file input and import-review UI, explicitly selects millimeters, edits translation through Geometry, applies it and verifies the draft is Unsaved. Header Save from Simulation must return to Editor, invoke one save and eventually publish Saved after the durable operation. Both adapter variants still inspect the persisted manifest/project, require X=3 in both stored geometry and the returned editor-program receipt, compare the returned project with stored data, require the exact original DXF source bytes and require the transaction journal to be absent.

The folder variant connects the actual folder adapter backed by its established fake directory handle. The cache variant reads through a separately constructed real cache adapter sharing the app's localStorage backend; it does not inspect the save mock's input as a substitute for disk/cache results. Existing save conflict and before-write guards remain in the domain/controller and are not changed or disabled. No assertion, test timeout or fixed delay was relaxed.

Independently executed with the installed Node **v24.22.0** binary:

`node.exe node_modules/vitest/vitest.mjs run src/__tests__/appV2Workflows.test.tsx -t 'saves the actual dirty draft'`

Both relevant cases passed: **2 tests**, with the other 5 cases skipped by the explicit filter. The test portion took 5.15 seconds, while environment/import/transform setup accounted for most of the 65.09-second process run. This was a correctness check, not a controlled runtime-performance comparison or full suite gate.

## CI, Node and release metadata

The PR workflow continues to run on main-targeting `pull_request` and `merge_group` with `contents: read`. Its install, release/docs validation, tests, conformance, build and Playwright sequence remains intact; failed-browser reports still upload with the same artifact name, paths and seven-day retention. No trusted `pull_request_target` execution or added secret/write permission appears.

Pages still runs on main pushes and manual dispatch, with its build restricted to main. Global Pages/OIDC permission settings, `pages` concurrency group and `cancel-in-progress: false` are unchanged. The existing tag job still depends on build, has its explicit `contents: write` permission and checks an existing version tag resolves to exactly `$GITHUB_SHA` before accepting it. Its new Node setup reads the same version file and disables package-manager caching because this job only reads the package version. Deploy still depends on both build and tag and uses the same `github-pages` environment and deployment output.

All jobs now explicitly select `ubuntu-24.04`. `.node-version` contains `24`; setup-node consumes it with `check-latest: true`, so CI selects the current available Node 24 patch/minor rather than an unrelated major. The package and lock root both contain identical engines, `^24.0.0 || >=26.0.0`. Root package version, lock version and lock-root package version all remain `0.0.697`; this metadata-only diff does not alter dependency versions or integrity records. The range excludes Node 20/22/25 intentionally and CI exercises Node 24, without claiming this focused test independently proves every future engine allowed by the range.

Primary-source checks confirmed the selected action majors exist and use Node 24: [checkout v7](https://raw.githubusercontent.com/actions/checkout/v7/action.yml), [setup-node v7](https://raw.githubusercontent.com/actions/setup-node/v7/action.yml), [upload-artifact v7](https://raw.githubusercontent.com/actions/upload-artifact/v7/action.yml), [configure-pages v6](https://raw.githubusercontent.com/actions/configure-pages/v6/action.yml) and [deploy-pages v5](https://raw.githubusercontent.com/actions/deploy-pages/v5/action.yml). [upload-pages-artifact v5](https://raw.githubusercontent.com/actions/upload-pages-artifact/v5/action.yml) is composite and uses the pinned upload-artifact v7 action, retaining the `github-pages` artifact-name contract. The official latest release pages resolved to checkout v7.0.1, setup-node v7.1.0 and upload-artifact v7.0.2 during this review.

[Node's distribution index](https://nodejs.org/dist/index.json) lists v24.22.0 on 2026-10-14 with LTS designation Krypton. The local binary reported v24.22.0. The downloaded ZIP SHA-256 was independently checked against the matching line from the [official release checksums](https://nodejs.org/dist/v24.22.0/SHASUMS256.txt): `f9683a19877e12a9b167305c8db71040d812876359de21f0d2e97c3f321f80c3`. No archive or dependency installation was changed by this review. The web reader could not render the checksum text; a read-only HTTPS request fetched that official text for comparison.

## Source snapshot

The scoped diff whitespace check passed. Hashes were rechecked after the focused execution and remained unchanged:

| File | SHA-256 |
| --- | --- |
| `.github/workflows/pull-request.yml` | `2900DC09ED807488CE50450F4829DF480A692F6631958C53582CFA0368974BAE` |
| `.github/workflows/pages.yml` | `550DCA473CA07B5EA13BC82AD8976AA673CB5C0E980CC3C96B432EBD7D9CAC67` |
| `.node-version` | `68CA3FBA3B7E864770CB61AEB306D4BD4354B68AB4DD38450860C5D823E42A53` |
| `package.json` | `32DAE7FC8270F500C12782AF797215A45D3B47760BDFC593D7960369CBBBC9C0` |
| `package-lock.json` | `F0CD509E586D4FEA391E5717FAAF6CFBF6AC6228840001681D0124A9CD1866EF` |
| `src/__tests__/appV2Workflows.test.tsx` | `C98B234CA441C913645A674ED369A14FAE80F12E41DD80961F826390E249A655` |
| `src/app/useWorkbenchAppController.ts` | `18DECEF8EB90986A7D8242923680AF2BBA8133E2C66ABEF1964B5B2C16B10DC7` |
| `src/__tests__/appTestHelpers.tsx` | `74E95FD12C7959855E80BE0D52A02746547A5BE5853A773B607C0428F41F9868` |
