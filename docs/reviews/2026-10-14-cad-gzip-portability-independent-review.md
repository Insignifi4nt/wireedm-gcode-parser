# Independent exact and bounded gzip portability review

Date: 2026-10-14. Baseline: `c36aa3b50a30f82ded3508652d9e7917c69b6b59`. Reviewed the research owner's frozen strict decoder and the explicit-dimensions owner's frozen bounded-recovery integration. No production, adapter, test, package, server or browser changes were made by this reviewer. Only this private record and an ignored diagnostic harness were written. Tests began after the owners' focused gates finished.

## Result and standards boundary

No actionable finding in the repaired slice. Both ordinary exact reads and bounded recovery now use the same strict, cooperative gzip decoder and preserve complete original cache envelopes. Node 24 tests and independent adversarial boundary cases pass. This is a scoped review, not the final whole-app gate or a general memory/latency guarantee.

The [WHATWG Compression Standard](https://compression.spec.whatwg.org/#supported-formats) restricts `DecompressionStream('gzip')` to one member and treats subsequent bytes as an error. The underlying [RFC 1952 format](https://www.rfc-editor.org/rfc/rfc1952.html#section-2.2) permits a member series. A valid concatenated cache file therefore cannot rely on the native primitive across runtimes. The deliberate pinned `Gunzip` path resolves that mismatch without retrying native errors or guessing boundaries from compressed signatures.

During the initial read-only pass, the unchanged bounded rescue path reproduced the same failure on a tiny valid two-member source under Node v24.22.0: `TypeError: Trailing junk found after the end of the compressed stream`. Root authorized that separate integration. After its freeze, the identical read returned `{ status: 'read', text: 'firstsecond' }`. This remaining boundary was repaired rather than hidden in a claim about only the ordinary reader.

## Strict framing and completion proof

The pinned library's supported `onmember` callback identifies the start of a newly parsed member. The wrapper validates original headers and footer boundaries at those exact offsets. It does not scan for magic bytes, inspect private inflater fields or implement a second DEFLATE parser. Original header reads require gzip identity, method 8, clear reserved flag bits, complete optional fields and valid FHCRC when present. MTIME/XFL/OS and optional field contents retain their normal ignored semantics; termination and header checksum remain checked. The byte lookup reads only original base64 windows.

Each transition first verifies the previous member's CRC32 and ISIZE against its accumulated decoded bytes, with the existing modulo-2³² length semantics. Bounds enforce room for the original header, a minimum complete DEFLATE stream and the eight-byte trailer. Counters reset only after that footer check; a later corrupt member cannot be accepted because an earlier member was valid.

The strict EOF repair addresses a concrete pinned-library gap: empty gzip plus short trailing zero strings could otherwise be accepted. Every original compressed chunk is fed with `final=false`. A constant, known empty member is then supplied only to the decoder, forcing its supported callback to reveal the last real boundary. Acceptance requires that boundary to equal the original decoded compressed-byte length exactly. Its original footer is checked before completion is set. Synthetic bytes cannot be read by the original-header lookup or count as original footer data, and any text emitted after completion rejects. The empty completion member is never written, returned as source or added to the stored envelope.

Valid empty original members and UTF-8 characters split between members remain supported. One fatal UTF-8 decoder spans all actual output, preserving the BOM and preventing a member boundary from replacing or truncating a codepoint. A successful text result is returned only after member completion and final UTF-8 flush. Internally queued partial text does not become a successful exact-read receipt if a later header/footer/completion check fails.

## Cancellation, source integrity and resource behavior

The existing exact/folder stream reader still cancels pending I/O on abort, checks the signal before/after reads, removes its abort listener and releases its reader in `finally`. Folder Blob reads, 64 KiB fallback slices and strict original-byte decoding are unchanged. Cache reads still decode a snapshot of the stored envelope without mutation or migration. Ordinary `readText`, adapter mutation scopes and transaction/journal/original-fingerprint behavior are unchanged.

The strict gzip stream uses 4,096-character base64 source chunks, a 3,072-byte header lookup window and small original-footer windows. It avoids a full decoded compressed-byte copy and an accumulated expanded byte buffer; consumers still need complete output strings for ordinary exact reads. Pinned `Inflate` keeps its sliding history and scoped emitted chunks rather than a whole expanded-output history. The completion member is a constant 20-byte framing observation.

Inflater work performs an initial cooperative yield and targets eight milliseconds between input pushes before yielding again. The limit is checked between pushes and is not a hard wall-time bound for one expansion, header validation or all optional fields. Original-header validation remains synchronous; no universal instant-processing or constant-memory claim follows. The owner separately measured the actual default-gear STEP cache fixture at 3,469,018 original bytes/575,351 gzip bytes: replacing per-chunk timers with these work slices changed its reported decode samples from 2.73–2.84 seconds to 172–218 ms with exact source equality. That is owner-supplied fixture evidence, not an independently repeated performance benchmark in this review.

The bounded consumer uses the same stream but keeps its previous explicit rescue limits, including the 128 MiB maximum read limit and physical-envelope allowance. It checks expanded byte count before retaining decoded text, reports `too-large` without returning partial content, and cancels/releases the reader on this early exit. Early resource refusal does not certify the remainder of an oversized gzip; it preserves the original for another recovery route. Full bounded reads validate all members, completion and UTF-8. No rescue/backup ceiling was removed by this integration.

The new recovery expectation changes the old no-native-primitive case into complete portable recovery with exact original text. It retains abort behavior and checks that the cache envelope is unchanged. Corrupt/truncated sources remain explicitly unreadable, with no partial recovery text, source rewrite or inferred deletion. Recovery and backup receipts retain their established ownership and completeness checks.

## Independent verification

All focused checks used the official installed Node **v24.22.0** binary. **81 tests across six files** passed: exact reads, browser cache, folder adapter, bounded gzip reads, workbench recovery and backup. Tests verify native-present/absent parity, BOM/multibyte splits, optional/FHCRC headers, member CRC/ISIZE, truncation/trailing data, cancellation after original text but before EOF proof, released readers and successful retry. They also verify early expansion refusal performs no TextDecoder retention, base64 arguments remain at most 4,096 characters, oversized physical envelopes are omitted before decoding, and exact stored originals survive.

The independent ignored harness `tmp/cad-gzip-independent-boundaries.ts` passed **7 valid** and **171 malformed** cases under Node 24 with native decompression available. It independently constructs FHCRC with `node:zlib.crc32` and checks:

- Maximum 65,535-byte FEXTRA and a 6,000-byte name, including gzip signature bytes inside optional fields, plus large later-member headers.
- Complete BOM/UTF-8 split across members, empty first/middle/final members and 300 consecutive empty members.
- Every truncation of a complete single-member fixture, partial next-member headers/body/trailers and every 1–8-byte final-footer removal.
- 1–32 trailing zero bytes after both empty and nonempty originals, partial gzip signatures and corrupt first/later header, reserved flags, FHCRC, CRC32 and ISIZE.
- Invalid final UTF-8, an already-aborted read and unchanged original compressed arrays/base64.

No assertion, timeout, schema or production code was loosened by this reviewer. Scoped whitespace checks passed. The owners separately reported TypeScript checks passing; this read-only review did not duplicate the full compiler/build gate. Production and test hashes below were rechecked after independent execution and match the owners' frozen pins.

| File | SHA-256 |
| --- | --- |
| `src/domain/storage/exactTextStream.ts` | `1AF5783ECB332D283C8B60C3FFC9533AB265EF1635C731F28B05A1742F35C9D5` |
| `src/domain/storage/__tests__/exactTextReads.test.ts` | `5B7847C195486C6996E888ECDB60AE9667F4389FFBA49F07C4D644B7186669E7` |
| `src/domain/storage/boundedExactText.ts` | `119E2E404F2708B54870EBF81DA1FF687A19304DC0E253C04EF2A1193C926E3C` |
| `src/domain/storage/__tests__/boundedGzipReads.test.ts` | `E86C365BC693DFFEEBAB98F29EB77E06DE002930D3185913E844C68F184A5726` |
| `src/domain/storage/__tests__/workbenchRecovery.test.ts` | `158C8016A6B56700D5094675316C4B81D0848F833A154708FF5A0CB70ABC530F` |
| `src/domain/storage/browserCacheAdapter.ts` | `AB1EF0A5EBA6AF1C9716300CC0AF08DC226BC29DF10FD32905C7A2C108FF0C1D` |
| `src/domain/storage/browserDirectoryAdapter.ts` | `DA65929E68FDA8CE84FDA5CE93B145390C9443427B52636DC4D22F10DA1380AE` |
| `node_modules/fflate/esm/browser.js` | `B7CA4450B19559A1D50EB381ADCEE94B82449674BE4CD17789D9BEBA7E6122A1` |
