# Independent imported-path selector review

Date: 2026-10-14. Reviewed against checkpoint `25b3994af33d3a7f011651a42603f8dd898af597`. This review covers the two selector replacements in `e2e/cad-workflow.spec.ts`; it does not claim that the next full browser gate has passed. No production or test changes were made by this reviewer.

No actionable finding. The actual GitHub run `38619162496` failed on a strict partial-label lookup: `End X` matched both the `End X help` button and the `End X mm` input. The independent log read confirms both roles and accessible names. `CadPathSegmentFields` renders one selected segment's coordinate fields at a time through `ScalarField`, without fixed-field value context. Its existing expression input is a textbox with the default `mm` unit appended to its label; the adjacent `CadContextHelp` is a button whose name ends in `help`. Exact textbox role/name therefore selects the real editable coordinate rather than the help control. Start X uses the same field contract and needed the corresponding repair.

Independent comparison against `git show HEAD:e2e/cad-workflow.spec.ts` restored the two prior selector expressions and found the full normalized file identical to the checkpoint. No geometry, pointer target, expression, assertion, retry, skip, timing or timeout was changed. The existing journey still physically selects the imported path interior, rejects a discontinuous draft without changing the accepted version, repairs the neighboring endpoint, applies atomically, checks exact original DXF source and 250 mm² area, and builds the 1,250 mm³ Pad.

Node 24.22.0 verification:

- `node_modules/typescript/bin/tsc -p tmp/cad-e2e-kernel-tsconfig.json` passed. Log: `tmp/cad-imported-path-exact-selector-independent-type.log`.
- `node_modules/@playwright/test/cli.js test e2e/cad-workflow.spec.ts --list --grep 'an imported path is selected by its interior and edited atomically through segment fields'` discovered exactly one test. No browser/server was launched. Log: `tmp/cad-imported-path-exact-selector-independent-discovery.log`.
- `git diff --check -- e2e/cad-workflow.spec.ts` passed.

Frozen source SHA-256 values:

| File | SHA-256 |
| --- | --- |
| `e2e/cad-workflow.spec.ts` | `ACCB6BD6EC3A17455518B8F7FDFA148D43DB2CA4BCBF5CB214CA6EBA94C1349F` |
| `src/features/cad/CadPathSegmentFields.tsx` | `455F12BB3A9D09DD236B74081ABCB253CB7E41705B24CF5754CCDFBDFA5B5447` |
| `src/features/cad/CadFields.tsx` | `042BAB0E6A9BA25B01D60DDC107BB1E4C11253B73484CF85F0C729933A42C664` |
| `src/features/cad/CadContextHelp.tsx` | `5FDB914F46230A88A5617B2321AD60F3CFFDBFB3C0A17CB5773C920BDB38EF6D` |

The separate Pad/Pocket source-selection usability audit remains bounded and pending the parent's physical Pocket check. A whole-sketch capability boundary is distinct from a confirmed picking defect.
