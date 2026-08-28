# Agent-first post authoring research

## Scope

This note defines a documentation contract for an AI agent that turns controller manuals into Wire EDM post packages. The goal is not to make prose more elaborate. The goal is to give the agent a small set of versioned, executable contracts, evidence requirements, and deterministic checks that prevent unsupported controller behavior from reaching a machine.

The study is bounded to official specifications and project documentation. It covers package shape, TypeScript surfaces, normative requirements, diagnostics, version binding, fixtures, conformance, provenance, and agent instructions. It does not choose a controller dialect or infer commands for a specific machine.

## Decision summary

The authoring system should use several representations because they answer different questions:

| Concern | Authoritative representation | Role of prose |
| --- | --- | --- |
| Serialized package shape | TypeBox source schemas, emitted as JSON Schema Draft 2020-12 | Explain intent and non-obvious fields |
| Engine callback API | Exported TypeScript source, emitted as `.d.ts` | Explain lifecycle and safety obligations |
| Cross-record and lifecycle rules | Executable semantic validators and conformance tests | State normative requirements by stable ID |
| Requirement meaning | `SPEC.md` with RFC 2119/8174 keywords | Normative where schema cannot express the rule |
| Diagnostic identity | Machine-readable diagnostic catalog | Explain remediation, never define identity by message text |
| Exact generated programs | Reviewed golden `.nc` files and structured traces | Explain why the fixture exists |
| Manual support | Evidence records bound to immutable source digests and selectors | Summarize the claim without copying the manual |
| Agent workflow | Scoped `AGENTS.md` and a task template | Sequence the work, never override contracts |

No single format should pretend to cover all of these concerns. JSON Schema is executable for document structure. It is not the authority for event ordering, capability coherence, evidence sufficiency, modal safety, or the meaning of a controller command. Examples demonstrate usage, but only fixtures run by the conformance tool are executable oracles.

## Executable schema and generated types

