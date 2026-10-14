# Independent review: retained native source proposal

2026-10-15. Read-only review of `2026-10-15-cad-native-source-reuse-proposal.md` (SHA-256 `21DD61575E112045A18D5E815091DC51F57A22929FED314717D9C43D55C2002E`) at current `70f45e978c77c67cc3f6f73e2822c5684daba11d`. The proposal's measured checkpoint is `a021bbcce199f3a737610977bb74a1bdf6c5e3f1`; all 16 source/probe/fixture entries still match `tmp/cad-native-source-reuse-audit-hashes.json` (SHA-256 `793F1340D1B74BBF4795E98576D2011641DF6C6F6167AA7446D0E98EA0A73FA1`). No production, tracked test, package, server/build/browser, commit or capture-source changes by this reviewer.

## Verdict and native evidence

**The rejection decision and conditional investigation are sound. This does not approve a cache implementation or certify the proposed copy primitive.** Distinct topology and successful volume/Cut checks cannot establish independently owned mutable geometry.

Independently replayed only the preserved box/cylinder prefix of the identity-transform probe, on Node24.22.0 with the pinned installed WASM. Box pcurve remains `[2.5,0]`; cylindrical pcurve changes on the original from `[π,5]` to `[π+7,5]` after mutating the copied pcurve. The unchanged native rejection occurs at the original assertion, expected process exit1. No large STEP import, timing loop or original report rewrite was run. Ignored derivative `tmp/cad-native-identity-copy-pcurve-independent.ts` SHA-256 `ECC75576227154B0900C01DD2BEBC01178910B9EB3A7026695995F66739A6EBD`; log SHA-256 `B4A8189DA2A6966C7455BBE48B9F0E9A4F81EEACC970BCA3C85E3637DABF0308`.

Pinned upstream source agrees: transform's nonplanar pcurve path invokes SameRange, whose matching-range branch reuses the original handle. The separate copy modification explicitly copies pcurves when geometry copying is enabled, copies geometry/mesh objects on their corresponding routes and preserves vertex/tolerance values. That makes true Copy a reasonable next candidate, while each concrete geometry class still needs exactness/independence tests. [Transform modification](https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/b8f597c677811d1f9f4d8a97f5ae2825c0353a42/src/ModelingData/TKBRep/BRepTools/BRepTools_TrsfModification.cxx), [SameRange](https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/b8f597c677811d1f9f4d8a97f5ae2825c0353a42/src/ModelingData/TKGeomBase/GeomLib/GeomLib.cxx), [copy modification](https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/b8f597c677811d1f9f4d8a97f5ae2825c0353a42/src/ModelingData/TKBRep/BRepTools/BRepTools_CopyModification.cxx).

The sealed BRep probe and its numeric-token/volume evidence support rejecting serialization as an unchanged native copy; it was reviewed without duplicating the gear benchmark. Seventeen-digit output alone cannot prevent numeric reconstruction changes. The installed declarations mention Copy in documentation but expose no callable class. Installed JS `5BA5161518781C04AF771AE4E841956613DDE4E679766DDAAEB581B778E1A8BE`, declarations `28AE81BD478D13E1ABB3A1F2C908666250C670D7C2AAC2CC2A70F4AB5E951FCD` and WASM `F3315403717F650C207ECCD2F372AFC380005B4F219BAD31991D6F115FDC1744` match the recorded ownership build. No alternate binding/copy was installed or implemented.

## Ownership and adoption boundary

The proposed narrow model import loader fits current ownership: `Model` adopts and later consumes/disposes caller-owned shapes; `Shapes` may Nullify a consuming-operation alias of the very same native wrapper. A retained original must never be passed into either path. Import analysis bounds/metadata returned to callers need detached ownership and current filename metadata. Source-key validation must still precede reuse; format/encoding/exact contents and STL units remain distinct. No filename shortcut, persisted BRep trust, full-key relaxation or older-build pick reuse is justified.

Two contract clarifications were raised and agreed with the proposal owner:

- **Runtime-current**, rather than human-accepted: Runtime knows its successfully adopted request/model, including a private preview's provisional document and a diagnosed Build prefix. It has no human Apply/Cancel or saved-state signal. Source retention must follow that same per-runtime adoption lifecycle and die with runtime/worker disposal.
- **Import preflight remains temporary:** `import-solid` currently prepares analysis then disposes its shape without adopting a document/model. A successful but unconfirmed import must not seed inactive retained originals. The new loader seam belongs to document/model construction; preflight remains uncached/caller-owned.

A source transaction must preserve the existing read-only query boundary: hold old originals/model/picks while constructing candidate-owned additions; only successful Section/Export adopts and prunes. On a rejected query, dispose candidate models and candidate-only originals, keeping the old complete key and picks. A document-ID switch needs a cold candidate scope without destroying the previous scope until adoption; ordinary Build may still adopt its diagnosed prefix under existing policy. Do not change cancellation/stale-worker behavior simply to keep a cache warm.

Independently ran the five existing real-native Runtime cases for rejected section queries and diagnosed Export versus explicit Build adoption: **5 selected passed**, seven other cases not selected, Node 24.22.0, 3.27 s. Log `tmp/cad-native-source-reuse-independent-runtime.log` SHA-256 `43458C269DF8A04C7FDBDF8EF8EE9C56595D70A2C1B3F73F3F89A73FDE747D2C`; unchanged test SHA-256 `7E2E7C2AD818AD3C0CA7813EBA7E8669AEEC479280B830EFA6BEFB5A04A81F07`. These verify the current boundary, not future cache behavior.

## Remaining acceptance risk

True-copy exactness remains unproven until the binding and all relevant surface/curve/pcurve/location/tolerance/triangulation tests run. The proposal correctly requires those before runtime reuse. Retained pristine originals plus independent model copies also increase native working set; read-only rollback temporarily holds old and candidate stores/models. The serial 100 MiB copy observation cannot certify that peak. The owner was asked to include multiple unique active sources, duplicate-source reuse, failed-query rollback, switch and disposal peak accounting in the future candidate plan. No substitute geometry, eviction quota or fallback implementation is proposed here. Existing cancelled workers also make reuse cold, so measured copy cost is not a complete live-preview latency promise.

| Reviewed production source | SHA-256 |
| --- | --- |
| `cadKernelRuntime.ts` | `845E48098E57758EE093A5D0A159C6B903DB998C9179BB9748CB2175079F3D4D` |
| `cadKernelModel.ts` | `C5C0E645D3994A51489252019C3AE07C942FEBE95796C60E92C1185780BEF594` |
| `cadKernelImport.ts` | `5BF74BC745FEC580F8C9D54F73673E0035ED04E86B53A67EE579931077BBEF63` |
| `cadKernelShapes.ts` | `BB7D1B60215489815D5B122CABE0F8EA0E9BC5178F956DA95B3A8F346FA693FE` |

No current production defect or additional code change is established by this review. The frozen proposal remains unchanged. The runtime lifecycle clarification is agreed; the peak-memory condition is reported for the separate next investigation plan. Overall CAD work remains active.
