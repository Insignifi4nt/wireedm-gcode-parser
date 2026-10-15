# Independent review: bounded E2E capture recovery

Date: 2026-10-14. Reviewed the research owner's frozen helper, twelve contract cases and two capture call sites against `25b3994af33d3a7f011651a42603f8dd898af597`. No production, helper, test, browser, server, public documentation or release changes were made by this reviewer.

No actionable issue found. `captureCadPreview` starts with the ordinary public `cad_capture_preview` request at its caller's original `expectedVersion`. Only an object with exact `ok === false` and exact `error.code === 'STALE_VIEW'` enters recovery. Recovery calls guarded `cad_get_viewport` and one fresh `cad_capture_preview`, both with that same original version. The second capture goes through ordinary success validation, not recursively through the recovery helper. Every other rejection, thrown transport error, malformed reply, failed refresh and second stale response propagates. The helper never reads a new context version, mutates the CAD draft, performs Fit, sleeps, loops or catches errors by their message text.

Extracting the existing private result validator preserves generic `callCadTool` behavior. A successful capture's error-shaped data field cannot trigger recovery; `ok:false` and the exact code are required. Neither production capture validation nor artifact ownership was modified. Current controller/viewport source hashes match the owner's pre-repair record: document/version, workflow, current build, installed references, rendered control identity and complete visual metadata remain authoritative. The refreshed public viewport is a current guarded read, not an instruction to accept an earlier image or ignore renderer revision.

The only two workflow call sites changed are the observed first-solid and mixed-path captures. Both retain the original capture input version, actual decoded PNG inspection and pixel thresholds (opaque greater than 1,000; body greater than 100). They additionally check document ID, accepted draft version, CAD-draft content source, 3D renderer source and captured document/build version. Their native expectations remain `1200 * Math.PI` and `500 * Math.PI`, respectively. Mixed-path still checks exact radius/sweep/closure, area, unpublished invalid geometry, workflow guards and full Undo/Redo; first-solid still checks initial reference framing, substantial solid Fit and later camera zoom preservation.

I independently reversed precisely the new helper import, these two call replacements and their added metadata assertions in memory. The result equals the complete normalized HEAD spec plus only the separately reviewed imported-path End X/Start X textbox repair. Therefore no other action, geometry, source, history, native quantity, image inspection, timeout, retry or skip changed in this scope. Both research-owned region hashes match the frozen manifest.

The twelve new tests replace only the unavailable browser transport (`page.evaluate`) and exercise the actual helper/parser control flow. They cover single-call success; exact capture/read/capture order and pinned version; stale-document refresh refusal; second-stale propagation; five unrelated error codes without retry; transport exceptions; successful error-shaped data; and malformed rejection data. They do not claim native or browser success from mocked geometry.

Independent Node24.22.0 execution passed all 12 contract tests in the configured browser/jsdom project. A first command used the pure-domain project, which intentionally does not include this root test directory and found no files; selecting the registered project corrected the check without source changes. Strict E2E TypeScript passed. Discovery found exactly the two changed workflow titles. `git diff --check` passed. Logs: `tmp/cad-capture-client-independent-tests.log`, `tmp/cad-capture-client-independent-types.log`, `tmp/cad-capture-client-independent-discovery.log`.

| Reviewed file or region | SHA-256 |
| --- | --- |
| `e2e/cad-tool-helpers.ts` | `A8FA9A73A88DB3041E8CBDD12359E8D1ED5F52CEA67BB8717C44876958DE399F` |
| `src/__tests__/cadE2eCaptureClient.test.ts` | `8F8FE8508F916D6BF30C71E04D97FE37000F05DBAE23B2DB1DF193348B41F5AF` |
| First-solid workflow region | `460D5AA23F4484567941516B0D795A71D1AD53CE6124C78062A5587C766B25B5` |
| Mixed-path workflow region | `F56E02C50585094B5B0C258642D41FBD78E8BE9C758A5C8578F552B3E1760010` |
| Unchanged `useCadController.ts` | `0206ACA90CDE0820F5E5EAEE0B70EC4168083A368B278003AF7FB814D52101BB` |
| Unchanged `cadWorkbenchViewport.ts` | `C428FB0E6BEDEF00AD259C8063EF6E7EA2289A720B11FDA06BDC93337E36497C` |
| Unchanged `CadViewport.tsx` | `D3ABDE1B86BC928B88036C6A9FBC03E00C07379F6CDA791EF209684CEFBBF8AE` |

The original CI evidence establishes two real `STALE_VIEW` rejections followed by successful full-test retries, but does not identify the exact changing visual field. This repair follows the existing public error's bounded recovery instruction. It does not promise that two consecutive genuinely changing views will succeed. No local E2E browser execution occurred; actual end-to-end validation remains the coordinator's next GitHub gate. Frozen product/helper/test sources are untouched.
