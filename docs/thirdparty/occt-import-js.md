# Local STEP importer: third-party record

The local STEP importer uses the unmodified `occt-import-js` npm package at exactly
`0.0.23`. The JavaScript loader and WebAssembly binary run in a disposable worker.
Files chosen by the user are not sent to these source locations or any server.

## Source and licenses

- Importer source: <https://github.com/kovacsv/occt-import-js/tree/c2148e54b456b571238d35cac037d304053d64b2>
- Importer source archive: <https://github.com/kovacsv/occt-import-js/archive/c2148e54b456b571238d35cac037d304053d64b2.tar.gz>
- OCCT submodule source: <https://github.com/Open-Cascade-SAS/OCCT/tree/d2abb6d844231cb8f29be6894440874a4700e4a5>
- OCCT source archive: <https://github.com/Open-Cascade-SAS/OCCT/archive/d2abb6d844231cb8f29be6894440874a4700e4a5.tar.gz>
- The submodule commit above was read from the importer source tree at its npm
  `gitHead`, not inferred from the upstream default branch.
- The importer is GNU LGPL 2.1. OCCT is GNU LGPL 2.1 with the Open CASCADE exception
  version 1.0. The exception concerns incorporated header material and does not
  replace the LGPL covering the library binary itself.
- OCCT contains copyright notices for OPEN CASCADE SAS and other contributors,
  including historical Matra Datavision code; retain the notices in the source.

Verbatim license texts from the installed package and the pinned OCCT exception
are included in `src/features/simulation/machine-import/notices/`. The
`MACHINE_IMPORT_THIRD_PARTY` export provides local license asset links and source
links for the hosted import UI. No library changes have been made.

Installed upstream artifact SHA-256 values (before bundling):

- `occt-import-js.js`: `3fb44ce11d00611f9b3f3c5775d520ebab48930c1f08279b7b1316f05f0d3379`
- `occt-import-js.wasm`: `33391fc9d94ea5c869a6718488bf0a9a464222bac9bdc764dfe1690cef281952`

The authored tetrahedron fixture in the importer tests belongs to this project;
it was not copied from the parser's upstream test files.

## Distribution checkpoint

This change does not deploy the app. Before distributing its JavaScript/WASM,
retain the prominent library notice, full license texts and exception, and
provide the complete corresponding library source and build scripts through an
equivalent download location with the distribution. The importer source archive
does not embed its OCCT Git submodule: the separate pinned OCCT source is also
required. Preserve the unmodified binary provenance and include any future
patches and rebuild instructions. Source links above are provenance references,
not a substitute for completing that release distribution step.

Consumers must remain able to modify the LGPL libraries and rebuild/relink the
application; do not add terms preventing reverse engineering for debugging such
modifications. The project source and package lock identify the integration.

## Import and collision limits

Only STEP with a referenced, recognized length-unit context is accepted. OCCT
converts to millimetres; BREP is deliberately excluded because its parser ignores
the requested output unit. Supported STEP assemblies preserve names, surface
colours, grouping and authored placement.

The parser can recover usable surfaces from some semantically damaged STEP
files. Validated triangulated output is not evidence that every original surface
was recovered or that the assembly is a closed solid. Collision messages state
this limitation. Validation rejects malformed envelopes, missing unit contexts,
unreadable output, invalid numbers/indices/hierarchies and budget overruns.

Input is limited to 25 MiB. Post-triangulation limits are 1,000 meshes, 1,000,000
vertices, 500,000 triangles, 10,000 assembly nodes and 64 hierarchy levels. Worker
termination enforces cancellation and a 90-second elapsed deadline. These output
limits cannot cap transient native allocations inside an individual OCCT parse.

The geometric query checks zero-radius wire surfaces against the imported mesh;
it does not prove finite wire or guide clearance, solid containment, or model
completeness. Arc queries conservatively expand each rendered chord by its
maximum circular sagitta and label bounds-overlap findings as approximate.
