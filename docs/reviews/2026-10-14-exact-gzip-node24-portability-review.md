# Exact gzip cache portability under Node 24

Scope: `exactTextStream.ts` and exact-read regressions, using Node v24.22.0. The shared bounded rescue integration is owned and verified separately against the same exported byte stream. No stored cache envelopes, folders, sources, package versions, servers or browser state are rewritten by this repair.

## Diagnosis and contract

The actual Node 24 concatenated-gzip case failed with `TypeError: Trailing junk found after the end of the compressed stream`; the existing portable path passed. The [Compression Standard](https://compression.spec.whatwg.org/#supported-formats), lines 92–113, permits only one gzip member in `DecompressionStream` and rejects additional input. [RFC1952](https://www.rfc-editor.org/rfc/rfc1952), section 2.2, defines gzip files as consecutive members. The cache reader's existing complete-file contract therefore cannot rely on the narrower web API. [Node v24.22.0's Web Streams documentation](https://raw.githubusercontent.com/nodejs/node/v24.22.0/doc/api/webstreams.md) documents its web stream/reader and compression interfaces.

A second real probe showed the old fallback accepted a valid empty gzip plus one or three trailing zero bytes. It checked CRC/ISIZE at the final supplied byte position without proving the real DEFLATE end. Its gzip header parsing also ignored reserved flags and FHCRC. A valid optional header spanning compressed input chunks could leave the consumer stalled when a pull produced no output.

`createStrictGzipByteStream(base64, signal?)` now supplies one deliberate cooperative `Gunzip` decoder, regardless of platform compression-global availability. A small aligned input window validates each actual header: signature, compression method, reserved flags, optional extra/name/comment structure and FHCRC. Every actual member's decoded CRC32 and modulo-2³² ISIZE are checked at its parser-reported boundary. Strict UTF-8 text decoding spans member boundaries and preserves BOMs and line endings.

`Gunzip` publicly reports the next member's offset. The reader feeds original chunks with `final=false`, then one known empty completion member. Success requires its transition at exactly the original decoded compressed-byte length and validation of the preceding real footer. The internal completion member must emit no text. It is never appended to a stored/source value. This proves the final original boundary without private decoder fields, signature scanning, a second DEFLATE parser or retrying rejected native data. Truncated payloads/footers/headers and trailing bytes cannot receive a partial successful text result.

Headers that produce no decoded output continue across bounded input chunks until data or completion, with cooperative cancellation checks. The exported stream allows the bounded reader to enforce its existing decoded/envelope policies before retaining text. Early bounded cancellation is a rescue outcome, not a certificate of complete source validity; full exact consumption performs every check above.

## Resource and cancellation evidence

The original fallback slept after every 4,096 base64 characters. On this Windows host, that caused 187 timers for a real default-gear STEP source. The scheduling repair yields initially and after elapsed 8 ms work slices, with cancellation checks between unchanged compressed chunks. No elapsed-time acceptance assertion or correctness tolerance changed.

Fixture: `tmp/cad-roundtrip-default-gear-20261014.step`, 3,469,018 source bytes, gzip size 575,351 bytes. Source SHA-256: `a501c92cae766d9b4c518b5fd6cc571c89fd5970cf397c115e594ae82b52f182`. Three informal observed reads before scheduling took 2,843 / 2,728 / 2,799 ms; after, 218 / 172 / 197 ms. Every returned string exactly matched the same source. Measurements are not controlled browser benchmarks or a universal latency guarantee; observed memory deltas vary with garbage collection. The decoder retains bounded compressed windows and incremental output, without a complete binary-base64 or expanded-byte buffer.

Regression coverage retains the original concatenation fixture with real native globals present and with them absent. Added cases cover valid optional/FHCRC headers across chunks, UTF-8 split across members, an empty final member, corrupt first/second CRC and ISIZE, invalid compression method/reserved bits/FHCRC, incomplete headers/payloads/footers, trailing zero/nonzero bytes, and cancellation after the last original text chunk before completion. Cache envelopes remain exact after failure and cancellation; folder readers release their locks and no partial text succeeds.

## Frozen verification

- Node 24.22.0 exact/cache/folder gate: **41/41**, three suites, including **19 exact-reader cases** (`tmp/exact-gzip-node24-storage-gate.log`).
- App TypeScript and scoped diff check: passed (`tmp/exact-gzip-node24-tsc.log`).
- First native reproduction: `tmp/exact-gzip-node24-red.log`; adversarial red cases: `tmp/exact-gzip-headers-node24-red.log`.
- Representative measurements: `tmp/exact-gzip-decode-before-slicing.json` and `tmp/exact-gzip-decode-after-slicing.json`.

| Frozen file | SHA-256 |
| --- | --- |
| `src/domain/storage/exactTextStream.ts` | `1af5783ecb332d283c8b60c3ffc9533ab265ef1635c731f28b05a1742f35c9d5` |
| `src/domain/storage/__tests__/exactTextReads.test.ts` | `5b7847c195486c6996e888ecdb60ae9667f4389ffba49f07c4d644b7186669e7` |

The independent reviewer owns additional boundary diagnostics and the final shared bounded-reader review. This focused record does not replace the parent's full Node 24 app gate or claim the overall CAD goal complete.

The parent also authorized a separate test-only dense-DXF execution budget of 30 s after unchanged 131,073-vertex fixtures passed in isolation in 10.91 s but timed out at 16.02 s under concurrent gates. Only that file's prior 15 s callback budget changed; all complete-data, geometry, units and provenance assertions remained exact. The budget accommodates test-host workload, not geometric acceptance or an elapsed performance requirement. Its independent owner records the one-line review.
