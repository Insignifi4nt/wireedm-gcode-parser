# Bounded gzip exact-read portability repair

Scope: `boundedExactText.ts` and bounded cache/recovery regressions. The shared strict gzip byte decoder is owned and independently reviewed separately. This owner did not edit that decoder, storage schemas, adapters, originals, server/browser state, public documentation, versions or commits.

## Reproduced boundary failures

The actual cache adapter under Node v24.22.0 rejected a valid concatenated gzip when native `DecompressionStream` was present: `TypeError: Trailing junk found after the end of the compressed stream`. Without that primitive, bounded recovery rejected all gzip as unavailable. Its complete `atob` decode also copied the whole encoded source before a small expansion limit could stop reading.

Red logs: `tmp/bounded-gzip-members-red-node24.log` and `tmp/bounded-gzip-expansion-red-node24.log`. Cases cross the actual cache/recovery operations, not a mocked decompressor. Native presence is asserted for one arm; the other removes only the optional native primitive. The repaired implementation uses one deliberate portable strict decoder in both environments.

## Minimal integration and retained policy

`readBoundedGzip` now obtains its reader from `createStrictGzipByteStream(base64, signal)`. It duplicates no gzip decoder and allocates no full base64 byte buffer. Existing strict streaming UTF-8 decoding still preserves a leading BOM and split codepoints.

The bounded reader retains:

- Safe integer/nonnegative read limits with the existing 128 MiB upper bound.
- The existing physical envelope preflight allowing 64 KiB framing headroom above the requested decoded limit.
- Byte counting before decoding or retaining each emitted chunk.
- Whole-file `too-large` status rather than truncated text.
- Abort checks before/after pending reads, signal-driven cancellation and unconditional reader cancellation/lock release in `finally`.

If an emitted chunk crosses the limit, it is not decoded or appended to the text parts. The reader cancels immediately. That early `too-large` result is an explicit bounded-rescue omission, not certification of unconsumed member checksums or later source bytes. A successful `read` result consumes the shared stream completely, validating every real member and the exact original source boundary before UTF-8 flush/text return.

These are existing backup/rescue policies. The separate uncapped CAD document/source read paths are unchanged; no arbitrary CAD file/model policy ceiling is restored.

The recovery regression now correctly captures complete compressed originals even without the optional native primitive, retaining its read-only hash/receipt and unchanged stored envelope. This improves portability without a migration or rewrite.

## Meaningful verification

Actual bounded cache tests cover tiny two-member gzip, three split BOM/UTF-8 members plus an empty final member, below/exact/above byte boundaries, corrupted CRC/size/reserved flags, truncated members, trailing bytes, invalid final UTF-8 and refusal to rescue partial contents. Corrupt/oversized/cancelled sources retain their exact stored envelopes.

Cancellation tests inspect the real acquired stream readers, verify lock release, retain the stored source and then perform a successful complete retry. An expansion case combines a highly compressed initial member with a larger random tail: a 16-byte limit stops before any text-decoder call, uses only chunk-sized base64 reads and avoids reading the complete physical envelope. A separate physical-size preflight proves oversized envelopes are omitted before any `atob` call. Invalid limits still reject.

Current Node v24.22.0 gate, run sequentially after the shared owner declared its source frozen: **81 tests in six suites passed**. Files: bounded gzip reads, workbench recovery, exact text reads, workbench backup and both cache/directory adapters. The folder/backup shared semantics and existing logical malformed-UTF16 rescue remain intact. `npx tsc -b --pretty false` and `git diff --check` passed.

Logs: `tmp/storage-gzip-bounded-integration-node24.log`, `tmp/storage-bounded-gzip-tsc-node24.log`. No heavy native benchmark or concurrent full gate was run by this owner.

## Frozen hashes

| File | SHA-256 |
| --- | --- |
| `src/domain/storage/boundedExactText.ts` | `119e2e404f2708b54870ebf81da1ff687a19304dc0e253c04ef2a1193c926e3c` |
| `src/domain/storage/__tests__/boundedGzipReads.test.ts` | `e86c365bc693dffeebab98f29eb77e06de002930d3185913e844c68f184a5726` |
| `src/domain/storage/__tests__/workbenchRecovery.test.ts` | `158c8016a6b56700d5094675316c4b81d0848f833a154708ff5a0cb70abc530f` |
| Shared decoder observed: `src/domain/storage/exactTextStream.ts` | `1af5783ecb332d283c8b60c3ffc9533ab265ef1635c731f28b05a1742f35c9d5` |

Tree owner received this frozen slice for independent review. Root owns the combined current-source build/browser/release gate and public compatibility wording.
