# Post-Processor Platform Design

Date: 2026-08-28

Status: Superseded for installation and controller-file ownership by `2026-09-04-complete-machine-package-installation-design.md`. The replacement specification incorporates those decisions; this document remains technical background for controller-neutral planning, post runtime, evidence, conformance, and reproducibility.

The complete `.wireedm-package` and post-owned controller-file rules in the 2026-09-04 design take precedence over the standalone-installation and host-output-preference language retained below for historical context.

## Goal

Replace the application's controller-specific export branches and mixed machine-profile settings with a local-first post-processor platform. A person or coding agent must be able to create a post from authoritative controller documentation, install multiple versions, bind any of them to compatible machines, test them against conformance fixtures, and explicitly choose the exact binding used to generate a reproducible controller program.

The platform is API-first. Package parsing, library operations, bindings, execution-plan compilation, posting, and artifact provenance are tested domain APIs before settings or export UI is added. It is a clean replacement: legacy persisted shapes and legacy posting APIs receive no compatibility layer.

## Error policy

The new domain has no implicit recovery policy. Invalid input fails at its boundary with a stable diagnostic code, a precise path when applicable, and an actionable message. Internal functions accept valid constructions and do not revalidate or invent substitutes.

In particular, the implementation must not:

- select the first machine or post when an ID is missing;
- resolve an unversioned package to the newest installed version;
- fill absent required fields from a default profile;
- coerce an unknown enum value to a known value;
- attach the active machine or post during import;
- continue with partial controller output after a required event fails;
- catch a domain error only to return empty output or a generic fallback.

Empty libraries, an unbound job, and optional metadata are modeled as valid explicit states where the product supports them. Everything else is constructed successfully or returned as a typed error. A fallback is allowed only when it is an intentional product choice represented in the public type and covered by a behavior test.

## Boundary decisions

### Designs are post-neutral

A UPID document can be imported, created, edited, reviewed, and saved without any post installed. It stores geometry and semantic manufacturing decisions, never literal controller words.

A machine may be selected before or during planning to check physical feasibility: work envelope, supported axes, taper limits, threading hardware, and similar facts. Machine selection must not choose G-codes, compensation sequences, arc-center conventions, headers, footers, precision, or program endings.

Unknown travel remains an explicit valid planning state, but it blocks creation of a machine-ready saved revision because physical fit cannot be proven. Known travel must contain the project envelope, and every manual or automatic threading requirement in the compiled plan must be supported by the selected machine hardware.

Controller capability feedback may be shown early when a tentative post binding is selected, but only export requires a binding. Changing that binding cannot mutate geometry or manufacturing intent.

### Machine definitions own physical facts

The target `MachineDefinition` owns:

- stable identity, display name, manufacturer, model, and controller identity used for compatibility matching;
- X/Y work envelope and later axis/taper physical limits;
- manual and automatic threading hardware capability;
- physical notes and local evidence references;
- zero or more named `MachinePostBinding` records.

It does not own controller command strings, header/footer templates, modal policy, coordinate formatting, program-end codes, offset-register syntax, or controller lifecycle rules.

DXF import-unit preference is a workbench/import preference, not a physical machine fact. Output extension and line ending are export preferences. Coordinate precision and word formatting are post properties because they affect controller program text.

### Legacy field ownership and deletion map

This table is a deletion map, not a migration contract. It prevents the old mixed profile from being recreated under new names.