Use JSON Schema Draft 2020-12 for every serialized contract. Each published schema should have an explicit `$schema` and a versioned absolute `$id`. In JSON Schema, `$schema` selects the schema dialect and `$id` establishes the schema resource identifier. Neither field is the Wire EDM package format version. If `$schema` is absent, dialect behavior can become implementation-defined, which is not suitable for a portable authoring kit. The specification also distinguishes assertion, annotation, and applicator behavior, a useful boundary when deciding what a validator can enforce. See the [JSON Schema 2020-12 core specification](https://json-schema.org/draft/2020-12/json-schema-core).

Production object schemas should reject undeclared fields with `unevaluatedProperties: false`. Draft 2020-12 requires implementations to collect annotations for `unevaluatedProperties` correctly, including through composed schemas. This gives package authors a fail-closed contract without duplicating property lists across `allOf` and conditional branches. Unknown schema keywords are otherwise collected as annotations, not rejected as errors. A misspelled custom keyword must therefore be caught by schema linting or avoided altogether.

Do not put controller semantics into custom JSON Schema keywords. The core specification explicitly notes that complex behavior is often better implemented in application code than in custom keywords. Use schema for types, required fields, enums, bounds, references, and closed records. Use named semantic checks for rules such as these:

- every declared capability has the required callbacks and fixtures;
- every emitted controller command has reviewed evidence;
- an event is handled or explicitly acknowledged as intentionally ignored;
- fixture execution leaves no unclosed modal or machine state;
- a property default and every fixture override satisfy the same domain constraints;
- output is deterministic for the same package, engine, plan, and properties.

This repository already depends on TypeBox. TypeBox creates JSON Schema in memory while inferring TypeScript types and supports compiled runtime validation, so it is a practical single source for serializable contracts. Its project also tracks the official JSON Schema test suite. See the [TypeBox repository](https://github.com/sinclairzx81/typebox). The checked-in JSON Schema files should be generated artifacts, and CI should fail if regenerating them changes the tree.

The engine callback surface has a different source of truth. Keep it as focused exported TypeScript and emit declarations with `tsc --declaration --emitDeclarationOnly`. TypeScript describes `.d.ts` files as declarations of the external API, and its publishing guidance recommends shipping generated declarations with the implementation and pointing the package `types` field at the entry declaration. See the TypeScript documentation for [`declaration`](https://www.typescriptlang.org/tsconfig/declaration.html) and [publishing declaration files](https://www.typescriptlang.org/docs/handbook/declaration-files/publishing.html).

The practical rule is:

1. TypeBox schema modules are authoritative for serializable data.
2. Exported TypeScript is authoritative for callable engine APIs.
3. JSON Schema and `.d.ts` files are generated, checked-in views for agents and external tools.
4. Semantic validators and conformance tests are authoritative for behavior that neither representation can express.

Generated files must carry a header naming their source and generation command. Agents may read them but must not edit them directly.

OpenAPI is not the package contract. OpenAPI is a language-neutral description for HTTP APIs, and its root `openapi` value selects the OpenAPI specification version independently of the described API version. OpenAPI 3.1 also allows a `jsonSchemaDialect` URI. Those features are useful only if the workbench later exposes an HTTP service. At that boundary, the service definition should reference the standalone post schemas rather than redefine them. See the [OpenAPI 3.1.2 introduction](https://spec.openapis.org/oas/v3.1.2.html#introduction) and the [OpenAPI 3.1.1 Schema Object rules](https://spec.openapis.org/oas/v3.1.1.html#schema-object).

## Normative specification

`SPEC.md` should state only requirements that affect interoperability, safety, reproducibility, or conformance. Use the RFC 2119 terms `MUST`, `MUST NOT`, `SHOULD`, and `MAY` with their formal meanings and include the RFC 8174 boilerplate that only uppercase terms are normative. RFC 2119 defines `MUST` as an absolute requirement and `MUST NOT` as an absolute prohibition. It also says these imperatives should be used sparingly and only where required for interoperability or to limit harmful behavior. RFC 8174 resolves the ambiguity of lowercase uses. See [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119.html) and [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174.html).

Give every normative statement a stable ID, for example `WEP-REQ-0042`. Record its enforcement mode in `requirements.json`:

```json
{
  "id": "WEP-REQ-0042",
  "level": "MUST",
  "text": "Every emitted controller command has at least one reviewed evidence claim.",
  "enforcement": "automated",
  "checkId": "evidence.command-covered"
}
```

Every automated `MUST` or `MUST NOT` must name a schema assertion, semantic check, or conformance test. A requirement that genuinely needs operator judgment must say `"enforcement": "manual"` and identify the review record it expects. A normative statement without an enforcement path should fail documentation linting.

The specification should also say how conflicts are handled. Schema assertions govern document shape. Semantic validators govern cross-record and lifecycle behavior. The callback declarations govern the callable surface. `SPEC.md` governs requirement meaning where those executable forms are insufficient. Generated artifacts, examples, prompts, and `AGENTS.md` cannot amend any of them. If two authoritative representations disagree, generation or conformance fails. The runtime must not silently choose one.

## Diagnostics as a public interface

Diagnostics should be structured data first and console prose second. JSON Schema defines output formats ranging from a boolean flag to detailed results. Its basic output fields include `keywordLocation`, `instanceLocation`, and optionally `absoluteKeywordLocation`. Error message wording is implementation-defined, so tools must not parse it. See the [JSON Schema output schema](https://json-schema.org/draft/2020-12/output/schema).

Normalize schema failures and project-specific checks into one lean diagnostic shape:

```ts
type PostDiagnostic = {
  code: string
  severity: 'error' | 'warning' | 'note'
  phase: 'schema' | 'evidence' | 'capability' | 'post' | 'audit' | 'fixture'
  message: string
  instanceLocation?: string
  artifactLocation?: { uri: string; line?: number; column?: number }
  requirementId?: string
  evidenceId?: string
  fixtureId?: string
  eventId?: string
  related?: Array<{ message: string; uri?: string; instanceLocation?: string }>
  details?: unknown
}
```

`instanceLocation` should be an RFC 6901 JSON Pointer. Codes such as `WEP1007` are stable and opaque. Messages are for people and may improve without a breaking release. Each code belongs in `diagnostics.json` with default severity, phase, summary, remediation, and related requirement IDs. Conformance returns a nonzero exit status when any `error` exists.

This design borrows the useful parts of SARIF without making the post engine implement the entire format. SARIF results identify a stable rule, level, message, locations, related locations, provenance, and fingerprints. It also recommends SHA-256 for artifact hashes. The workbench can later offer SARIF export for editor or CI integration while keeping the internal model small. See the [OASIS SARIF 2.1.0 specification](https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/sarif-v2.1.0-os.html).

Keep raw validator output under `details` when it helps debugging, but normalize its locations and code. Never treat an English validator message as the diagnostic identifier.

## Independent version and identity bindings

The package needs separate version fields because each one answers a different compatibility question:

| Identity | Meaning | Binding rule |
| --- | --- | --- |
| JSON Schema `$schema` | JSON Schema dialect | Exact official URI in each schema document |
| Schema `$id` | Identity of a schema resource | Immutable, versioned absolute URI |
| Package `schemaVersion` | Serialized Wire EDM format feature set | Exact supported value or explicitly tested migration |
| Package `version` | Release of one post package | SemVer plus exact content SHA-256 |
| `engineApiVersion` | Callback API compatibility | Declared compatible range for installation |
| Engine build | Runtime used for a result | Exact version and, where available, build digest |
| Controller identity | Physical command target | Manufacturer, family, model, and applicable firmware range |
| Manual identity | Evidence source | Document number, revision, media type, URI or name, and SHA-256 |
| Saved machine binding | Workbench target | Exact machine definition ID and revision or content hash |
| Job and properties | Inputs to generated output | Exact plan revision and canonical property hash |

Use Semantic Versioning only for the package and public software APIs. SemVer requires a precise public API, assigns major versions to incompatible changes, minor versions to backward-compatible additions, and patch versions to backward-compatible fixes. It also says released contents must not be modified. See [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html). A compatible SemVer range does not prove that a program is safe for a controller firmware revision.

Installation may accept a compatible `engineApiVersion` range. A conformance report and every generated artifact must record the exact engine build, package version and digest, package schema version, controller target, machine binding hash, plan revision, property hash, and fixture-set version. Tests must never bind to a moving `latest` label.

## Evidence and provenance

An AI author must not turn plausible manual text into an untraceable controller rule. Every source artifact should have a resource descriptor modeled on the in-toto `ResourceDescriptor`: a name or URI, digest, media type, and optional embedded content or download location. The in-toto model requires a descriptor to identify content through a URI, digest, or embedded content and recommends digests for immutable identification. See the [in-toto ResourceDescriptor specification](https://github.com/in-toto/attestation/blob/main/spec/v1/resource_descriptor.md).

For this project, a manual source should require:

```json
{
  "id": "src.robofil100.programming-manual.rev-a",
  "name": "Controller programming manual",
  "uri": "manuals/controller-programming-manual.pdf",
  "mediaType": "application/pdf",
  "documentNumber": "...",
  "revision": "...",
  "contentSha256": "..."
}
```

Evidence claims should be separate records rather than comments embedded in command definitions:

```json
{
  "id": "ev.thread-start-command",
  "sourceId": "src.robofil100.programming-manual.rev-a",
  "selector": {
    "page": 42,
    "section": "Wire control",
    "exact": "short identifying excerpt",
    "prefix": "optional local context",
    "suffix": "optional local context"
  },
  "claim": "Command ... starts the threading cycle under the stated preconditions.",
  "supports": ["command.thread-start", "WEP-REQ-0042"],
  "appliesTo": {
    "controllerModels": ["..."],
    "firmware": "..."
  },
  "status": "reviewed",
  "review": { "reviewer": "...", "reviewedAt": "..." }
}
```

W3C Web Annotation selectors provide a useful vocabulary for durable locations, including PDF page fragments and text quote selectors with exact text plus prefix and suffix context. See the [W3C Web Annotation selector model](https://www.w3.org/TR/annotation-model/#selectors). Store only a short identifying excerpt and locator when the manual is copyrighted. The digest proves which artifact was reviewed without copying it into the repository.

Every controller command, parameter range, capability assertion, and controller-specific ordering rule must link to at least one evidence claim. Missing or draft evidence is an error for release. `reviewed` means a person confirmed that the claim matches the cited source. It does not mean the command was validated on hardware.

Keep documentary evidence separate from operational verification. A dry-run or physical verification record should bind the exact package digest, engine build, machine binding, controller and firmware, properties, fixture or job, operator, date, result, and captured artifacts. This follows the general provenance distinction between entities, activities, and agents in [W3C PROV-DM](https://www.w3.org/TR/prov-dm/) and the SLSA pattern of recording build definitions, resolved dependencies with digests, builder identity, and output subjects in [SLSA build provenance](https://slsa.dev/spec/v1.2/build-provenance). The project is borrowing those patterns, not claiming PROV or SLSA conformance.

## Examples, golden fixtures, and conformance

Examples are informative and should remain small. They teach field usage and common patterns but do not define the grammar. Every checked-in example must still validate against its exact schema version and semantic rules.

Fixtures are executable. A useful fixture directory contains:

```text
fixture-name/
  case.json
  execution-plan.json
  expected.nc
  expected-trace.json
  expected-diagnostics.json
```

`case.json` binds the package digest, engine version, schema version, properties, expected outcome, and requirement IDs exercised. `expected.nc` is byte-exact, including line endings and final newline. `expected-trace.json` records structured event and block emission so a failure can distinguish a lifecycle regression from a formatting regression. `expected-diagnostics.json` asserts codes and locations, not message prose.

Vitest snapshots compare output character by character, and file snapshots can store arbitrary file extensions. Its documentation also warns that snapshot updates must be reviewed. `toMatchFileSnapshot` is therefore suitable for generated `.nc` files as long as updates are explicit review events, not an automatic test-repair step. See the [Vitest snapshot guide](https://vitest.dev/guide/learn/snapshots.html).

The fixture matrix should include valid examples and adverse cases:

- unsupported events and unsupported capabilities;
- missing, draft, rejected, or inapplicable evidence;
- duplicate IDs and broken references;
- invalid property defaults and fixture overrides;
- non-finite numbers, unit boundaries, precision limits, and rounding thresholds;
- missing event acknowledgements and incomplete lifecycle coverage;
- modal leakage across operations and failure cleanup;
- extension changes that incorrectly alter program text;
- CRLF and LF expectations;
- repeated runs that expose nondeterminism;
- a command whose syntax is valid but whose firmware applicability is not.

The official JSON Schema test suite offers a good runner shape: version-specific directories contain files made of test groups, each with a description, schema, and tests, and each test has a description, input data, and expected validity. The runner remains separate from the data. See the [JSON Schema Test Suite](https://github.com/json-schema-org/JSON-Schema-Test-Suite).

The repository should expose one deterministic, offline runner:

```text
npm run post:docs:generate
npm run post:conformance -- path/to/package.wireedm-post.json
```

The conformance command should emit a machine-readable report by default or through `--format json`:

```ts
type ConformanceReport = {
  format: 'wire-edm-post-conformance'
  schemaVersion: 1
  valid: boolean
  package: { id: string; version: string; sha256: string }
  engine: { apiVersion: string; version: string; sha256?: string }
  fixtureSetVersion: string
  checks: Array<{ id: string; status: 'pass' | 'fail' | 'skip'; requirementIds: string[] }>
  diagnostics: PostDiagnostic[]
}
```

CI should perform these checks in order:

1. Regenerate schemas, declarations, and catalogs, then fail on a diff.
2. Validate schemas against their meta-schema and lint schema authoring mistakes.
3. Validate every example and fixture package against its exact schema.
4. Run semantic, evidence, capability, event coverage, and reference-integrity checks.
5. Run every fixture and compare exact program bytes, traces, and diagnostic codes.
6. Run each successful fixture twice and compare outputs to detect nondeterminism.
7. Build and run the relevant repository test suite.

A golden update must show the old and new program, the trace diff, the requirements affected, and the evidence that justifies the change.

## Recommended documentation bundle

Publish one versioned authoring kit and keep its generated artifacts checked in:

```text
docs/post-authoring/v1/
  README.md
  SPEC.md
  CHANGELOG.md
  compatibility.json
  schema/
    post-package.schema.json
    execution-plan.schema.json
    diagnostic.schema.json
    conformance-report.schema.json
    evidence.schema.json
  sdk/
    post-engine.d.ts
  catalog/
    requirements.json
    events.json
    diagnostics.json
  examples/
    minimal.wireedm-post.json
  fixtures/
    ...
  AUTHORING_TASK.md

post-packages/
  AGENTS.md
  <package-id>/
    package.wireedm-post.json
    fixtures/

scripts/
  generate-post-authoring-docs.mjs
  run-post-conformance.mjs
```

The TypeBox sources and TypeScript callback source remain under focused domain modules in `src/domain/`. The published `docs/post-authoring/v1` directory is a stable, agent-readable release of those sources and their normative companion files. `compatibility.json` lists supported schema versions, engine API ranges, and conformance runner versions. It must not claim controller or firmware compatibility without evidence and verification records.

`AUTHORING_TASK.md` should be a copyable task contract with explicit inputs and success criteria. It should require the exact manual artifact, controller identity, intended package ID, allowed output location, and verification level. It should instruct the agent to stop with diagnostics when evidence is missing or contradictory.

Place authoring-specific instructions in `post-packages/AGENTS.md`, not only in the root file. Codex discovers `AGENTS.md` files from the project root toward the current working directory, and deeper instructions override broader ones for files in their subtree. The official guidance recommends concise, actionable instructions and says to verify which instructions were loaded. See [OpenAI's AGENTS.md guidance](https://developers.openai.com/codex/guides/agents-md). Keep the root instructions for repository-wide constraints and the nested file for post-package rules. Work should start with the agent's current directory inside `post-packages/` so the scoped instructions apply.

The nested instructions should say, at minimum:

- read `docs/post-authoring/v1/README.md`, `SPEC.md`, schemas, declarations, and relevant catalogs before editing a package;
- do not invent controller commands, parameter meanings, firmware support, or source locations;
- add evidence before adding a controller-specific command or capability;
- edit authoritative source files, never generated schemas or declarations;
- run generation and conformance before reporting completion;
- never update golden output merely to make a test pass;
- report unresolved evidence and validation errors by diagnostic code;
- do not describe a package as machine-verified without a bound verification record.

Prompt guidance should stay lean. OpenAI recommends stating each instruction once, retaining examples that encode product requirements, and defining autonomy, safety, and success criteria clearly. See [OpenAI's model prompting guidance](https://developers.openai.com/api/docs/guides/latest-model#prompting-best-practices). The task prompt should name the manual and target package. Stable rules belong in contracts and `AGENTS.md`, not repeated in every prompt.

## Generation workflow

An agent-first package authoring run should follow this sequence:

1. **Freeze the inputs.** Record the controller manufacturer, family, model, firmware applicability, exact manual metadata, and SHA-256 before interpreting any content.
2. **Build the evidence index.** Create source descriptors and evidence claims with page or section selectors. Record ambiguous or conflicting material as blocking diagnostics.
3. **Declare a conservative package surface.** Add only targets, capabilities, properties, commands, and lifecycle behavior supported by reviewed evidence. Unknown behavior remains unsupported.
4. **Implement against the declarations.** Use the generated `.d.ts` callback surface and schema-backed package types. Do not bypass the public engine interface.
5. **Generate the documentation views.** Emit JSON Schemas, declarations, catalogs, and compatibility data from their authoritative sources. A dirty diff is reviewed or rejected.
6. **Add conformance fixtures.** Cover every capability, command family, lifecycle event, property boundary, and known failure mode with exact program output and a structured trace.
7. **Run conformance.** Perform schema, semantic, evidence, capability, reference, lifecycle, fixture, and determinism checks offline. Resolve errors by code.
8. **Review evidence and golden diffs.** A reviewer confirms source applicability and inspects every changed machine command. Golden updates require justification, not acceptance by default.
9. **Install as unverified.** Passing conformance proves contract compliance and deterministic generation. It does not prove safe behavior on a machine.
10. **Record operational verification.** Simulation, controller dry-run, and physical verification each produce a record bound to exact package, engine, machine, firmware, properties, and output hashes.
11. **Bind saved work.** A saved job and exported artifact retain the exact package digest, engine build, machine definition revision, property hash, and provenance report used to produce them.

This workflow gives an AI agent freedom to extract and implement documented behavior while making unsupported inference visible. The decisive boundary is simple: schema-valid means structurally accepted, conformant means the package passed executable checks, reviewed means the cited manual supports the claim, and machine-verified means a separate bound operational record exists. None of those labels implies the next one.
