# Wire EDM post-processor architecture research

Date: 2026-08-28

Status: Historical research and architecture recommendation. The 2026-09-04 complete machine-package design supersedes its standalone post-installation and host-output-preference recommendations; the controller-neutral plan, runtime isolation, evidence, conformance, and reproducibility analysis remains background. No application code changed.

## Executive decision

Wire EDM Workbench should treat the saved UPID path document as manufacturing intent, then compile an immutable snapshot of that intent into a controller-neutral execution plan. A selected post processor should translate that plan into an NC program. Controller words, block ordering, modal state, formatting, threading commands, compensation lifecycle, technology-selection syntax, and program termination belong to the post. They should not remain distributed through the application.

"Saved UPID" needs one precise qualification. Raw portable UPID should stay machine-neutral. The controller-export input should be a saved job revision that combines the UPID document with an exact machine definition, post binding, post properties, and their content hashes. Generated NC text is an artifact of that revision, not part of the editable source of truth.

This is the same boundary used by mature CAM posting systems. Autodesk says its configuration script transforms intermediate NC data one record at a time, and its post engine calls lifecycle and motion entry functions such as `onOpen`, `onSection`, `onRapid`, `onLinear`, `onCircular`, `onSectionEnd`, and `onClose`. [Autodesk configuration reference](https://cam.autodesk.com/posts/reference/configuration.html), [Autodesk entry-function reference](https://cam.autodesk.com/posts/reference/entry_functions.html)

The important constraint is that the post is a translator, not a hidden CAM planner. The execution plan must already say which contours and spans are cut, in what order, where the wire starts, how it reaches and leaves each contour, where separation and threading occur, which passes run, and which process intent each pass uses. The post can express those decisions in a controller dialect. It must not silently invent, discard, reorder, or geometrically alter them.

I recommend a hybrid post package:

- a declarative, versioned manifest for identity, compatibility, properties, and capabilities;
- typed event callbacks for controller-specific sequencing and modal logic;
- a narrow host API that emits structured NC blocks, diagnostics, and trace links;
- bundled and user-verified posts first;
- arbitrary user-authored JavaScript only after a real confinement and resource-control layer exists.

A header/body/footer template model is too weak for this job. A fully declarative JSON rule language is safer but will become an awkward programming language once it handles modal state, lookahead, multiple cuts, controller-specific branching, and rethread recovery. Typed callbacks give the needed freedom while keeping the host in charge of the input order and safety checks.

## What the repository does now

The current model has several good foundations:

- `PathPlanningDocument` already holds geometry, source provenance, semantic compensation intent, ordered operations, starts, entries, exits, threading intent, program stops, and active or inactive machining spans. See `src/domain/path-intel/types.ts`.
- Portable UPID deliberately excludes machine data and generated G-code. It carries machining intent between workbenches. See `docs/superpowers/specs/2026-07-14-portable-upid-projects-design.md`.
- A project snapshots its machine profile instead of following a mutable library profile. This prevents later library edits from silently changing an old job. See `src/domain/workbench/types.ts` and `docs/superpowers/specs/2026-07-13-controller-compensation-machine-profiles-design.md`.
- Export validates the UPID graph, fails closed, keeps source-to-program trace data, and exposes structured posted blocks. See `src/domain/upid/upidDocument.ts` and `src/domain/post/upidMachinePost.ts`.
- The transition-ownership design makes G92, contour start, cut entry and exit, and between-contour positioning distinct concepts. See `docs/superpowers/specs/2026-07-23-machining-transition-ownership-design.md`.

The fault is where controller realization lives. `MachineProfile` mixes physical machine data, controller dialect, post version, compensation implementation, lifecycle code arrays, templates, formatting, and file output. `postUpidForMachine` then switches among `generic`, `explicit-linear`, `robofil-v1`, and `robofil-v2` routes. The 2,000-line `upidMachinePost.ts` file constructs controller text, knows Robofil-specific ordering, validates the same ordering, and exposes modal state as literal `G40`, `G41`, and `G42` strings.

That design adds a source-code branch to the application for every new dialect or machine lifecycle. It also makes a profile look more configurable than it is. Editing `preActivationCodes`, a header, or a footer does not define a complete post because the application still owns most program grammar.

There is also an ownership fork in export composition. Some routes set `programOwned: true` and generate the whole program. Other routes produce a body and let `composeUpidGCodeExport` add profile templates. A post should always own the controller program. The host should own final byte serialization, such as line endings and the chosen filename extension.

The current controller-export lifecycle does not use the saved revision. `EditorPage` builds `draftProject` from `machineProfileDraft`, then calls `composeProjectUpidGCodeExport(draftProject, pathDocumentDraft)`. A user can therefore download NC generated from editor state that has not been saved to the workbench project. See `src/features/editor/EditorPage.tsx:802-810`, `src/features/editor/EditorPage.tsx:886-908`, and `src/features/editor/EditorPage.tsx:4262-4265`.

The dashboard's portable-UPID export has the opposite behavior. It rereads the saved project file, exports only `upid.document`, and intentionally drops project identity and machine data. On import, the app silently attaches the receiving workbench's active machine profile. See `src/domain/upid/portableUpidProject.ts:33-59` and `src/domain/upid/portableUpidProject.ts:81-98`. These are two different artifacts and should be named as such:

- **Portable UPID document:** controller-neutral geometry and manufacturing intent. Import leaves the post unbound.
- **Saved Wire EDM job:** UPID plus the snapshotted machine and exact post binding. Controller export compiles this artifact.
- **Controller program artifact:** generated NC files plus provenance. It is never an editable substitute for the job.

One more controller assumption has leaked into the source-preserving external-program pipeline. `gcodeBlockInterpreter.ts:69` interprets every `G60` as absolute I/J mode. That matches the repository's local Robofil evidence, but it is wrong for controllers where G60 means something else. External parsing should eventually use an explicitly selected dialect adapter. Preserve the old cleanup/display behavior as a Robofil-compatible adapter instead of keeping its G60 rule in the generic interpreter.

## The G-code examples prove that dialect identity is mandatory

The user's examples should not become a universal command table.

| Word | Meaning in an official reference | Architectural conclusion |
| --- | --- | --- |
| `G90` / `G91` | LinuxCNC defines these as absolute and incremental distance mode. Mitsubishi also documents position-command methods under G90/G91. [LinuxCNC quick reference](https://linuxcnc.org/docs/html/gcode.html), [Mitsubishi M80/M800 programming manual](https://dl.mitsubishielectric.com/dl/fa/document/manual/cnc/ib1500926/ib1500926engf.pdf) | Distance mode belongs to the controller dialect. `G90` is the conventional absolute-mode answer, not `G60`. |
| `G60` | Mitsubishi defines G60 as unidirectional positioning that approaches the target from a parameter-set direction to reduce backlash. It even shows `G60 G91` together, so G60 cannot mean absolute mode on that controller. [Mitsubishi C70 programming manual](https://dl.mitsubishielectric.com/dl/fa/document/manual/cnc/ib1500269%28eng%29/ib1500269engf.pdf) | Never infer semantics from the number alone. The current Robofil preset may require G60, but that fact is local to that verified dialect. |
| `G38` | LinuxCNC assigns G38.2 through G38.5 to straight probing. Mitsubishi lists G38 as tool-radius-compensation vector designation. [LinuxCNC G-code reference](https://linuxcnc.org/docs/html/gcode/g-code.html), [Mitsubishi M80/M800 programming manual](https://dl.mitsubishielectric.com/dl/fa/document/manual/cnc/ib1501621%28eng%29/ib1501621-1501622engh.pdf) | A Robofil use of G38 must live only in a Robofil post whose source and verification are recorded. |
| `G39` | Mitsubishi lists G39 as a tool-radius-compensation corner arc. The current project uses G39 as part of a verified Robofil cancellation sequence. [Mitsubishi M80/M800 programming manual](https://dl.mitsubishielectric.com/dl/fa/document/manual/cnc/ib1501621%28eng%29/ib1501621-1501622engh.pdf) | `G39` cannot be named `compensationOff` in the neutral model. The neutral event is compensation cancellation; the post chooses its blocks. |
| `G40` / `G41` / `G42` | LinuxCNC documents compensation off, left, and right with a D word. Mitsubishi documents tool-radius compensation in the same family but adds controller-specific restrictions and variants. [LinuxCNC quick reference](https://linuxcnc.org/docs/html/gcode.html), [Mitsubishi C70 programming manual](https://dl.mitsubishielectric.com/dl/fa/document/manual/cnc/ib1500269/ib1500269engf.pdf) | The neutral model should retain kept-material or wire-side intent. Literal activation and cancellation blocks belong to the post. |

No public official Robofil 100 programming manual was found during this research. The repository's G60, G38, G41 or G42, G39, G40 sequence rests on a program physically verified by the user and the existing project notes. That is valuable machine evidence, but it is not evidence for another Charmilles generation, let alone Fanuc, Mitsubishi, Makino, Sodick, or generic ISO. The bundled post should therefore identify the exact `Charmilles Robofil 100 / Classic` target and keep its existing verification fingerprint.

Autodesk's public post library makes the same warning in plainer terms. Its posts aim to work on most target CNCs, but machine configuration can still make a nominally matching post incompatible. [Autodesk Fusion post library](https://cam.autodesk.com/hsmposts)

## The three data layers

The full flow should be:

```text
saved job revision
  = portable UPID intent + machine definition + locked post binding
  -> structural and manufacturing validation
  -> immutable WireEdmExecutionPlan
  -> versioned post package
  -> structured controller program artifact
  -> independent audit, exact preview, and download
```

### 1. UPID manufacturing document

UPID remains the editable, portable source of truth. It should contain controller-neutral decisions and stable source provenance:

- normalized geometry and active machining spans;
- datum and reviewed initial wire position;
- operation order, contour direction, and contour start;
- semantic compensation intent such as kept material or explicit wire side;
- entry and exit geometry;
- stop intent and reason;
- wire separation and threading intent;
- an explicit ordered pass plan;
- process intent and technology requirements without raw NC words.

The last two items need more modeling. Wire EDM is not always one traversal per contour. Makino describes a production condition with one rough cut and two skim cuts, and ties those passes to machine condition settings. FANUC describes automatic in-path rethreading and multi-workpiece cutting. Those are manufacturing events, not header text. [Makino U6 H.E.A.T. Extreme](https://www.makino.com/en-us/machine-technology/machines/wire-edm/u6-h-e-a-t-extreme), [FANUC ROBOCUT brochure](https://www.fanuc.eu/~/media/files/pdf/products/robocut/mbr-04360-rc%20robocut%20alpha%20cic%20series/robocut-cic-series-en.pdf?la=de)

A future `CutPass` should at minimum carry a stable ID, operation ID, ordinal, role such as rough or skim, traversal and contour reference, compensation intent, entry and exit behavior, threading requirements, and a semantic `technologyRef`. The technology reference can bind to a post property or machine technology library at export, but the chosen pass count and order must be visible in the saved job. If a post creates extra material-removing passes without adding them to the execution plan and preview, the saved job is not the final state before export.

UPID should not absorb physical-machine limits or post source. Those belong to the saved job revision around the portable document:

```ts
interface SavedWireEdmJobRevision {
  revisionId: string;
  upid: UniversalPathIntelligenceDocument;
  upidHash: string;
  machine: MachineDefinitionSnapshot;
  post: PostBinding;
}

interface PostBinding {
  packageId: string;
  packageVersion: string;
  sourceHash: string;
  engineApiVersion: string;
  properties: Record<string, unknown>;
  verification: 'unverified' | 'user-verified';
}
```

The exact serialized schema can differ. The invariant is more important: controller export receives a persisted immutable revision, not mutable React state or whichever machine happens to be the workbench default.

### 2. Immutable post input

Export should first build a versioned `WireEdmExecutionPlan`. This is a detached snapshot, not a live React or workbench object. It resolves derived routing and expands the saved document into an ordered event stream.

An illustrative event order is:

```text
program-start
setup
operation-start
wire-separate
position-for-threading
wire-thread
pass-start
compensation-start
entry-linear
contour-linear | contour-circular ...
exit-linear
compensation-end
pass-end
program-stop
operation-end
program-end
```

Each event needs an ID and source links to the UPID operation, pass, segment, transition, or stop that produced it. Coordinates should use one canonical unit and exact typed numbers. The plan should include resolved tolerance, arc geometry, winding, wire side, machine setup values, and selected post properties. It should not contain `G38`, `M00`, `D0`, parentheses for comments, or any other dialect text.

The host owns this compilation because it already owns geometry validity, transition continuity, compensation-side geometry, partial-span derivation, and operation ordering. The post may inspect the whole read-only plan for lookahead, but it receives events in the host's fixed order.

### 3. Controller program artifact

The post produces structured blocks before the host joins them into bytes. A block should carry:

- ordered words or an explicitly marked raw controller line;
- the source event ID;
- semantic kind such as setup, motion, compensation, threading, stop, or end;
- operation and pass IDs;
- semantic modal state before and after;
- warnings or errors raised while rendering;
- optional controller notes.

The host then selects line ending, validates encoding and file name, creates the final text, and computes an output hash. The extension remains a file-writing choice. Changing `.iso` to `.nc` must not alter the program text.

The current `GcodePostedBlock` and program-line mapping are close to this target. Replace literal compensation state with semantic state and generalize the block kinds so they are not tied to the current Robofil implementation.

## Post package contract

A portable post should be a versioned package, not a loose header/footer pair. A reasonable first format is:

```text
my-controller.wireedm-post/
  manifest.json
  post.js
  README.md
  fixtures/
    rough-and-two-skim.input.json
    rough-and-two-skim.expected.nc
```

The manifest should declare:

```ts
interface WireEdmPostManifest {
  format: 'wire-edm-post';
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  engineApi: string;
  targets: Array<{ manufacturer: string; controller: string; models?: string[] }>;
  capabilities: PostCapabilities;
  properties: Record<string, PostPropertySchema>;
  entry: 'post.js';
  source?: { url?: string; revision?: string };
}
```

Capabilities should cover supported geometry and lifecycle rather than claim generic compatibility. Examples include arcs, absolute or incremental XY, initial-wire declaration, controller compensation, centerline paths, multiple operations, multiple passes, manual or automatic threading, separation, program stops, taper or UV axes, and controller technology selection.

Properties are typed user choices with defaults and constraints. Examples include program number, coordinate precision, word spacing, sequence numbers, offset-register selection, controller technology IDs, optional stops, comment style, and extension. Autodesk posts use typed properties for choices such as sequence numbering, word spacing, and arc format. Its published MELDAS post also records a revision, minimum engine revision, certification level, capabilities, and output extension. [Autodesk MELDAS post source](https://cam.autodesk.com/posts/post.php?name=meldas)

The callback contract can stay small:

```ts
export function createPost(api: WireEdmPostApi): WireEdmPost {
  return {
    onOpen(context) {},
    onEvent(event, context) {},
    onClose(context) {},
    validate(plan, properties) { return []; }
  };
}
```

The API supplies formatting, modal variables, block emission, comments, diagnostics, and source-event acknowledgment. It does not expose the DOM, workbench storage, network, clipboard, timers, or mutable application objects. Autodesk's minimal post shows why formatting and modal helpers belong in the engine rather than being reimplemented by every post. [Autodesk minimal post](https://cam.autodesk.com/posts/reference/minimal_8cps-example.html)

`onOpen`, `onSection`, individual motion callbacks, and `onClose` are a proven shape, but this application should use Wire EDM terms and explicit events. Autodesk notes that a CAM operation can produce multiple post sections. The same distinction matters here: one contour operation can produce several cut passes. Do not make `operation` and `pass` aliases. [Autodesk entry-function reference](https://cam.autodesk.com/posts/reference/entry_functions.html)

## Validation and fail-closed behavior

Posting needs several independent checks:

1. UPID structural validation confirms finite geometry, valid references, topology, and reviewed user decisions.
2. Execution-plan compilation confirms route continuity, pass order, threading and separation prerequisites, entry and exit ownership, and compensation geometry.
3. Capability preflight compares every required event and feature with the post manifest. An unsupported required event blocks export.
4. The post's own validator checks controller and machine constraints. This is where a Robofil post can reject a competing header word or unsupported multi-contour lifecycle.
5. The runtime checks limits, thrown errors, invalid words, non-finite numbers, unacknowledged required events, and source-trace gaps.
6. Output validation checks encoding, line length, required program ending, modal transitions, motion coverage, and post-defined grammar rules.
7. Fixture tests compare exact bytes and structured trace for representative jobs.

The acknowledgment rule matters. A post must not be allowed to ignore `wire-thread`, `program-stop`, or a second skim pass and still return `ready`. Each required event ends as emitted, deliberately consumed without output, or rejected with a diagnostic. Deliberate consumption is legal only when the post capability and event contract allow it.

Motion trace should also remain geometric. Every emitted motion block maps to an input motion event. After posting, the host compares endpoints, arc centers, direction, and event coverage within the plan tolerance. Raw blocks that may move axes must either declare their motion effect or make machine-ready status unavailable.

## Determinism, provenance, and verification

The same saved job, machine snapshot, post package, properties, and engine version should produce identical bytes. Enforce that by design:

- fixed event ordering and stable object traversal;
- locale-independent number formatting;
- explicit rounding and negative-zero handling;
- no ambient current time, random values, network results, or storage reads;
- immutable inputs and a new post instance for each run;
- internal LF lines followed by one final line-ending conversion;
- bounded output and diagnostics;
- exact golden fixtures for each bundled or verified post version.

An export record should capture the UPID content hash, execution-plan hash, machine snapshot hash, post ID, semantic version, post source hash, engine API version, property hash, final output hash, and verification status. A timestamp can describe when the export happened, but it must stay outside deterministic program generation unless the user explicitly enables a date field and accepts that the bytes will change.

Keep the current fingerprint idea, but move it to the post binding. Verification applies to an exact post source hash plus machine and property envelope. Editing `post.js`, changing D-register policy, or changing a property marked safety-relevant invalidates verification. Cosmetic filename or extension changes do not.

Generated files should have an optional sidecar such as `<program>.wireedm-export.json` so another computer can reproduce which post produced them. The project can also keep the most recent export record without treating generated NC text as editable UPID state.

## Browser security for user-authored code

Running imported JavaScript with `eval` or `new Function` in the application realm would give that code the application's authority. A Web Worker helps with termination and responsiveness, but a normal worker is not a security boundary by itself. Worker code can have network APIs, allocate memory, and loop forever unless the host constrains and terminates it. Content Security Policy can restrict worker sources and dynamic code execution, but CSP does not turn arbitrary same-realm JavaScript into a capability-safe plugin system. [W3C Content Security Policy Level 3](https://www.w3.org/TR/CSP/)

SES is a relevant option because `lockdown` freezes shared JavaScript intrinsics and `Compartment` starts guest code with only explicitly supplied capabilities. Its own security notes still warn that guest code can run indefinitely and allocate arbitrary memory, and that the trusted computing base and supplied endowments determine the guarantee. SES also documents a past confinement vulnerability fixed in later versions, which is a reminder that the sandbox dependency itself must be pinned and patched. [Endo SES documentation](https://github.com/endojs/endo/blob/master/packages/ses/README.md), [SES security advisory GHSA-9c4h-3f7h-322r](https://github.com/endojs/endo/security/advisories/GHSA-9c4h-3f7h-322r)

The safe rollout is:

1. Ship bundled posts through the callback API and package format.
2. Allow users to inspect, export, import, and test post source, but mark imported posts unverified.
3. Initially execute custom posts only in an explicit development or test mode, with no machine-ready badge.
4. Add a dedicated worker that the host can terminate on time or output limits.
5. Run the callback inside a pinned SES compartment with frozen input and only the post API as an endowment.
6. Deny imports, dynamic import, network, storage, DOM, clipboard, timers, randomness, and host objects.
7. Require fixture success and explicit user verification before production download.

Before choosing the runtime, build a small hostile-post spike. Compare a worker plus SES with a separate QuickJS WebAssembly interpreter. `quickjs-emscripten` exposes explicit memory, stack, module-loading, and interrupt limits, which fit this use case better than relying on worker termination alone. A dedicated worker should still contain the interpreter so the UI can terminate the entire run. [quickjs-emscripten runtime documentation](https://github.com/justjake/quickjs-emscripten)

My preference is QuickJS-in-a-worker if the spike confirms acceptable bundle size, startup time, and deterministic behavior. It gives the imported post a separate JavaScript engine with host-set resource limits. SES remains a credible alternative, but its own documentation is clear that CPU and memory denial of service need host controls outside the compartment.

Even with those controls, a malicious post can emit dangerous NC text because generating NC text is its purpose. Sandboxing protects the application and local data. It cannot prove that the machine program is safe. Capability checks, exact preview, machine-envelope validation, golden fixtures, and operator verification remain mandatory.

An iframe is not the preferred runtime. The HTML specification warns that combining scripts and same-origin permission can let framed content remove its sandbox attribute. A worker plus a capability compartment gives cleaner termination and a smaller API. [WHATWG HTML iframe sandbox](https://html.spec.whatwg.org/multipage/iframe-embed-object.html)

## What to keep, move, replace, and remove

### Keep

- UPID geometry, source provenance, semantic compensation intent, operation planning, machining participation, transition ownership, and structural validation.
- Project-local snapshots. Extend the snapshot to include a post reference, exact source hash, and property values.
- Fail-closed readiness and actionable diagnostics.
- Structured block trace, exact program preview, and line mapping.
- Browser-cache workbench and folder-backed optional persistence.
- External G-code import and cleanup as a separate source-preserving pipeline.

### Move behind the post boundary

- all literal G and M words;
- G92 realization and coordinate-mode blocks;
- G38/G39/G40/G41/G42 sequencing;
- offset address and formatting such as `D0`;
- threading, separation, stop, rethread, flushing, power, and technology-selection commands;
- controller comments, program numbering, block numbering, arc format, precision, whitespace, program ending, and headers or footers;
- controller-specific validation envelopes now held in `verifiedRobofilPostEnvelope.ts` and related route code.

The host should still compute geometric winding and requested wire side. The post translates `wireSide: left` into whatever the target controller requires. `resolveControllerCompensation` should therefore stop returning a literal `G41` or `G42` as its neutral result.

### Replace

- `MachineProfile.controller.family` and the route switch in `postUpidForMachine` with a post registry and resolved `PostBinding`.
- `programOwned` with one rule: the post owns the whole controller program; the host owns artifact serialization.
- free-form header and footer templates with post callbacks and typed properties. A post may expose literal prologue or epilogue properties when useful, but it must validate and own their placement.
- literal `compensationBefore` and `compensationAfter` values on trace blocks with semantic modal-state snapshots.
- scattered code-array settings such as `preActivationCodes` with post source and typed properties.
- the current controller-export call on `pathDocumentDraft` with an explicit `Save and generate` transaction. Draft preview can remain useful, but it must be labelled as a draft and its Download action must stay disabled until the same state has been persisted as a job revision.
- raw UPID import's automatic assignment of the active default machine with an unbound-post state. A full saved-job import may preserve its locked binding; a controller-neutral UPID import must ask the user to choose and verify one.
- the generic external-program interpreter's Robofil-specific G60 rule with a dialect adapter selected from known provenance or explicit user choice.

### Remove after compatibility posts exist

- the generic, explicit-linear, Robofil v1, and Robofil v2 application-level posting branches;
- application validators that parse a post's own generated text to prove its hard-coded prefix;
- controller assumptions in generic UPID-to-G-code functions;
- the fallback where the host adds templates around a post-generated body.

Do not remove those paths in one edit. First wrap the current generic ISO and both verified Robofil behaviors as bundled compatibility posts. Run their existing exact-output tests as golden fixtures. Switch projects through a schema migration only after the new engine produces byte-identical output for existing supported jobs.

## Suggested migration slices

1. Make controller export consume a persisted job revision. Add `Save and generate`; keep draft preview non-downloadable. Stop attaching the active default post to imported raw UPID.
2. Define `WireEdmExecutionPlan`, semantic events, post manifest, post result, and export provenance types. Build the plan from current UPID without changing output.
3. Add coverage validation that proves each current posted motion and lifecycle block maps to an execution event.
4. Extract current generic ISO behavior into a bundled post behind the new interface. Keep exact byte tests.
5. Extract verified Robofil v1, then Robofil v2. Treat the user's physical verification and current fingerprint as migration evidence.
6. Split `MachineProfile` into physical `MachineDefinition`, `PostBinding`, typed post properties, and output artifact preferences.
7. Add explicit `CutPass` and technology-reference modeling before exposing multiple-cut UI or allowing a post to generate skim passes.
8. Replace the export UI's machine-family route with post selection, properties, capability diagnostics, exact preview, provenance, and fixture runner.
9. Add post import and source editing. Keep custom execution in test mode until worker termination, confinement, CSP, quotas, and verification invalidation are complete.
10. Move external-program G-code interpretation behind dialect adapters while retaining the current cleanup/display behavior as a compatibility adapter.
11. Remove the legacy posting branches only after migrated projects and bundled fixtures pass the full suite and build.

## Acceptance criteria for the architecture

- Saving the same UPID job and choosing the same machine snapshot, post hash, properties, and engine version produces byte-identical output.
- Downloadable controller output can only name a persisted job revision and its hashes. Unsaved draft state cannot produce a production download.
- No controller word exists in UPID or the execution plan.
- No required operation, pass, transition, stop, or threading event can disappear without a blocking diagnostic.
- The preview traces every motion and lifecycle block to a stable job event.
- A post change cannot alter a saved job silently. It creates a new binding hash and invalidates verification where required.
- A post can express the verified Robofil ordering, including prologue, compensation activation, between-contour cancellation and reactivation, and epilogue, without an application source-code branch.
- A second controller can use different meanings for G38, G39, and G60 without changing UPID types or planner code.
- Multi-pass jobs show all rough and skim passes before posting. The post translates them but does not invent them.
- Imported post code has no application, network, DOM, storage, or clipboard authority, and the host can terminate it.
- Machine-ready status still depends on explicit machine and operator verification, not merely successful JavaScript execution.

## Bottom line

The user's proposed direction is correct, with one adjustment: do not give the post the editable UPID document and let it decide the job. Freeze the job first. Compile it into a typed execution plan that contains every material and lifecycle decision, then give the post a powerful but narrow translation API.

That boundary provides the freedom the user wants. A machinist can create a post with help from ChatGPT, run exact fixtures, inspect the generated controller program, and bind it to a machine without adding a new branch to Wire EDM Workbench. It also preserves the application's strongest current property: geometry and machining intent remain inspectable, portable, and testable before any controller dialect touches them.
