# Wire EDM Machine Package and Post Processor Specification v1

## 1. Scope and authority

This specification defines the complete portable machine package accepted by Wire EDM Workbench and the post processors contained by it. It is written for coding agents and humans producing a package from machine and controller evidence. It does not define a universal G-code dialect.

The key words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative only when capitalized, as described by RFC 2119 and RFC 8174.

Authority is ordered by concern, not by file priority:

1. `schema/post-package.schema.json` governs serialized shape.
2. the package semantic validator governs references, evidence scope, property coherence, and execution-contract coherence;
3. the post runtime API governs executable behavior;
4. the conformance runner governs fixtures, event coverage, trace integrity, determinism, and resource limits;
5. this document governs requirements that cannot be expressed by those executable contracts.

Generated schemas, declarations, catalogues, examples, prompts, and `AGENTS.md` files cannot weaken an executable contract. A disagreement MUST stop generation or installation; an implementation MUST NOT choose a fallback interpretation.

## 2. Design boundary

The application compiles controller-neutral UPID into an ordered execution plan. The compiler owns geometry, operation order, passes, entry and exit motion, threading intent, wire separation, program stops, compensation intent, and source trace. A post owns controller words, command ordering, modal state, formatting, and controller-specific lifecycle rules.

A post MUST NOT:

- change, heal, reorder, omit, or invent cutting geometry;
- choose an unspecified machine, setup, coordinate mode, unit mode, compensation side, offset, thread action, or output rule;
- infer one controller's command meaning from another controller;
- emit a machine-ready artifact after a parse, capability, lifecycle, trace, audit, resource, or determinism failure.

Names such as `distance.absolute` and `compensation.finish` are semantic vocabulary identifiers. They do not imply a G-code word. For example, a package may associate `distance.absolute` with `G90` only when its target controller evidence supports that association. The application assigns no global meaning to `G60`, `G90`, or any other controller token.

## 3. Identity and immutability

A package identity is the tuple `(manifest.id, manifest.version, canonical content SHA-256)`. Every machine setup MUST reference that exact tuple. `latest`, version ranges, filename identity, mutable aliases, and same-version content replacement are forbidden.

The package `schemaVersion` and `manifest.engineApiVersion` MUST be supported exactly. Unsupported versions MUST produce a version error; they MUST NOT be normalized, migrated, or interpreted as a nearby version.

Changing code, dialect declarations, evidence, fixtures, properties, capabilities, targets, or execution policy changes package content identity. Such a change SHOULD also receive a new semantic version.

## 4. Dialect vocabulary

Every controller command emitted by a post MUST be registered under `dialect.commands` with:

- a stable semantic command ID;
- one single-line template;
- closed, typed parameters;
- modal state preconditions in `requires`;
- modal state effects in `effects`;
- at least one evidence reference.

Every parameter declaration MUST include a closed semantic `role`. Non-motion parameters use `none`. Motion endpoints use `motion.end-x` and `motion.end-y`; circular centers use `motion.center-x` and `motion.center-y` plus an explicit fixed or property-driven absolute/incremental reference. The engine MUST derive the structured motion trace from the formatted, quantized values actually substituted into the template. Parameter names are never interpreted as geometry.

Circular commands MUST declare `arcDirection` as `clockwise` or `counterclockwise`, supported by the command's evidence. The engine MUST derive controller direction from the selected command, not copy the requested event direction or infer it from command IDs or controller words. Declaring `arcDirection` requires both endpoint and both center roles. For stored v1 compatibility this field is schema-optional: older packages and saved snapshots without it remain parseable, but selecting such a command for circular motion MUST fail with an actionable diagnostic. No direction is inferred and no stored content is rewritten.

Command IDs describe intent, not spelling. Templates contain controller spelling. A post MUST NOT emit an unregistered controller command. A command MUST NOT be emitted when its declared preconditions are false. Conflicting or incomplete state transitions MUST fail the run.

