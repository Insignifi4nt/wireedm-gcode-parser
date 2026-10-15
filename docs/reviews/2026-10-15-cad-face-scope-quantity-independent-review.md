# Independent review: explicit face scope and nonzero readouts

2026-10-15; bounded read-only review against green `70f45e978c77c67cc3f6f73e2822c5684daba11d`. **No actionable defect found in the frozen 18-path UI repair or the separate two-path diagnostic addendum.** This completes these reviews only; root owns current-bundle/native/browser/full CI verification and the continuing CAD goal. No owner production/test, package, browser/server/build or commit changes by this reviewer.

## UI scope and precision

Workbench's three-line guard rejects an explicit non-edge selection for Fillet/Chamfer before constructing a draft, starting selection conversion or publishing a candidate. It uses the existing toast/notification path and preserves selection, accepted snapshot and workflow. Mixed picks are also refused. Deliberate body selection still supports All edges; genuine selected-edge conversion and its existing stale/build/cancel checks remain intact. Shell-from-face and explicit canvas edge commands are unchanged. No face-to-edge expansion or new modeling API is implied.

The pure five-line formatter extracts the already reviewed depth policy exactly: ordinary six-decimal compact text, six-significant-digit fallback when rounding would erase nonzero, established zero/negative-zero display. All call-site changes are human labels, metadata, help, readonly/effective plugin values or relation hints. Editable annotation/panel seeds still use full `String(resolved)`; raw scalars, alias whitespace, compound relations, candidate edits and no-op detection are unchanged. Datum/placement normal formatting does not change frame calculations. Gear help path/SVG coordinates are untouched. No formatter reaches stored/native/API geometry, export data, preview identity or cache keys. Caller-owned invalid/unavailable sentinels remain in place. This does not claim consolidation of differently scoped display policies outside the reviewed six-decimal sites.

Independent Node **24.22.0** checks:

- Original ignored three-red fixture rerun **byte-for-byte unchanged: 3/3 pass**; `tmp/cad-final-spec-original-independent-green.log`. Accepted nonzero width appears in annotation and constraint list, and an explicitly selected face cannot open All edges. Original fixture SHA-256 `FA57C2BF2C04C22118D87AC6C413C9B1E098A1B9831A4CA98B7C23F4923AE097` and original failure log `C1E7FE08D1620D8655785721928B532DA5636D6F66D29E73CC155EC3B31732F0` remain exact.
- **212/212 in 16 full affected suites**, 10.00 s; `tmp/cad-final-spec-independent-focused.log`. The promoted regressions include tiny width/diameter/signed angle, exact unchanged Apply/Cancel, selected-face refusal and deliberate-body recovery, actual scalar/plugin/frame/Loft/Sweep/selector readouts, precise alias/formula editing, depth and delayed public capture behavior. Overlapping original/targeted cases are not added to that count.
- Full app `npx tsc -b --pretty false` exits **0**, `tmp/cad-final-spec-independent-type.log` empty. Scoped whitespace check passes.

All **18 changed + 12 protected + 2 preserved original-evidence** hashes match `tmp/cad-final-spec-repair-source-freeze.json`, SHA-256 `5F80C9CED1CF9F7050E73FD6C47820926D0DEDC28D751F74AC47974AA765BF0E`. Protected renderer/capture/controller/tool/schema/operations/native/E2E/config/package paths remain unchanged from the green base. Key reviewed hashes:

| File | SHA-256 |
| --- | --- |
| `src/features/cad/CadWorkbench.tsx` | `AC6BFC8C1731757C20F5E350A9257F6F78EF5119D0CEAAC8CF518BD067568B28` |
| `src/features/cad/cadDisplayQuantity.ts` | `F807C55780A779BA16CDE4D89508831F184E7C07871D50BA6FC0B85243FEC182` |
| `src/features/cad/cadExtrudeDepthHandle.ts` | `939AA6460346DC3C8AA0E4C587160A1C63D435D6F7B544C69EF9743B2E379774` |

## Exact dynamic-range diagnostic addendum

The one-line domain change interpolates actual minimum/maximum values in an existing API2 error, matching static diagnostics. It imports no feature-layer formatter and leaves all evaluation, bounds comparisons, conditions, issues structure, source/package/schema and geometry unchanged. It correctly separates exact actionable diagnostic bounds from compact human readouts.

The new real parsed allowance recipe establishes a permitted `[2e-7,4e-7]` interval and accepted linked `3e-7` geometry. Its regression verifies the exact rejection message for `1e-7`, identical snapshot/history after atomic refusal, exact upper-bound acceptance with alias/package unchanged, and one Undo restoring complete original data. This is a valid derived interval, not an invalid-package fixture.

Independent checks: **37/37** rule/package cases and **20/20** storage cases in separate focused invocations (57 distinct cases across three files). Logs `tmp/cad-plugin-diagnostic-range-independent-green.log` and `tmp/cad-plugin-diagnostic-range-independent-storage-green.log`; combined-source TypeScript above also passes. The initial command requested the wrong storage directory and discovered only the first two files; the actual storage suite was then run separately, without skipping or changing a test.

Both addendum hashes match `tmp/cad-plugin-diagnostic-range-source-freeze.json`, SHA-256 `D0573D1A9F34023575F798295D9D68C9DC7CEB7AE7CDCE0DDE8FA8350820DCCA`; all original 18 UI hashes remain unchanged:

| File | SHA-256 |
| --- | --- |
| `src/domain/cad/plugins/cadPlugins.ts` | `E3FFBB72D07289A87AA53E9C16D4E5D4F98CF393D8CAD193042E73F4AAEB3C3E` |
| `src/domain/cad/__tests__/cadPluginRules.test.ts` | `44081D445F393FA473FFD958E1242CFA8B6CF8936E8837891B48FBD7FB7B1E8F` |

No actual browser/native proof or full new-head CI is inferred from these DOM/domain/type checks. The prior green checkpoint and original red evidence stay historical; the native-copy candidate remains outside this review and uninstalled.
