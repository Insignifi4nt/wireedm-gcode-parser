# CAD worker and native traversal resource review

Review date: 2026-10-14. Fixed baseline: `09795ec5e0e404f5ce69ff2173dea119a69f66ce`. Scope: the parent's worker lifetime/deadline/redundant-clone changes and indexed-map subshape traversal. This addendum complements the local-resource audit; it does not repeat whole-CAD validation or certify browser/native peak memory.

## Confirmed P2: the traversal map was acquired outside its cleanup scope

`subshapes` constructed its native indexed map before evaluating `shape.wrapped` and before constructing `TopExp_Explorer`. Either failure bypassed the later `try/finally`, leaving the acquired map unreleased. Two real-native regressions injected those failures and observed an acquired map in each case; both failed before repair. Test cleanup explicitly released captured resources so the failing reproduction itself did not leak them.

Traversal now constructs the explorer first, then constructs the map inside the explorer's protected scope, with a nested map `finally`. A failing shape getter or explorer constructor therefore acquires no map. A third regression verifies that a failing map constructor releases the already-created explorer. Existing failure cleanup still releases partially returned wrappers. Borrowed source geometry remains valid; no new exception path nullifies it.

Indexed-map lookup still resolves native hash collisions with `IsSame`, including locations. It retains explorer order and distinct located instances. The regression suite preserves duplicate shared topology versus independently placed solids, all 3,072 edges/1,536 faces/256 solids in the larger fixture, repeat traversal, source validity and disposal independence. The change does not add a count limit or rely on JavaScript finalizers.

## Worker conclusions

Removing the two-minute timer and 16/128 job recycling/rejection rules does not relax request/response identity. The queue remains finite and serial; active Abort terminates the worker, queued Abort removes only its job, failure restarts for the next job, and disposal rejects retained jobs. Old transport callbacks are ignored after replacement; mismatched response IDs/build/body/purpose cannot publish newer geometry or lend valid picks to another build.

The removed explicit `structuredClone` was redundant at the request boundary. Mutable documents are captured and deeply frozen by `parseCadDocument`; only outputs held in its private successful-output WeakSet can use the fast path. Solid/DXF/Curve input parsers create detached frozen records containing their primitive strings/options. Topology selectors capture/freeze their complete data, and sections are still detached. Caller mutation after queueing therefore cannot alter the eventual request. Worker `postMessage` still performs the realm crossing. This review found no new actionable input-ownership or stale-result defect in the changed client.

Exact imported byte counts now use validated nonallocating length calculation for reply matching. Malformed replies still terminate the worker; a valid large import result cannot be rejected merely because its solid count or source size crossed the former import policy. Native topology pointers, strides, index ranges and finite buffer contents remain checked even when display-size policy is removed.

Long-job/lifetime tests use controlled transports and virtual time: they prove that an eight-minute healthy export remains pending until a matching reply, then subsequent work can still be cancelled; 32 builds and 128 inspections retain the same healthy worker and export its exact cached build. They do not claim an eight-minute native benchmark or unlimited physical worker memory. Parent native-stability checks remain separate evidence.

## Verification

- Before the ownership repair: **3 new tests failed**; the existing traversal tests passed. The first two reproduced the unprotected acquisition; the third protects correct cleanup after reordering acquisitions.
- Combined shapes, native ownership, client and local-resource verification: **27 tests in 4 files passed**, 2.41 seconds.
- Shared storage/CAD save-load run from the companion audit: **160 tests in 10 files passed**. Its source remains frozen and was not changed during this native repair.
- `npx tsc -b --pretty false` and scoped diff check passed after the acquisition repair. The parent's final production/browser/native gates remain separate.

Reviewed source SHA-256 identifiers:

| File | SHA-256 |
| --- | --- |
| `src/features/cad/kernel/cadKernelClient.ts` | `D0A894FE5A53040D3002A112654C38AD4F3BAD581A7A58C291618E2B3799E54E` |
| `src/features/cad/kernel/cadKernelShapes.ts` | `BB7D1B60215489815D5B122CABE0F8EA0E9BC5178F956DA95B3A8F346FA693FE` |
| `src/domain/cad/cadSchema.ts` | `0363ABA4CBCAD571355CA9933F005D47F98AA6DCEFD5293164D9B308F5C98BF6` |
| `src/features/cad/kernel/cadKernelProtocol.ts` | `4462C07C3098338480D65709BE34A53BA18D80E04625E5435FE62AF986017FE8` |

No client production code, UI, public guide, server, commit or overall goal status was changed by this independent review. The only production repair is deterministic native traversal acquisition/cleanup.