Dialect state starts empty for each run. State tokens are package-owned identifiers. The runtime checks every `requires` token before rendering that command, then applies its `effects` in emission order. Most effects remain set for the rest of the run. The host reserves only the audited lifecycle groups: `compensation.left`, `compensation.right`, and `compensation.off` replace one another; `wire.separated` and `wire.threaded` replace one another. Version 1 has no other implicit state clearing. A command author MUST declare the state transition that its evidenced controller word actually performs and MUST NOT use an unrelated effect only to satisfy the schema.

Property values are supplied by an exact machine setup. Required values MUST be present and valid. Suggested values are authoring hints only; the engine MUST NOT substitute them for missing setup values.

## 5. Evidence

Every command MUST be supported by evidence applicable to the declared controller target. Evidence MUST identify its source, a stable content digest, a selector, a concrete claim, supported command IDs, target applicability, and review state.

Manufacturer manuals and controller references SHOULD be preferred. A verified program or operator test MAY supplement them but MUST record when and how it was obtained. An agent MUST NOT fabricate a source digest, page, quotation, review, machine test, or firmware range.

Cross-controller inference is prohibited. Similar spelling is not evidence of equal semantics. If the available material does not establish a required command or lifecycle, the package MUST remain incomplete and conformance MUST fail with a specific diagnostic.

Documentation evidence and physical verification are separate. Passing schema and conformance proves contract compliance and reproducibility; it does not prove that a program is safe on a physical machine. New and changed setups remain `unverified` until an explicit verification record covers the exact machine hash, post hash, and property hash.

## 6. Capabilities and execution lifecycle

`manifest.capabilities` declares what the post can acknowledge. `manifest.execution` declares lifecycle constraints. Both MUST describe the implementation completely and consistently.

`controller-native-continuous` declares that a controller-native compensation state may span operation boundaries. The post MUST retain that state only for an explicit `wire-continue` transition, MUST validate that the next operation is compatible with the retained state, and MUST reject unsupported side changes or wire-separation/threading transitions atomically.

The engine delivers events in plan order. Every event MUST receive exactly one disposition:

- `emitted`, with the exact output block IDs caused by that event; or
- `consumed`, with a non-empty reason explaining why no controller block is required.

Each `program-stop`, `wire-separate`, and `wire-thread` event MUST emit its own command declaring `program.paused`, `wire.separated`, or `wire.threaded`, respectively, and leave that state active when its callback returns. Consuming the event, emitting an unrelated command, or relying on an earlier event's effect MUST fail. These effects describe manufacturing actions, not controller-specific word meanings.

Motion and positioning events MUST preserve their structured motion trace. One neutral motion MAY emit one block or a continuous sequence of blocks. A composite linear sequence must preserve its endpoints and total path length, remain within the source segment's positional corridor, and progress monotonically without reversal or overshoot. A composite circular sequence must preserve continuity, center, radius, direction, endpoints, and total swept angle. An emitted circular block is a full circle only when its quantized start and end coordinates coincide exactly; positional audit tolerance MUST NOT classify a short or near-complete arc as a full circle. This also applies to fragments split by program stops. This permits package-owned full-circle splitting without controller logic in the application. Consuming a required motion event, changing its geometry, or emitting an unaudited motion MUST fail.

The post MUST end with all lifecycle state in the state required by its execution contract. Pending positioning, compensation, threading, program termination, or an unacknowledged event MUST fail. Partial output from a failed run is diagnostic data only and MUST NOT be downloadable as a machine-ready artifact.

## 7. Source program

`source.code` exports exactly one binding named `createPost`, as defined by the generated SDK declaration. The source receives only the documented deterministic host API. It MUST NOT depend on network access, browser APIs, local storage, wall-clock time, randomness, locale, ambient machine state, dynamic imports, or undeclared files. The generated event and diagnostic catalogue lists the globals removed from the guest and the exact default runtime limits.

`createPost(api)` MUST return exactly `{ onEvent(event) }`. The engine calls `onEvent` synchronously once for each neutral event in plan order. During that call the handler MUST use one of these dispositions:

- one or more `emitCommand(commandId, parameters)` calls for non-moving commands during a non-motion event;
- one or more `emitMotion(commandId, parameters)` calls for a motion or positioning event; or
- one `consume(reason)` call for a non-motion event that requires no controller block.