| Current `MachineProfile` field | New owner | Decision |
| --- | --- | --- |
| `id`, `name`, `notes` | Machine definition | Keep as physical-machine identity and notes. |
| `preferredDxfImportUnit` | Workbench import preferences | Move; it is operator workflow preference, not a machine fact. Missing preference requires unit review rather than a guessed unit. |
| `workArea.widthMm`, `workArea.lengthMm` | Machine definition | Keep as physical X/Y envelope. Unknown limits are an explicit `unknown` state, not `null` interpreted as unlimited. |
| `controller.family` | Post target plus machine controller identity | Delete the closed family switch. Machine identity is descriptive compatibility data; package target matching is explicit. |
| `controller.postVersion` | Exact post installation reference | Delete the integer route selector. Versions are package semantic versions plus content hashes. |
| `controller.verification` | Machine post binding | Replace with evidence tied to machine ID, package hash, and canonical property hash. |
| `controller.blockFormatting` | Post property | Move; it changes emitted controller text. |
| `controller.coordinateSystem` | Post source and dialect descriptor | Move; it is controller lifecycle syntax. |
| `controller.unitsCode`, `planeCode`, `workOffsetCode`, `distanceMode`, `arcCenterMode`, `programEnd` | Post source and dialect descriptor | Move all controller words and modal meaning. |
| `compensation.supported` | Post capability | Move; the execution plan stores semantic compensation intent. |
| `compensation.enabledByDefault` | Job-creation decision | Delete as a machine default. A new job records an explicit planning choice. |
| `compensation.offsetSelection` | Binding properties | Move as validated controller-specific values such as an offset register. |
| `compensation.activation`, `cancellation`, `lifecycleScope`, `preActivationCodes` | Post source and dialect descriptor | Move; these are precisely the controller program lifecycle. |
| `compensation.validationLeadLengthMm` | Post property constrained by package schema | Move; the post declares the transition requirement and the binding supplies an exact value when configurable. |
| `compensation.expectedMaximumOffsetMm` | Saved job setup or required binding property | Move out of the machine. An absent value blocks any validation that requires it. |
| `threading.manual.supported`, `threading.automatic.supported` | Machine hardware capabilities | Keep only the physical availability. |
| `threading.*.stopCode`, `beforePositioningCodes`, `afterPositioningCodes` | Post source and dialect descriptor | Move all controller words. |
| `programStops.supported`, `allowedPlacements`, `allowCompensationActive`, `code` | Post capability, source, and validator | Move; these describe controller/post behavior, not the physical machine. |
| `templates.header`, `templates.footer` | Post source or typed post properties | Delete generic free-form ownership from the machine. A package can expose deliberate bounded customization. |
| `output.coordinatePrecision` | Post property | Move because it changes generated text and geometry representability. |
| `output.extension`, `output.lineEnding` | Export preferences | Move; these serialize an already generated artifact and never select a post. |

The old active-machine concept also splits. A workbench may remember a machine used for planning convenience, but missing or deleted IDs never select the first entry. A controller export selection is job revision data and is always explicit.

### The post library owns packages; machines own bindings

The workbench has a global versioned `PostLibrary`. An installation is uniquely addressed by `(packageId, version, contentHash)`. Different versions and even different content with a conflicting claimed version are never silently overwritten.

Each machine holds any number of bindings. A binding contains a stable ID and name, an exact installation reference, validated post property values, compatibility acknowledgement, and verification evidence. Reusing one installation across machines does not duplicate its source.

Removing an installation referenced by a live machine binding is rejected until those bindings are removed or retargeted. Saved job revisions remain reproducible because they snapshot the selected package and binding, not merely a mutable library reference.

There is no implicit production default. The UI may remember or suggest the last binding for convenience, but controller export always displays and persists the exact selection. If the draft selection differs from the saved job, the action is `Save and generate`, creating a new revision before posting.

## Persisted artifacts

```ts
type PostInstallationRef = {
  packageId: string;
  version: string;
  contentHash: string;
};

type MachinePostBinding = {
  id: string;
  name: string;
  post: PostInstallationRef;
  properties: Record<string, unknown>;
  verification: PostVerification;
};

type SavedPostBindingSnapshot = {
  machineId: string;
  bindingId: string;
  package: WireEdmPostPackage;
  contentHash: string;
  properties: Record<string, PostPropertyValue>;
  verification: PostVerification;
};

type SavedWireEdmJobRevision = {
  revisionId: string;
  savedAt: string;
  upid: UniversalPathIntelligenceDocument;
  upidHash: string;
  machine: MachineDefinitionSnapshot | null;
  post: SavedPostBindingSnapshot | null;
};
```

The exact serialized version can evolve, but the illegal states must remain unrepresentable:

- a post reference always includes ID, version, and content hash;
- a binding's properties have already passed the package property schema;
- verification names the exact machine, package content, and properties it covers;
- a controller export request contains a persisted revision with a complete post snapshot;
- a portable UPID contains neither machine nor post state.

