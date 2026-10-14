# Independent kernel/helper/Shell E2E review

Base checkpoint: `8375c294d09e0a43b48b7c37d977cc59fd9a4065`. Reviewed the other owners' frozen `e2e/cad-kernel.spec.ts`, `e2e/cad-tool-helpers.ts`, and the single Shell locator repair in `e2e/cad-workflow.spec.ts`, plus `docs/reviews/2026-10-14-cad-kernel-e2e-current-ui-review.md`. No product or test changes were made by this reviewer.

## Findings

No actionable defect was found in the scoped repair.

The original kernel cases failed at removed `.cad-statusbar`/`.cad-diagnostics` elements rather than native geometry checks. Current tests replace those observations with version-pinned production registrations and actual UI status/notification behavior. The helper's registration bridge exercises the supplied public `execute` handlers, maintains abort-based cleanup, checks successful result shape, and preserves existing workflow/state guards; it introduces no controller bypass or product hook.

The manual import helper obtains the real browser file chooser through File → Import file. It records the previous accepted identity and requires an accepted `cad_` identity different from both the previous document and supplied source ID, complete feature count/name, and closed/idle workflow before returning the current accepted version. This agrees with `acceptImportedDocument`, which validates current version/storage/cancellation/replacement eligibility, parses the transport, then validates its fresh-identity replacement before acceptance. Waiting for the source ID would be incorrect; the fixed helper does not weaken that identity distinction.

The success case independently defines two offset 20 × 10 × 5 boxes and a Boolean Cut. It checks the sole final named body, 500 mm³ volume, one native solid, and exact [0,0,0] → [10,10,5] bounds. Visible selected-body properties must agree. WASM loading is checked absent in the blank document, once after import/build, and still once after both exports. Download names and actual STEP envelope/BRep/body identity remain checked. The binary STL is checked for its header, positive count, exact count/stride byte length, and independent signed-tetrahedron volume; no native quantity is reused in that calculation.

The failure case remains an impossible 100 mm fillet. Its build must retain one preceding 1,000 mm³ stock solid and report the stopped feature. Current version/build/error state is pinned. The complete actual toast text, after dismissal, must appear unchanged in the notification history. Diagnostic title, feature-attention status and selected retained-body volume remain checked, and both STEP/STL controls must be disabled. Page-error checks remain in both cases.

The Shell change uses the exact textbox role/name `Wall thickness mm` and verifies its default numeric value `1`. CI proved that the former broad label matched the help button, relation button and textbox. The genuine face pick, native Apply, single header, and 424 mm³ build assertion are unchanged. No skip, timeout, modeling policy, scalar relation, or UI implementation was changed.

## Independent actual-artifact check

Read root's `C:/Users/cristian/code/Wire_EDM/tmp/cad-node24-kernel-browser-report.json` and inspected its three actual CUA screenshots. Their production observations are separate from the new Playwright suite's execution gate.

The actual report pins accepted/build versions, records Cut volume `499.9999999999999`, retained stock volume `999.9999999999998`, and Shell volume `423.9999999999999`, all with one native solid. The failure record contains both the real OpenCascade cause and complete stopped-preview context. Screenshots show the named final Cut with 500 mm³ properties, failed tree item/status/toast plus retained 1,000 mm³ stock, and the genuine Shell candidate with numeric 1 mm wall thickness. Root reports its original main view preserved; this reviewer did not operate the browser.

Independently read root's actual downloaded STEP/STL, checked each hash against that report, and recomputed STL volume with a separate local facet loop. Results in `tmp/cad-kernel-export-independent-check.json`:

- STEP: 15,830 bytes; complete ISO opening/closing envelope, manifold BRep and exact `Cut_result` name; SHA-256 `6E0816FD9F19775E2E3298B22C11BA73619B522D5A1A72906812FD71F09ACEDB`.
- STL: 12 facets, 684 bytes = 84 + 50 × 12; expected binary header; independent volume `499.99999999999994` mm³; SHA-256 `C7033C3CFA221882389DCA9AAE36FC6F3E027DB3E9AADA600D02FD13A8353AFD`.

These actual artifacts establish correct exported geometry. They do not independently establish the new tests' single-WASM request count or every Playwright locator; those remain explicit assertions in the forthcoming full run.

## Verification

Using Node 24.22.0:

- Strict E2E typing of the kernel/helper/current workflow spec passed (`tmp/cad-kernel-shell-independent-tsc.log`).
- Playwright discovery found exactly the two kernel cases plus Shell (`tmp/cad-kernel-shell-independent-discovery.log`). No server or browser was started.
- Eight current notification/toast cases passed across two files, including real app notification retention after dismissal (`tmp/cad-kernel-shell-independent-notifications.log`).
- `git diff --check` passed.

This reviewer did not execute a new native build or the full browser suite. Root owns the combined actual run. The broader CAD goal remains active, including the separately owned far-coordinate SVG issue.

## Frozen source and evidence hashes

| Source/evidence | SHA-256 |
| --- | --- |
| `e2e/cad-kernel.spec.ts` | `7DA6190D99D1FB14D03FDE0D3FBACDF12A0A893552AEBEE043C066A1E30CE6F7` |
| `e2e/cad-tool-helpers.ts` | `228165807ED0D5EDB06A075E9277C29C7270C5710D7DF5AD862D6F025006B618` |
| Exact Shell test region (through next top-level test, UTF-8 original line endings) | `C3E0144532E508672BC646FE30134BC8118DE1365DA779F6F908863C89D7B32D` |
| Root browser report | `7A9FADBF49E9A107A28A0C710803D487468512492E56ADBEB749F6B585990D43` |
| Root Cut screenshot | `4EC83EA0F818356A630A68E966EAA58F21384F6D1CD0887E7AB7BDC58DCCA4FC` |
| Root failure screenshot | `1EC28CAE6F86DEF2CBCCEB397CC64C305C8DE0063C19C3608C93910D59A57FB9` |
| Root Shell screenshot | `BF4EED0CA750D1BF4ED1525588624DCAECF80EF8D984CF9627B60EB446A76B74` |