`getProperty(name)` reads only an explicitly bound property and may be called during `createPost` or `onEvent`. Missing properties are errors; suggested values are never substituted. Emit/consume calls outside the active `onEvent` call, mixed dispositions, consumed motion, unknown commands, undeclared or mistyped parameters, false state preconditions, or invalid effects fail the complete run.

Every motion-producing command MUST declare its endpoint roles and use `emitMotion` during a motion or positioning event. `emitCommand` MUST reject any command with motion roles, `arcDirection`, or the `position.changed` effect. Declaring a moving controller command as non-moving violates the package's evidence contract; the engine does not parse controller words to infer undisclosed motion.

Package source is executed in a fresh isolated runtime and context for every run, with imports and ambient host capabilities disabled and explicit memory, stack, interrupt-cycle, wall-deadline, event, action, and UTF-8 output-byte limits. Successful conformance repeats execution in another fresh runtime and requires an identical structured result. Every package uses this exact execution path and MUST pass all declared fixtures against the canonical fixture registry before installation. Execution failure returns structured diagnostics without a partial program; it MUST NOT select another package or implementation as a substitute.

Every number parameter MUST declare its spelling through the closed v1 number-format object. Version 1 supports fixed fractional digits, a `.` or `,` decimal separator, optional trailing-zero trimming, and explicit negative-zero handling. Fractional digits MAY be a fixed integer or an exact integer setup property constrained to the inclusive range 0 through 12. The runtime derives motion trace from those formatted numeric values, including endpoint and center quantization, and carries the previous emitted endpoint into the next motion. Rounding that changes the path beyond its audit tolerance MUST fail. A controller requirement outside the closed format schema is not representable in v1. The author MUST report that limitation and MUST NOT approximate the required spelling.

## 8. Fixtures and conformance

Each fixture binds an exact plan-fixture ID, a complete property set, exact expected logical program text, exact final controller artifact text, and evidence references. `expectedArtifact` is compared after the post-owned envelope, numbering, encoding, line-ending, and final-newline rules are applied; it therefore preserves CRLF and the final newline inside the JSON string. A package MUST cover every declared command family, capability, lifecycle branch, property boundary, output rule, and known failure mode across its fixtures.

Conformance MUST perform, at minimum:

1. schema and semantic validation;
2. exact source, evidence, and command-reference validation;
3. property validation;
4. capability preflight;
5. isolated source execution within resource limits;
6. exactly-once event disposition validation;
7. command-registration and modal-state validation;
8. motion and source-trace audit;
9. exact fixture comparison;
10. repeated-run determinism comparison.

Any failure produces a non-zero result and structured diagnostics. Conformance MUST NOT rewrite the package, insert properties, skip fixtures, normalize expected output, retry through another post, or downgrade an error to a warning.

The checked-in canonical registry is the complete fixture input available to installation conformance. Its exact plans are published in `sdk/canonical-plan-fixtures.json`, and its IDs are repeated in `compatibility.json`. The runner rejects declared commands and positive capability claims that no successful fixture exercises. It also checks boolean choices, every declared choice, and explicit minimum and maximum values for bounded integer and number properties. These executable checks do not establish complete string-boundary, lifecycle-branch, or known-failure coverage. An author and reviewer MUST compare the remaining package claims with its declared fixtures. If the registry cannot exercise a claimed capability, lifecycle branch, property boundary, or known failure, the package is incomplete even if its declared fixtures pass.

## 9. Controller-file ownership

Every post manifest MUST declare the complete controller-file rules: `fileExtension`, `lineEnding`, `encoding`, `finalNewline`, `blockNumbering`, and `programEnvelope`. Sequential numbering declares an alphabetic prefix, start, positive increment, and minimum width; `none` is explicit. The envelope declares zero or more exact prefix and suffix lines, such as a controller-required `%`. These rules are immutable parts of post content identity. The workbench, editor, and download flow MUST NOT ask the human to configure them or apply a second transformation.

