# Depth-handle presentation after physical QA

2026-10-15; scoped follow-up to the frozen routing/gesture slice. Parent's actual current-bundle physical drag worked: accepted linked depth stayed 10, the preview and dependent quantities followed the provisional drag, and Cancel restored the exact original. The screenshots exposed two presentation defects: a cyan arrow over the selected cyan face and an endpoint label reading `19.844262327110005 mm`.

Inspected primary evidence in this worktree:

- `tmp/cad-depth-handle-before-current.png`, SHA-256 `4A898D6636CDFD170BC0BAB7A795919513F8116197F63EDCDA545FB64ADADB99`.
- `tmp/cad-depth-handle-drag-preview-current.png`, SHA-256 `968F22F3FB4578D4B79363E6C3778503B6E45C9FE05FD2BCA725B4C5C3CD0373`.

Only `cadExtrudeDepthHandle.ts` and its focused test changed. Normal labels follow existing CAD dimension display convention, `Number(value.toFixed(6))`, so that observed value displays as **Length 19.844262 mm** without trailing zeros. When that display would erase a nonzero quantity, a six-significant-digit scientific fallback preserves its sign and nonzero meaning, for example **Length -4e-7 mm**. The model quantity, endpoint computation, exact alias/expression, scalar drafts, ray math and accepted data retain full precision. This is display formatting only.

Idle arrow and guide use rust `#b84f18`; hover/active arrow uses deeper rust `#a6440e`, the established source-selection palette. Locked states retain their existing reason and color. No body materials, depth tests, opacity, geometry allocation, pointer routing or camera state changed. The palette tests check the actual Three arrow material's idle/hover colors against both dark canvas and selected cyan with contrast >=2.5; actual lighting/raster verification remains parent's fresh-bundle task.

## Test-first evidence and freeze

The focused new cases reproduce **3 failures / 1 pass** before implementation: positive/negative floating precision and cyan selected-surface contrast fail, while integral label behavior already passes. `tmp/cad-depth-presentation-red.log` records those exact reds. New formatting cases also prove the full quantity and endpoint are identical to the original double, the named binding remains exact, no quantity callback occurs and the source document/expression remains byte-for-byte unchanged.

The parent and independent reviewer identified the initial formatter's zero-label edge before rebuilding. The first tiny renderer cases fail **6/6** against the normal formatter (`tmp/cad-depth-presentation-tiny-red.log`). Those include `±1e-7`/`±1e-9` provisional values; they do not establish accepted Pad eligibility, because accepted Pad distance requires magnitude above `1e-7`. Two additional cases first parse full documents with accepted `±4e-7` quantities and reproduce **2/2** zero-label failures (`tmp/cad-depth-presentation-accepted-tiny-red.log`). The scientific fallback fixes both accepted and provisional rendering without changing that acceptance rule.

Final Node **24.22.0**, six full files (`cadExtrudeDepthHandle`, `CadViewportDepth`, `CadExtrudeDepthHandleEditor`, `CadExtrudeDepthEditor`, `CadSourceReferencePicking`, `CadViewport`): **93/93 passed**, 2.49 s. Log `tmp/cad-depth-presentation-final-green.log`. Full app TypeScript passes (empty `tmp/cad-depth-presentation-final-type.log`, exit 0); scoped diff check passes. Earlier 85-case evidence remains in `tmp/cad-depth-presentation-green.log`. No browser, server, build, commit or unrelated product edits.

The parent-authorized candidate source manifest was updated for exactly these two mismatching entries, after proving all other entries still matched. The original is preserved as `tmp/cad-region-depth-candidate-source-freeze-before-presentation.json`, and the intermediate normal-format version as `tmp/cad-region-depth-candidate-source-freeze-before-tiny-presentation.json`; `tmp/cad-region-depth-candidate-freeze.mjs check` confirms all 51 entries of the final manifest. This intentionally supersedes only the prior helper/helper-test hashes; the earlier owner/independent routing evidence remains valid for its original snapshot.

| File | Frozen SHA-256 |
| --- | --- |
| `src/features/cad/cadExtrudeDepthHandle.ts` | `1D242DC7398B7EF12221F323D123E372CAC039EF0353C3B495B6AAE9C81DD32B` |
| `src/features/cad/cadExtrudeDepthHandle.test.ts` | `C28DA2E7066FDE78FE06BD6F1380E1C0D7523766A33ECC0572A6EE6F3E09F3AF` |
| `src/features/cad/CadViewport.tsx` (unchanged) | `D69AB2C91E1AC29676E7D4429CA5DDE927B58CEF5731CB4A929A8EABFB0C5518` |
| `src/features/cad/cad-depth-handle.css` (unchanged) | `43D26AB85FF7F18957037C5D1718A83A1A8E2CBC504A9EB52EA9347329B2875A` |
