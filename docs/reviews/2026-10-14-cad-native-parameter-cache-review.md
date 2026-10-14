# Native parameter cache review

Scope: the active-parameter projection and explicit query environment in `cadKernelRuntime.ts` and `cadKernelModel.ts`, independently reviewed by the root agent after the native agent's implementation. This does not close the overall CAD hardening goal.

## Decision

No actionable defect found in the scoped change. The runtime validates the complete document before deriving the geometric cache key. It reuses the existing domain usage inspector rather than reimplementing plugin rules. A generic recipe's disabled editing field remains a geometric dependency. A known built-in automatic input is excluded only while inactive, and any other active use of the same parameter keeps it in the key.

The parameter projection is sorted by name. Feature definitions stay conservatively complete, apart from the previously reviewed nongeometric contour labels and dimension intent. Changing a real driver, an input expression, a mode, suppression, placement, feature name or native source still invalidates geometry. Feature names remain current in mesh/STEP output. The complete accepted-document key continues to own topology queries, so reuse does not authorize queries against an older document.

The retained model's original parameter map is immutable. Sections and pick resolution receive the current validated request map explicitly. Direct model calls retain their original default map. Successful queries adopt the complete current key; rejected sections/exports preserve the prior accepted model, key and picks. Explicit Build retains its existing diagnosed-prefix behavior.

## Evidence and boundaries

- Native agent established seven failures before the change and passed 67 focused tests across parameter/cache/model/topology suites afterward, with application TypeScript and scoped diff checks.
- Root inspected the production changes and six new real-native cache cases: unused/reordered stock values, local versus linked gear module, dormant built-in and shared active uses, disabled generic recipe input, current query-only named offsets, rejected query ownership and immutable direct-model defaults.
- Local paired measurements and fixture details are in `2026-10-14-cad-unused-parameter-cache-investigation.md`. They measure avoided reconstruction, not reduced modeling accuracy.
- Default gear STEP output exceeds the existing 2 MiB application import boundary. That output was checked for native structure and retained exact material; it was not falsely reported as a supported application reimport. A bounded stock fixture independently verifies STEP roundtrip volume.
- Root's broader native rerun is recorded separately in the active checklist once complete. UI/plane/scalar work continuing in other files is outside this review.

## Reviewed source snapshot

| File | SHA-256 |
| --- | --- |
| `src/features/cad/kernel/cadKernelRuntime.ts` | `845e48098e57758ee093a5d0a159c6b903db998c9179bb9748cb2175079f3d4d` |
| `src/features/cad/kernel/cadKernelModel.ts` | `644538ac87da165572bcb14d3c3fb4fa790efaf8bed5f3d9e55ff5bd868a8f43f` |
| `src/features/cad/kernel/cadKernelParameterCache.test.ts` | `91e25d721833a2607f5c636b08c003a2d8418068cddf1bf6b3df6b6979a70ed6` |
| `src/domain/cad/cadParameters.ts` | `f3de515c66738e44ecfafabe767fa209e5a1c722d500fe899069beacb6d47b5d` |
