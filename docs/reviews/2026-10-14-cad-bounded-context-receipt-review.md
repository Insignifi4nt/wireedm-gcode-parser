# CAD bounded context and committed receipts

Scoped repair on 2026-10-14 after portable parameter-count limits were removed. The existing public tool context embedded every parameter, so a valid 1,001-parameter draft could exceed the shared 32 KiB reply budget. The read-only probe returned `OUTPUT_TOO_LARGE`. Two red real-controller regressions reproduced both an unreadable context and an edit that committed its new value/version before returning that misleading error. The remaining 106 controller tests passed during the reproduction.

## Tool boundary contract

Only `cadSiteTools.ts` production code changes. The application, session, schemas, storage, scalar bindings and complete internal document are unchanged. One shared formatter returns exact whole entries up to the actual UTF-8 JSON budget for each metadata payload:

| Field | Meaning |
| --- | --- |
| `parameters` | Ordered prefix of complete stored name/value pairs, at most 4 KiB as serialized JSON. Includes every value when the complete map fits. |
| `parameterCount` | Total own stored parameters, including currently unused dimensions. |
| `omittedParameters` | Whether the context omits any complete parameter entry. |
| `omittedParameterCount` | Exact total minus returned entries. |
| `parameterGroups` | Ordered prefix of complete stored group ID/name rows, at most 4 KiB as serialized JSON. Includes every group when they fit. |
| `parameterGroupCount` | Total stored groups. |
| `omittedParameterGroups` | Existing flag, now reflects actual returned rows rather than a fixed ten-row cutoff. |
| `omittedParameterGroupCount` | Exact total minus returned group rows. |

No parameter name, value or group field is shortened. The formatter counts parameters with own-key iteration and avoids allocating all name/value pairs just to form a small reply. Group membership is stored separately in `parameterMetadata[name].groupId`; current strict group records contain only ID/name. Large groups therefore remain complete in storage and readback. The tests use eight long-ID/multibyte-name groups with up to 128 members each, and exercise group omission even though there are fewer than ten groups.

`cad_get_context`, `cad_open_workspace`, `cad_create_document`, `cad_import_document`, `cad_open_document`, `cad_edit_document` and both directions of `cad_history` all use this formatter. These mutation receipts preserve the current version, document identity, dirty/save/workflow state and history state without repeating an unbounded parameter map. The existing diagnostic summary remains bounded. `cad_save_document` and native import receipts never spread parameter context and keep their existing complete outcome fields.

Agents must check omission markers before treating context parameters/groups as complete. At the same version, `cad_inspect_parameters` exposes every exact parameter, membership and usage through bounded rows; `cad_read_document` exposes the complete document, group metadata and original sources through exact text chunks. The discovery description identifies both paths. This is a response-summary compatibility change, not a parameter-cap, schema migration, model edit or saved-file rewrite. The parent owns public guide and release wording.

## Verification

The real-controller tests read all 1,001 exact names/values and membership via pagination and reconstruct the entire document through text chunks. A numeric edit preserves its exact named radius binding, returns a successful receipt at the new version and immediately supports context readback. Retrying the old version rejects without changing the session; repeating the same value at the current version makes no additional history. One Undo restores the entire prior document and Redo restores the edited document.

The receipt tests also cover complete empty/small contexts, a large import receiving a fresh identity, exact browser-cache save receipts, workspace reopening and saved-document reopening with correct fingerprint and clean state. Stored quantities and metadata remain complete. Each metadata payload stays within its actual 4 KiB JSON budget, and context/mutation receipts stay below the 32 KiB gateway budget.

Current focused controller/tool/agent/pagination verification passed **134 tests in four suites**. `npx tsc -b --pretty false` and scoped diff check passed. Production source froze for independent review and the parent's current-source whole-app gate. No browser/server action, version change, commit or public documentation edit occurred in this slice.

Reviewed source SHA-256 identifiers:

| File | SHA-256 |
| --- | --- |
| `src/features/cad/cadSiteTools.ts` | `808b12701e0087f772fff5a8b4ac9e7a77867ede22bcb0cca2f1246558b02b81` |
| `src/features/cad/useCadController.test.tsx` | `d4011d45e20fc70e3ba014b855457f443c0a7f8805ca1a71eb52c77065148b9e` |