## Portable post package v1

The first upload format is one UTF-8 JSON file ending in `.wireedm-post.json`. A single document is easier for browser-only storage, source control, human inspection, and AI generation than an opaque archive. A future directory or archive representation may compile into the same parsed model.

```ts
type WireEdmPostPackageV1 = {
  format: 'wire-edm-post';
  schemaVersion: 1;
  manifest: {
    id: string;
    name: string;
    version: string;
    engineApiVersion: '1';
    description: string;
    targets: PostTarget[];
    capabilities: PostCapabilities;
    properties: Record<string, PostPropertyDefinition>;
  };
  dialect: {
    id: string;
    description: string;
    commands: Record<string, DialectCommandDefinition>;
  };
  source: {
    language: 'javascript';
    entrypoint: 'createPost';
    code: string;
  };
  sources: PostEvidenceSource[];
  evidence: PostEvidence[];
  fixtures: PostFixture[];
};
```

Package parsing is an external-data boundary. It rejects unknown schema versions, duplicate evidence and fixture IDs, malformed semantic versions, unsafe identifiers, invalid property schemas/defaults, dangling evidence references, unsupported capability combinations, oversized source or fixture data, and executable fields outside the declared source object. Internal code receives a fully validated immutable package and does not repeat those checks.

Content identity is a deterministic SHA-256 hash of canonical package JSON. `id` and `version` are author claims; the hash is the actual installed identity. Importing identical bytes is idempotent. Importing a different hash under an installed ID/version is a visible conflict, not an update.

### Dialect vocabulary

The descriptor is scoped to one post target. It must never imply that `G60`, `G38`, `G39`, or any other word has a universal meaning.

Each command has:

- a stable symbolic name used by post code, such as `distance.absolute` or `compensation.prepare`;
- a controller text template and typed parameters;
- declared semantic effects on controller state;
- evidence references into the package evidence list;
- optional ordering and state preconditions used by conformance checks.

Post code should emit registered commands by symbolic name. The runtime may permit a bounded raw-block escape hatch for syntax that cannot be represented yet, but each raw block must declare its semantic effects and evidence. A raw block that might move an axis without a structured motion effect makes machine-ready export unavailable.

The descriptor documents and checks a dialect; it does not replace executable lifecycle logic. The source controls conditional ordering and modal behavior. Execution-plan events control manufacturing order and geometry.

### Capabilities and properties

Capabilities describe semantic features, not marketing compatibility. They include supported motion geometry, controller compensation, multiple operations/passes, manual or automatic threading, wire separation, stops, taper/UV axes, technology selection, and initial-wire positioning.

Properties are typed as boolean, integer, number, string, or closed choice, with constraints and optional `suggestedValue` hints. Examples include coordinate precision, sequence numbering, offset-register selection, technology identifiers, and comment style. A suggestion is non-semantic authoring guidance: validation never materializes it. Every required property must be persisted explicitly in a machine binding.

Output extension and line ending are host preferences. A post may suggest an extension, but changing it must not change program text.

## Post engine contract

Posting has four pure or controlled stages:

```text
persisted saved job revision
  -> validate and compile immutable execution plan
  -> capability preflight
  -> run selected post against ordered events
  -> audit structured blocks and serialize controller artifact
```

The host owns geometry, pass order, entry/exit, threading and separation intent, event IDs, traceability, resource limits, diagnostics, serialization, and final hashes. The post owns controller commands, block ordering within event callbacks, modal implementation, formatting, technology syntax, and program lifecycle.

The v1 callback surface is deliberately small:

```ts
type WireEdmPost = {
  validate(context: Readonly<PostContext>): PostDiagnostic[];
  onOpen(context: Readonly<PostContext>): void;
  onEvent(event: WireEdmExecutionEvent, context: Readonly<PostContext>): void;
  onClose(context: Readonly<PostContext>): void;
};
```

The runtime API can emit registered dialect commands, formatted structured words, comments, and diagnostics. It cannot access the DOM, storage, network, clipboard, timers, randomness, wall-clock time, or mutable application objects. Every required execution event must be emitted, deliberately consumed under a declared capability, or rejected.

