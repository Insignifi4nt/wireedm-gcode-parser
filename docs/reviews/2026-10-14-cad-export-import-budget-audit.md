# CAD export/import budget audit

Read-only audit on 2026-10-14. Product limits, production files, saved records, installed packages, native accuracy and browser state were not changed. Measurements ran in a fresh offline process using the current pinned OpenCascade/Replicad and application domain/native functions. Generated captures are under ignored `tmp/`.

## Findings and order of repair

Three existing reliability gaps are concrete:

1. The current default V3 gear STEP export is **3,469,018 bytes**, or 3.308 MiB. It cannot pass the shared **2,097,152-byte** solid-source import limit. Its preserved-source CAD JSON would fit the current 4 MiB aggregate document limit.
2. The same gear's binary STL export is **204,084 bytes**, but contains **4,080 triangles**. It passes the byte limit and fails the separate 4,000-triangle native import limit. Widening a byte limit does not repair this case.
3. The parser accepts a compact CAD document up to 4 MiB, while its own pretty export and saved envelope are larger. An actually accepted 4,194,303-byte document produces a 4,194,529-byte JSON export and a 4,194,401-byte save. The export cannot pass the raw-file import cap; the save is rejected before writing. This affects both storage adapters through their shared CAD save boundary.

The user subsequently rejected arbitrary import/export caps for this local application. The proposed bounded repairs below are superseded: remove file/document/save policy ceilings, manage parsing and memory efficiently, and preserve exact validation, cancellation and transactional originals. Source/native import and shared storage resource paths are being reviewed together. The measurements remain useful regression evidence; they do not justify imposing a larger replacement ceiling or claiming unlimited physical device capacity.

## Measurements and fixed originals

The default fixture uses the unmodified pinned V3 package, an XY sketch, bore radius 6 mm and a 5 mm Pad. No tolerance or boundary approximation was changed. Material volume is 10,681.229997579672 mm³; the preview has 868 face groups and 2,598 edge groups. Fresh initialization took about 112 ms, build about 862 ms and STEP export about 250 ms on this host. These are one-process observations, not browser responsiveness or peak-memory guarantees. The larger STEP was rejected before native import, so this audit does not claim a native import-time measurement for it.

| Representation | UTF-8 bytes or stated units |
| --- | ---: |
| Original parametric CAD JSON, compact | 7,160 bytes |
| STEP export | 3,469,018 bytes |
| STEP original retained as imported-feature compact CAD JSON | 3,547,802 bytes |
| That imported CAD JSON, pretty | 3,547,931 bytes |
| Saved CAD envelope, compact | 3,547,900 bytes |
| File-transaction journal containing exact previous/next save images | 7,253,045 bytes |
| STEP if encoded in base64, not its actual supported representation | 4,625,360 characters |
| Binary STL export | 204,084 bytes / 4,080 facets |

The STEP contains 78,490 lines. JSON escaping adds representation overhead without changing the decoded source string. Replacing STEP text with base64 would add more overhead and change the current source contract; it is unnecessary for this fix.

Immutable captures:

- `tmp/cad-roundtrip-default-gear-20261014.step`: SHA-256 `a501c92cae766d9b4c518b5fd6cc571c89fd5970cf397c115e594ae82b52f182`.
- `tmp/cad-roundtrip-default-gear-20261014.stl`: SHA-256 `6a590e134d19d7889c8d8423a5c2331080313c87703a7c55c0c39ea9ef9bc0a6`.
- The pre-existing task download `Spur gear (45 teeth).step`: 716,563 bytes, SHA-256 `6bf85837af60b0c46af16647619c7ce54df948fb4f1904ce814c826f5c96c685`. Its actual shared native import took about 284 ms, preserved the exact source and reported one solid with volume 71,186.46865605976 mm³. This file was only read.

