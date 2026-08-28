# Wire EDM Post Package Specification v1

## 1. Scope and authority

This specification defines the portable input accepted by Wire EDM Workbench's post platform. It is written for coding agents and humans producing a post from controller evidence. It does not define a universal G-code dialect.

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
- choose an unspecified machine, binding, coordinate mode, unit mode, compensation side, offset, thread action, or output preference;
- infer one controller's command meaning from another controller;
- emit a machine-ready artifact after a parse, capability, lifecycle, trace, audit, resource, or determinism failure.

Names such as `distance.absolute` and `compensation.finish` are semantic vocabulary identifiers. They do not imply a G-code word. For example, a package may associate `distance.absolute` with `G90` only when its target controller evidence supports that association. The application assigns no global meaning to `G60`, `G90`, or any other controller token.

## 3. Identity and immutability

A package identity is the tuple `(manifest.id, manifest.version, canonical content SHA-256)`. Every machine binding MUST reference that exact tuple. `latest`, version ranges, filename identity, mutable aliases, and same-version content replacement are forbidden.

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

Every parameter declaration MUST include a closed semantic `role`. Non-motion parameters use `none`. Motion endpoints use `motion.end-x` and `motion.end-y`; circular centers use `motion.center-x` and `motion.center-y` plus an explicit fixed or property-driven absolute/incremental reference. The engine MUST derive the structured motion trace from those same numeric parameter values after template substitution. Parameter names are never interpreted as geometry.

Command IDs describe intent, not spelling. Templates contain controller spelling. A post MUST NOT emit an unregistered controller command. A command MUST NOT be emitted when its declared preconditions are false. Conflicting or incomplete state transitions MUST fail the run.

Dialect state starts empty for each run. State tokens are package-owned identifiers. The runtime checks every `requires` token before rendering that command, then applies its `effects` in emission order. Most effects remain set for the rest of the run. The host reserves only the audited lifecycle groups: `compensation.left`, `compensation.right`, and `compensation.off` replace one another; `wire.separated` and `wire.threaded` replace one another. Version 1 has no other implicit state clearing. A command author MUST declare the state transition that its evidenced controller word actually performs and MUST NOT use an unrelated effect only to satisfy the schema.

Property values are supplied by an exact machine binding. Required values MUST be present and valid. Suggested values are authoring hints only; the engine MUST NOT substitute them for missing binding values.

## 5. Evidence

Every command MUST be supported by evidence applicable to the declared controller target. Evidence MUST identify its source, a stable content digest, a selector, a concrete claim, supported command IDs, target applicability, and review state.

Manufacturer manuals and controller references SHOULD be preferred. A verified program or operator test MAY supplement them but MUST record when and how it was obtained. An agent MUST NOT fabricate a source digest, page, quotation, review, machine test, or firmware range.

Cross-controller inference is prohibited. Similar spelling is not evidence of equal semantics. If the available material does not establish a required command or lifecycle, the package MUST remain incomplete and conformance MUST fail with a specific diagnostic.

Documentation evidence and physical verification are separate. Passing schema and conformance proves contract compliance and reproducibility; it does not prove that a program is safe on a physical machine. New and changed bindings remain `unverified` until an explicit verification record covers the exact machine hash, post hash, and property hash.

## 6. Capabilities and execution lifecycle

`manifest.capabilities` declares what the post can acknowledge. `manifest.execution` declares lifecycle constraints. Both MUST describe the implementation completely and consistently.

The engine delivers events in plan order. Every event MUST receive exactly one disposition:

- `emitted`, with the exact output block IDs caused by that event; or
- `consumed`, with a non-empty reason explaining why no controller block is required.

Motion and positioning events MUST preserve their structured motion trace. One neutral motion MAY emit one block or a continuous sequence of blocks. A composite linear sequence must preserve its endpoints and total path length. A composite circular sequence must preserve continuity, center, radius, direction, endpoints, and total swept angle. This permits package-owned full-circle splitting without controller logic in the application. Consuming a required motion event, changing its geometry, or emitting an unaudited motion MUST fail.

The post MUST end with all lifecycle state in the state required by its execution contract. Pending positioning, compensation, threading, program termination, or an unacknowledged event MUST fail. Partial output from a failed run is diagnostic data only and MUST NOT be downloadable as a machine-ready artifact.

## 7. Source program

`source.code` exports exactly one binding named `createPost`, as defined by the generated SDK declaration. The source receives only the documented deterministic host API. It MUST NOT depend on network access, browser APIs, local storage, wall-clock time, randomness, locale, ambient machine state, dynamic imports, or undeclared files. The generated event and diagnostic catalogue lists the globals removed from the guest and the exact default runtime limits.

`createPost(api)` MUST return exactly `{ onEvent(event) }`. The engine calls `onEvent` synchronously once for each neutral event in plan order. During that call the handler MUST use one of these dispositions:

- one or more `emitCommand(commandId, parameters)` calls for a non-motion event;
- one or more `emitMotion(commandId, parameters)` calls for a motion or positioning event; or
- one `consume(reason)` call for a non-motion event that requires no controller block.

`getProperty(name)` reads only an explicitly bound property and may be called during `createPost` or `onEvent`. Missing properties are errors; suggested values are never substituted. Emit/consume calls outside the active `onEvent` call, mixed dispositions, consumed motion, unknown commands, undeclared or mistyped parameters, false state preconditions, or invalid effects fail the complete run.

Package source is executed in a fresh isolated runtime and context for every run, with imports and ambient host capabilities disabled and explicit memory, stack, interrupt-cycle, wall-deadline, event, action, and UTF-8 output-byte limits. Successful conformance repeats execution in another fresh runtime and requires an identical structured result. Every package uses this exact execution path and MUST pass all declared fixtures against the canonical fixture registry before installation. Execution failure returns structured diagnostics without a partial program; it MUST NOT select another package or implementation as a substitute.

Every number parameter MUST declare its spelling through the closed v1 number-format object. Version 1 supports fixed fractional digits, a `.` or `,` decimal separator, optional trailing-zero trimming, and explicit negative-zero handling. Fractional digits MAY be a fixed integer or an exact integer binding property constrained to the inclusive range 0 through 12. The runtime formats template text from that declaration but derives motion trace from the original finite numeric value. A controller requirement outside the closed format schema is not representable in v1. The author MUST report that limitation and MUST NOT approximate the required spelling.

## 8. Fixtures and conformance

Each fixture binds an exact plan-fixture ID, a complete property set, exact expected program text, and evidence references. A package MUST cover every declared command family, capability, lifecycle branch, property boundary, and known failure mode across its fixtures.

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

## 9. Saved revisions and artifacts

Controller output is generated only from a persisted, validated saved job revision. That revision snapshots the UPID, neutral execution plan, physical machine, exact binding and verification state, exact package, resolved properties, engine version, and content hashes.

File extension and line ending are explicit artifact-writing preferences. They MAY change the filename or encoded line separators. They MUST NOT change semantic controller blocks. Draft editor state, an unconfigured export preference, a missing binding, a dangling post reference, a modified package, or a hash mismatch MUST stop generation with a specific error.

## 10. Agent completion criteria

An authored package is complete only when the agent has:

- recorded target controller and firmware scope without inference;
- added source records and command-scoped evidence;
- declared complete capabilities, execution policy, properties, and dialect state;
- implemented the documented runtime API without ambient dependencies;
- added meaningful exact fixtures;
- run generation and conformance successfully;
- reported unresolved evidence or physical-verification limits explicitly.

The agent MUST NOT claim physical verification from conformance alone.