JavaScript package execution ships only with isolation, termination, memory/time limits, a narrow capability-free API, and deterministic tests. Bundled and uploaded packages use the same isolated runtime and must pass declared conformance fixtures against the canonical fixture registry before installation. The application contains no registered built-in implementation and neither installation nor execution may fall back to another package.

## Agent-first authoring contract

The post-authoring documentation is a versioned machine contract, not a long tutorial. It is shipped beside the engine and contains:

1. a normative `SPEC.md` using explicit MUST, MUST NOT, SHOULD, inputs, outputs, limits, and failure states;
2. the authoritative JSON Schema for `.wireedm-post.json` files;
3. generated TypeScript declarations for the package and runtime callback API;
4. a semantic event catalogue with exhaustive payload schemas and ordering rules;
5. a diagnostic catalogue with stable codes and JSON result shapes;
6. minimal complete and production-grade example packages;
7. canonical execution-plan fixtures and exact expected controller artifacts;
8. a conformance runner that returns structured diagnostics and non-zero failure status;
9. an `AGENTS.md` authoring workflow instructing an agent to cite controller-manual evidence, avoid cross-dialect inference, run conformance, and preserve all required events;
10. an engine compatibility matrix and changelog tied to `engineApiVersion`.

The JSON Schema and TypeScript declarations are generated from one authoritative model where practical. Examples are validated in CI. Prose explains intent and invariants but never becomes the only definition of a field or diagnostic.

An authoring agent follows this evidence-first loop:

```text
collect exact machine/controller identity and primary manual evidence
  -> map only evidenced commands into the scoped dialect vocabulary
  -> declare capabilities conservatively
  -> implement lifecycle callbacks against the typed SDK
  -> add representative and adverse fixtures
  -> run schema, capability, trace, determinism, and golden-output conformance
  -> leave the binding unverified until local simulation/dry-run evidence is recorded
```

## Replacement sequence

The code changes in controlled vertical slices, but the resulting public model has no dual-read, normalization, or legacy migration path.

1. Introduce the authoritative post-package and post-library APIs.
2. Replace `MachineProfile` with `MachineDefinition` and exact post bindings in a new workbench schema. Opening an obsolete manifest reports that its schema is unsupported and explains that a new workbench is required.
3. Extract the geometry-dependent work in `postGcode.ts` into an immutable execution-plan compiler.
4. Re-express physically relevant controller behavior as ordinary standalone package files using the public runtime and golden fixtures. Bundling an example cannot give it a privileged renderer or installation path.
5. Replace export composition with selected-package execution and delete the `programOwned` header/body/footer fork and legacy posting APIs.
6. Require a saved job revision before controller export. Portable UPID import remains unbound rather than inheriting an active machine or controller policy.
7. Replace the settings panel with machine, post-binding, and export-preference ownership boundaries.
8. Put external-program `G60` interpretation behind an explicitly selected dialect adapter. Keep source cleanup/display as product behavior, not as a compatibility shim for the removed generic interpreter assumption.

## Safety and determinism invariants

1. The same saved revision, package hash, binding properties, and engine version produce byte-identical program text.
2. Export never reads mutable editor drafts, an unversioned post, or the workbench's current default machine.
3. No package can silently drop, reorder, or geometrically change required execution events.
4. Every emitted motion block traces to an execution event and passes endpoint/arc equivalence checks within plan tolerance.
5. Verification is invalidated by any relevant machine, package-content, or property change.
6. Unknown dialect words have no inferred semantics. Cross-controller numerical similarity is not evidence.
7. Removing a library package cannot invalidate saved revisions, and cannot strand live machine bindings without an explicit operation.
8. Changing only extension or line ending cannot change semantic program blocks.
9. Failed parsing, compilation, posting, audit, or conformance produces no downloadable machine-ready artifact.
10. External G-code retains its source-preserving cleanup/display pipeline unless an explicit dialect adapter is selected for interpretation.
11. Missing IDs, versions, hashes, selections, capabilities, or required fields never choose a fallback; diagnostics identify the unresolved value and the operation needed to fix it.