Fresh STEP exports have a time-bearing header, so their raw hashes can differ between runs even when dimensions and byte counts match. The named captures above are retained exact originals, not normalized header copies. The measurement script now reads those captures without rewriting them. Detailed current results are in `tmp/cad-roundtrip-budget-audit.json` and the offline probe is `tmp/cad-roundtrip-budget-audit.ts`.

The document-boundary case uses two copies of the existing valid STEP text with generated trailing whitespace, each 2,085,072 bytes. The original download is unchanged. A padded source passes the real importer and retains its original volume; the padded native import took about 224 ms. The generated compact document is accepted at 4 MiB minus one byte. Its own pretty export exceeds the portable-file cap by 225 bytes; its save envelope exceeds the same current cap by 97 bytes. This is a serialization-boundary regression with valid geometry, not an invented malformed BRep.

## Budget map

| Boundary | Current rule and consequence |
| --- | --- |
| UI file selection | `useCadController.importDocument` rejects STEP/STL/DXF files over the shared 2 MiB byte constant before opening unit review. Portable CAD JSON files are capped at 4 MiB raw bytes before/after reading. |
| Domain source schema | `cadImports` limits STEP `data` to 2 MiB UTF-16 code units, then independently checks the encoded UTF-8 byte length, well-formed Unicode and exact decoding. STL is canonical padded base64 bounded for 2 MiB decoded bytes. BOM, line endings and source text are retained. |
| Agent import/edit | `cad_import_solid` uses that full source schema. Compact document/edit discovery still delegates execution to strict full schemas. `cad_import_document` checks the 4 MiB compact parsed document; there is no chunked source-upload protocol. The 32 KiB tool result cap concerns replies, not solid-source input capacity. |
| Worker client/runtime/reply | Client and runtime parse the same source again. `isCadSolidImportResult` caps `sourceBytes` at 2 MiB; the controller verifies format, filename and exact source-byte match before replacing the draft. A STEP-only change must update this reply guard too. Jobs have a two-minute deadline, active cancellation terminates the worker, and queue/job lifetime remains bounded. |
| Native STEP | Every declared 3D context needs valid explicit units; all 1–256 transferable roots must transfer. Imported geometry must contain 1–256 valid closed positive-volume solids with no silently omitted loose geometry. Temporary native files are removed. |
| Native STL | 4–4,000 complete finite triangles, watertight manifold input, one connected closed shell and explicit mm/inch units. Multiple disconnected shells remain unsupported. |
| Native model/preview | 10,000 distinct faces/edges per body, 25,000 across preview bodies and 8,000,000 preview numeric values. Coordinates and positive volume have independent finite bounds. File size is not a replacement for these limits. |
| Parsed CAD document | `parseCadDocument` bounds aggregate source characters before cloning, then caps UTF-8 compact JSON at 4 MiB. Originals, numeric types, expressions, identities and embedded packages remain exact. |
| JSON/solid export | JSON currently uses pretty serialization. Solid export requires a valid complete model and returns an uncapped Blob; it does not promise that the file satisfies import byte/facet/compound limits. |
| CAD storage | `cadStorage` currently aliases the 4 MiB document cap for the full saved envelope, bounded reads and writes. Exact fingerprints, optimistic originals and atomic file transactions protect both adapters. |
| Browser cache | Compression may reduce physical localStorage characters, but bounded reads enforce the decompressed logical UTF-8 cap. Compression does not bypass CAD validation or guarantee available browser quota. |
| Folder adapter | Bounded reads check physical `File.size`, then decode exact fatal UTF-8 with BOM preserved. It shares the CAD saved-envelope limit; no compression reduces physical bytes. |
| History/recovery | Session retains up to 50 steps with its existing 8 MiB character estimate. File journals have a 384 MiB cap and preserve exact before/after images. Read-only recovery allows 32 MiB per logical file / 128 MiB archive; ordinary full backup is capped at 128 MiB. These are preservation limits, not permission to load oversized CAD or discard originals. |

The Node gzip estimate for the measured default save is 743,820 physical cache characters; its two-image journal is about 1,493,020. These estimates use Node gzip, not the browser adapter's compressor or a browser quota certification. The shared CAD logical cap rejects the original STEP before storage anyway.

