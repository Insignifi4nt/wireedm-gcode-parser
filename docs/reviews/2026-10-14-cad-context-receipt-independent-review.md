# Independent CAD context and receipt review

Reviewed the current tool-only parameter-context repair independently on 2026-10-14. Product source: `src/features/cad/cadSiteTools.ts`, SHA-256 `808b12701e0087f772fff5a8b4ac9e7a77867ede22bcb0cca2f1246558b02b81`. The actual real-controller regressions are in `src/features/cad/useCadController.test.tsx`; this checkout has no `cadSiteToolsReal.test.ts` file.

No actionable defect found within the scoped formatter, receipt or parameter-read contract. No production or test edits were needed for this review.

## Findings checked

- `parameterContext`, lines 40–62, retains a complete ordered prefix and counts every own parameter, including omitted entries. Its byte calculation includes JSON quoting/escaping, commas and UTF-8. Group rows preserve whole IDs/names and use the same actual serialized-byte accounting. Total and omission counts remain exact; no stored values or metadata are changed. The parser excludes reserved parameter names before this trusted formatter runs.
- `context`, lines 102–120, replaces only redundant parameter/group payloads. Open/create/import/open-saved/edit/Undo/Redo all reuse it. The two 4 KiB payloads, existing 4 KiB diagnostic summary and bounded identity/support fields leave room below the 32 KiB tool envelope, so large parameter maps cannot turn these successful mutations into `OUTPUT_TOO_LARGE`.
- Empty and ordinary small contexts retain complete names/values and ID/name groups. New counts are additive. The intentional summary compatibility rule requires callers to inspect omission markers; the discovery text directs them to complete reads.
- `cad_inspect_parameters` returns version-pinned whole rows with exact stored values, provenance and membership. `cad_read_document` is independent of these summaries and returns every JSON code unit, including group metadata and sources. Its immutable-document text cache remains guarded by the current expected version. The reader's offset check precedes arithmetic and rejects offsets beyond the real text.
- Guarded controller/session operations still own active-workflow, storage, stale-version, save and Undo state. The formatter does not create a second mutation path or modify cancellation outcomes.

## Independent verification

Ran only the three meaningful real-controller context cases against the frozen source: **3/3 passed**, other 106 controller cases skipped (`tmp/cad-context-independent-final.log`, start 18:41:56, duration 5.37 s).

The cases reconstruct all 1,001 exact parameter values and memberships via pagination, then the entire document via text chunks without changing the session. A genuine linked-radius edit returns the new version and successful bounded receipt; an old-version retry rejects, an equal-value current retry is a no-op, one Undo restores the exact prior document, and Redo restores the edited document. Small/empty context, fresh imported identity, exact browser-cache save, workspace reopening and saved-document reopening retain truthful dirty/save/workflow/history state.

The author separately ran 134 cases across four related suites and TypeScript. This review verifies the bounded-context repair; it does not claim all viewport payloads or every individual feature/diagnostic tool row are now arbitrarily large. Those use separate contracts and were not expanded here. Large complete document data remains readable through `cad_read_document` without a file-size policy ceiling. The overall CAD goal remains active.
