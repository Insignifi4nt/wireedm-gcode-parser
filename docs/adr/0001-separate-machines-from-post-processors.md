---
status: accepted
---

# Separate machine definitions from post processors

Wire EDM Workbench will keep physical machine facts in machine definitions and all controller syntax, sequencing, formatting, and dialect semantics in independently versioned post packages. Machines reference any number of exact post installations through bindings, while controller export compiles only persisted job revisions and snapshots the selected binding so library edits or removal cannot silently change reproducible output.

## Consequences

- UPID documents and execution plans remain controller-neutral; choosing a post is not required to import or edit a design.
- Selecting a machine early may provide work-envelope and hardware-capability feedback, but it must not inject controller commands or dialect defaults into the design.
- The workbench stores post packages once in a global versioned library. A machine owns bindings and property values, not copied post source.
- Multiple versions of the same post may be installed and bound to one machine simultaneously. Export never resolves an unversioned "latest" post.
- A saved job revision snapshots the exact selected post package, content hash, properties, and verification state. Generated controller text is an artifact, not editable source state.
- Extension and line ending remain host file-writing preferences. They cannot alter generated program semantics.
- The replacement uses new authoritative schemas and APIs without a legacy compatibility layer. Obsolete persisted data and unresolved references fail with actionable errors rather than being normalized, inherited, or assigned a fallback.
- Bundled examples remain ordinary package files. They install, conform, execute, fail, and can be removed through the same interfaces as uploaded packages. Application code contains no controller renderer or built-in dispatch registry.
