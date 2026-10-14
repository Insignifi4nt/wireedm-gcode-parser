# source-map-js lock delta review

Independent read-only review on 2026-10-14 using Node v24.22.0. No dependency files, installed packages, runtime or test configuration were changed by this reviewer. No additional broad audit or test run was performed.

The exact delta after the earlier Node 24 CI review is one transitive `node_modules/source-map-js` record: version **1.2.1 → 1.2.2**, its registry tarball URL, and its SHA-512 integrity. Replacing only these three current record values with their preceding values reconstructs the entire earlier lockfile byte-for-byte, proven by its previously recorded SHA-256. Root package ranges and all other lock records therefore retain that reviewed snapshot. The root package JSON hash also remains unchanged.

The [reviewed GitHub advisory GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) identifies versions `>=1.0.0, <1.2.2` as affected and 1.2.2 as patched. The maintainer's [v1.2.2 release](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2) explicitly includes the indexed-source-map denial-of-service fix for CVE-2026-93749.

The [official npm registry metadata](https://registry.npmjs.org/source-map-js/1.2.2) reports the same version, resolved URL and integrity as the lock. An independent SHA-512 calculation over the registry's 36,349-byte tarball also matches:

`sha512-KGj/8Y43x35aZVDtt+J4mK1hoLGHULMYfSkODJNQjNDC3oW1PqPoxMwo0pLUsWM/UEGzON/NxeHywEfNXNP3Vw==`

Installed `node_modules/source-map-js/package.json` identifies version 1.2.2; the installed npm lock record matches all three reviewed fields. The parent's saved `tmp/cad-ci-node24-audit-after.json` reports zero vulnerabilities in every category. That result was inspected, not rerun by this reviewer. Read-only verification evidence is in `tmp/cad-source-map-js-lock-review.mjs` and its output log.

| Snapshot | SHA-256 |
| --- | --- |
| Earlier CI-reviewed `package-lock.json`, before this patch | `f0cd509e586d4fea391e5717faaf6cfbf6ac6228840001681d0124a9cd1866ef` |
| Current patched `package-lock.json` | `4cc85188e4da3ea0b4fa2086442db9a3b8a11128e31c767d0a3be7e5a5561e31` |
| Unchanged reviewed `package.json` | `32dae7fc8270f500c12782af797215a45d3b47760bdfc593d7960369cbbbc9c0` |

No actionable finding. This record supplements the earlier CI review; its lockfile hash and statement about unchanged dependency records apply to the pre-patch snapshot. It does not replace the parent's ongoing full Node 24 verification.
