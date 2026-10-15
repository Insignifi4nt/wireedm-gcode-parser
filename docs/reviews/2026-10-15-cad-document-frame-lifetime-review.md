# Solid camera lifetime on document replacement

Opening a different saved part retained the preceding solid viewport's camera and first-fit flags. The mounted real Workbench/Three/OrbitControls regression projects a newly opened large part corner to x=5852.6566 in an 800-pixel viewport before the repair (`tmp/cad-document-frame-red.log`).

The production repair adds only `key={document.id}` to `CadViewport`. Camera ownership now follows document identity, as the sketch viewport already does. Same-document edits, provisional previews, inspector changes and Cancel keep the existing viewport/camera.

The existing controller opening operation replaces the document and clears the accepted build together; native publication additionally checks abort and the exact session version. The regression includes the intervening empty-mesh scene, proving a preceding solid cannot consume the new viewport's initial solid fit. A reference-only initial frame and the first solid already have separate fit flags; no new camera policy is needed.

Two mounted regressions use real public controls, scene uploads, domain/session history, feature editor and capture guards; only unavailable WebGL rendering/raster adapters are replaced:

- Small → larger offset document → small: actual geometry fits unobscured viewport pixels after each document's mesh arrives, and public capture carries the current document/version/build/selection identity.
- A human wheel zoom survives a same-document accepted rebuild, inspector opening, actual numeric preview showing depth40, and Cancel restoring depth18. Camera values and original session/history remain exact.

Node24.22 checks: focused Workbench/Viewport/depth/new regression suites **130/130**; final two-case replay **2/2**; `npx tsc -b --pretty false` and scoped `git diff --check` pass. Logs: `tmp/cad-document-frame-focused.log`, `tmp/cad-document-frame-green-final.log`, `tmp/cad-document-frame-types-final.log`.

Frozen source SHA-256: Workbench `D0EEBBF0BEE8ACFFD9A82DA254BC9B391738DAC8035AD4795EA1B509772602E5`; regression `372DDD4FE32DD8066907E991EF24B5073A7F422BF57D422270C47925411B8EC4`. `tmp/cad-document-frame-freeze.json` seals the source/record/logs. Independent review and actual browser confirmation belong to the parent checkpoint; no build, server, native/cache change or publication was performed in this slice.