`ascii` output MUST fail if the generated program contains a non-ASCII code point. `utf-8` output MUST use UTF-8. Line endings and final-newline policy apply to the generated artifact bytes and exact preview. Changing any rule requires changed post content and SHOULD receive a new semantic version.

## 10. Complete machine-package transport

The only human-installable artifact is a ZIP archive with the `.wireedm-package` extension. It MUST contain exactly one root `wireedm-package.json`, one complete machine definition, one or more complete post processors, one complete setup for every included post, one selected `activeBindingId`, and every referenced evidence file. Loose `.wireedm-machine.json` and `.wireedm-post.json` files are authoring inputs only.

The source-directory form uses `machine-package.source.json` to reference the machine and post inputs. The build command MUST resolve all paths within that directory, MUST reject traversal and escaping symlinks, and MUST produce a deterministic archive. The install archive MUST reject absolute, backslash, empty-segment, dot-segment, or parent-segment paths; more than 33,554,432 compressed bytes; more than 67,108,864 total expanded bytes; more than 2,048 entries; missing, changed, or unreferenced files; malformed or duplicate requirements; dangling setup references; target mismatch; and any post that fails conformance.

The generated `sdk/canonical-installation-scenarios.json` registry defines the normative valid-new, invalid-target, same-ID machine-update, post-version conflict, and same-machine/new-post fixture recipes. Implementations and authoring agents SHOULD apply those recipes to the referenced complete example, recompute declared hashes where instructed, and verify the exact expected classification or diagnostic before publishing an installer workflow.

The package machine definition MUST repeat the full physical machine even when the package exists only to add a post version. Every included setup MUST bind an exact `(post ID, version, canonical content SHA-256)` and provide all required properties and an explicit compatibility acknowledgement. Package completion MUST NOT rely on a human entering raw IDs, JSON properties, output settings, or compatibility fields after installation.

Installation is previewed, then committed atomically. Exact physical machine definitions are reused. A same-ID physical change MUST show field-level changes and require an explicit update. A similar machine with another ID MUST be shown as a possible match and MUST NOT merge automatically. Exact post content is reused; the same post ID and version with different content MUST be rejected and require a version change. A machine may own multiple exact post-backed setups and post versions, with one active setup for new exports. Failure MUST leave both machine and post catalogs byte-for-byte unchanged.

## 11. Saved revisions and artifacts

Controller output is generated only from a persisted, validated saved job revision. That revision snapshots the UPID, neutral execution plan, physical machine, exact machine setup and verification state, exact package, resolved properties, engine version, and content hashes.

Reopening stored post libraries MUST validate package structure and semantics and verify the exact canonical content hash and reference without rerunning installation conformance. Legacy snapshots remain readable for inspection even when stricter execution audits reject generation. Installation and execution remain strict. Updating an older arc package requires a new post version and exact setup reference; existing installations and saved revisions MUST NOT be silently rewritten.

Version-1 workbench migration MUST preserve each original manifest and project byte-for-byte under `legacy/v1/` before replacing editable project records. Migrated projects MUST NOT reinterpret embedded legacy controller configuration as an evidenced complete package; the preserved originals remain the recovery source for prior templates, machine profiles, and output settings. Empty legacy path and machine-program projects MUST remain openable after migration.

File extension, line ending, encoding, and final-newline policy come only from the exact snapshotted post. Draft editor state, a missing active setup, a dangling post reference, a modified package, a non-representable encoding, or a hash mismatch MUST stop generation with a specific error.

## 12. Agent completion criteria

An authored package is complete only when the agent has:

- recorded target controller and firmware scope without inference;
- added source records and command-scoped evidence;
- declared complete capabilities, execution policy, properties, and dialect state;
- implemented the documented runtime API without ambient dependencies;
- added meaningful exact fixtures;
- created the complete machine definition and exact setup properties;
- declared all controller-file rules in the post manifest;
- run schema generation, post conformance, package build, package validation, and package inspection successfully;
- reported unresolved evidence or physical-verification limits explicitly.

If any required input is unavailable, the agent MUST ask the human to attach or identify it and MUST stop before building. The agent MUST NOT claim physical verification from conformance alone.