Solid exports combine all visible bodies. Reimport represents the complete source as one Imported feature. A compound that fitted the original model's multiple per-body budgets can exceed the single imported body's 10,000-element budget. STL also rejects multiple shells. Increasing the source byte cap cannot remove these independent supported-behavior boundaries.

## Smallest coherent first change

- Historical first-patch proposal, superseded by the user's local-resource policy: keep `MAX_CAD_DOCUMENT_BYTES` at 4 MiB as the exact UTF-8 compact semantic document budget. Exact scalar types, source strings, geometry and pinned packages must still be preserved under the revised policy.
- Make the app's portable JSON export use the same compact representation. That guarantees every accepted document's own JSON download fits its raw-file import budget. Arbitrary external pretty JSON still has its documented physical-read cap.
- Give the saved envelope its own small, explicit overhead allowance above the 4 MiB document payload. Use one shared saved-file cap for save serialization, exact load, library listing and both adapters. The current writer adds exactly 98 UTF-8 bytes with its ordinary UTC timestamp. Choose and document bounded envelope headroom from the existing envelope/timestamp contract, then check the actual serialized bytes. Do not raise the semantic document cap just to hide wrapper bytes.
- Retain bounded originals and stale/cancel/conflict checks before any journal/write. Oversized, malformed or unknown saved records remain preserved with diagnostics. No automatic rewrite or migration is needed.

Red-first acceptance seams: a valid compact document just below and exactly at 4 MiB must export/import through the real controller and save/load through cache and folder adapters, with exact source hashes and scalar representation preserved. One byte above remains rejected atomically. Existing saved originals with differing whitespace/BOM must keep their original fingerprints on read. Cancel, stale version/store and interrupted/retried transactions must preserve exact prior files and durable receipts. Include multibyte UTF-8 so character limits cannot masquerade as byte limits. Retain the existing too-large compressed-cache and malformed-library cases.

Capacity changes also have a compatibility fact: a newly allowed saved envelope just above 4 MiB can be refused by an older app even though the envelope schema is unchanged. Record that additive capacity behavior in the release/compatibility notes. Installed post packages, their schemas and execution semantics are unaffected. Existing saves are not rewritten just because the limit changes.

## Subsequent STEP-only decision

After coherence is verified, the smallest change for this measured default gear is a **4 MiB STEP-source ceiling**, while retaining the 4 MiB compact aggregate document cap. The measured 3,547,802-byte imported document has headroom under that aggregate cap. Reject a source whose resulting complete document/save does not fit before native work. Keep STEP's UTF-8 contract; do not encode it as STL/base64 or approximate it.

Split source budgets by format or use one shared format-aware budget helper. Update STEP schema/code-unit and UTF-8 checks, UI file review, client/runtime/reply matching, controller import preflight and agent descriptions together. DXF stays 2 MiB and STL stays 2 MiB / 4,000 facets. Raising the currently shared constant would accidentally advertise larger DXF/STL inputs while their own parsers/work limits reject them later.

That later gate needs real import/rebuild/STEP material and bounds checks on the retained larger fixture, exact-source save/load through both adapters, near-limit UTF-8 and worker reply checks, and cancellation/stale/store cases. This audit measured the current rejection, not successful above-cap import. Existing older source schemas will reject larger embedded STEP originals; record that separately from the first saved-envelope headroom change.

Keep current solid export useful for other CAD applications even when this app cannot reimport it. Do not claim complete STEP/STL round-trip parity from a byte-limit change, suggest STL as an automatic fallback, reduce gear tolerance or silently drop disconnected components. The 4,080-facet default STL is a separate hardening decision requiring native work/ownership evidence, not part of a STEP increase.

## Verification

The isolated measurements exercised the current domain parser and actual native exporter/importer. Five focused existing domain, native, storage, tool and controller suites passed **160 tests**. Source tracing confirms cache/folder share the failing envelope gate. No production test file or limit was edited in this read-only audit; the concrete boundary cases above are ready for the coordinating red-first patch.

