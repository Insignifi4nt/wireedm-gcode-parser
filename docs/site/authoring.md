# From machine evidence to an installable package

## 1. Establish the target

Ask for the machine manufacturer/model, controller manufacturer/model, firmware if known, X/Y travel, threading hardware, and required operations. Obtain the exact controller manual and representative known-good programs. Record unknowns explicitly. A related machine's manual may inform research but does not verify this controller.

Agree on output extension, encoding, LF/CRLF, final newline, program wrappers, numbering, coordinate precision and other setup properties. Obtain permission and necessary files for any physical verification. Software conformance alone is not a machine test.

Use the [input checklist](../post-authoring/v1/AUTHORING_TASK.md). Stop and ask for missing evidence rather than inventing commands or returning a partial package.

## 2. Get the matching contract

Clone the [open-source repository](https://github.com/Insignifi4nt/wireedm-gcode-parser), check out the app's release tag (`v` followed by the app version), and run `npm ci` with Node 22.13 or later. The release page supplies the exact version. During an unreleased PR, use its exact commit instead.

Read the [normative contract](../post-authoring/v1/SPEC.md), [SDK](../post-authoring/v1/sdk/wire-edm-post-sdk.d.ts), [schemas and fixtures](reference.md), and [agent instructions](../post-authoring/v1/AGENTS.md). Use **post schema v2** for new posts. Authoring kit v1 and engine API `"1"` are separate format/API identifiers; they are not old app versions.

## 3. Describe supported behavior

Build a table of each execution event, the controller commands it requires, preconditions/effects and supporting evidence. Declare only implemented capabilities. `wireSeparation` is an array of exact mechanisms; `[]` claims none. Manual threading and wire separation are distinct capabilities.

The deterministic guest exports `createPost(api)` and handles events with `onEvent(event)`. Use `api.emitMotion` for motion and positioning, `api.emitCommand` for non-moving commands, and `api.consume` for an event that intentionally emits no command. Read properties with `api.getProperty`. The SDK defines exact signatures and payloads. There is no network, filesystem, clock, random-number source or unrestricted JavaScript environment inside a post.

Declare command parameters, spelling, numeric formatting, motion roles, arc direction and state requirements/effects in the dialect. Audit uses those declarations and formatted coordinates; emitting plausible text alone is insufficient. Keep controller output rules in `manifest.output`.

Use the [minimal post](../post-authoring/v1/examples/minimal.wireedm-post.json) as a structural example only. It is not a universal G-code post or a verified machine package. Start your own IDs, evidence, capabilities and fixtures.

## 4. Assemble the complete source directory

```text
my-machine/
  machine-package.source.json
  machine.wireedm-machine.json
  controller.wireedm-post.json
  evidence/
    controller-manual.pdf
    known-good-program.iso
```

The [source manifest schema](../post-authoring/v1/schema/machine-package-source.schema.json) defines references to these files. The [machine schema](../post-authoring/v1/schema/machine-definition.schema.json) defines physical identity and setups; the [post schema](../post-authoring/v1/schema/post-package.schema.json) defines the post. Evidence paths stay inside this directory. Record SHA-256 over the exact evidence bytes, selectors, scope and review status. Never label a candidate program as known-good.

Each setup supplies every required property and an exact post ID, semantic version and canonical content hash. Compute that hash using `npm run post:hash -- my-machine/controller.wireedm-post.json`; hashing the pretty-printed file bytes is different and incorrect. Select an included setup with `activeBindingId`. A changed post needs a new version and a new exact setup reference.

Record provenance in the post manifest:

```json
"authoredFor": {
  "appVersion": "<exact app release>",
  "documentationUrl": "https://github.com/Insignifi4nt/wireedm-gcode-parser/tree/v<exact app release>/docs/post-authoring/v1"
}
```

Replace the placeholders. This is an authoring target, not proof of compatibility with other app versions. Leave a setup `unverified` unless the user provides the exact physical verification record.

## 5. Verify behavior and build

```sh
npm run post:docs:check
npm run post:conformance -- my-machine/controller.wireedm-post.json
npm run machine-package:validate-source -- my-machine
npm run machine-package:build -- my-machine my-machine.wireedm-package
npm run machine-package:validate -- my-machine.wireedm-package
npm run machine-package:inspect -- my-machine.wireedm-package
```

Every declared command and positive capability needs fixture coverage. Exercise property boundaries, both arc directions if supported, compensation changes, stops, threading, separation and unsupported paths. Golden fixtures cover both logical commands and final serialized artifact bytes. Review expected output against controller evidence before accepting it. If the canonical fixture registry cannot exercise a required behavior, report the missing app support; do not invent fixture IDs or weaken checks.

## 6. Deliver and install

Deliver the built `.wireedm-package`, its editable source directory, archive and post hashes, exact target scope, test results and remaining limitations. The user installs the archive through **Settings → Machines & setups → Install machine package**. For an existing machine, review the preview and choose **Add and use new setup**. Existing installations and saved revisions keep their exact contents.

Generate a fresh controller artifact from the reviewed saved project and active setup. Compare it against expected controller behavior before any machine operation.