## Implementation addendum: user-directed resource policy

The user subsequently directed that on-device CAD import/export have no arbitrary file or document byte caps. That instruction supersedes this audit's earlier recommendation to retain a 4 MiB payload ceiling and add only 101 wrapper bytes. The initial narrow coherence patch first reproduced twelve failures and passed 164 focused tests after compact export and derived wrapper allowance; the user then changed the policy before release. No saved files were migrated or automatically rewritten at either stage.

The current portable-document patch removes the source-character aggregate and compact-JSON byte checks from `parseCadDocument`, the portable file-size checks and redundant parsed-document encoding from the controller, and the saved-file byte gate from save/load/list. The document and saved-file cap constants are removed rather than replaced with `Infinity`. Portable downloads use compact semantic JSON. Numeric types, full JavaScript-number precision, expression strings, identities within the source payload and embedded original text remain exact; a portable import deliberately receives a fresh app identity without overwriting the source's saved file. Original saved-file fingerprints continue to identify the exact stored envelope bytes, including whitespace and BOM.

Real STEP fixture originals and multibyte metadata exercise documents below, exactly at, one byte above and 64 KiB above the former 4 MiB policy. A short source ID whose generated replacement adds 39 bytes is now accepted while preserving the earlier saved draft's original. Invalid large geometry still rejects atomically. Cache and folder tests cover exact source SHA-256 hashes, compact download contents, successful save receipts, re-opened documents, library entries, stale original fingerprints, cancellation, interrupted writes and safe retries. Existing large saved originals with trailing whitespace remain readable without rewriting them, and an unreviewed replacement still rejects.

Resource work is coordinated through the shared adapter's compatible `readExactText(path, signal?)` contract and `readExactUtf8Blob` helper. Folder and portable reads prefer cancellable streams, with 64 KiB slices for older Blob implementations; fatal UTF-8 decoding preserves the BOM. Portable JSON removes only its leading transport BOM before parsing, preserving BOMs inside original source strings. The cache reader streams base64/gzip decoding without a whole expanded byte buffer or a policy-size substitute. The controller owns an import AbortController through existing Cancel, storage-change and unmount seams; delayed completion cannot replace the accepted draft. All three CAD storage operations pass cancellation to the exact read and recheck before publication or mutation. The shared journal resource work belongs to the storage owner.

The pre-schema plain-data guard also used guessed 200,000-node and 24-level limits. An iterative frame traversal now validates own plain data without those limits or recursive call-stack growth. An ancestor WeakSet rejects cycles while permitting shared acyclic subtrees. Getter-backed, symbolic, hidden, sparse, nonfinite and exotic-prototype data still rejects without invoking getters. The new red cases additionally found that the old own-key-count check could accept a sparse array when an extra property replaced a missing index; canonical own array-index validation repairs that integrity defect.

This change does not claim unlimited hardware capacity, universal solid round-trip support or a general geometry solver. Exact JSON still needs a complete parse; SHA-256 receipts and the existing save journal retain necessary whole-file representations. Browser storage quota or native resource errors remain explicit failures with originals preserved. Modeling-specific schema counts, geometry validation and bounded Undo retention remain separate from this byte-policy removal. Native source/facet policies and long-running kernel work are handled by their coordinated owners, with separate real-native evidence.

Focused current verification passed 171 tests across four suites. After the coordinated DXF assertion and shared stream typing repairs, the broader current-source checkpoint passed **309 tests across eleven suites**, including domain integrity, DXF/STEP source boundaries, native DTO guards, both storage adapters, controller operations, WebMCP and the agent journey. The scoped diff check passed. The final type-check snapshot had only three concurrent native shape-test fixture typing errors, reported to their owner; this slice and the exact-reader contract had no remaining type errors. No browser/server operation, app-version change, installed-package rewrite or saved original mutation occurred in this slice.
