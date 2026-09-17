# Create a package in your browser

Use the [Package workbench](tools.md) throughout this workflow. You need a browser, the user's machine information and their controller evidence. No repository checkout or terminal is required.

## 1. Establish the machine and required behavior

Ask for the machine manufacturer/model, controller manufacturer/model, firmware if known, X/Y travel, threading hardware and required operations. Obtain the exact controller manual and representative known-good programs. Keep unknown facts explicit; a related machine's manual does not verify this controller.

Agree on extension, encoding, LF/CRLF, final newline, program wrappers, numbering, coordinate precision and setup properties. Use the [input checklist](../post-authoring/v1/AUTHORING_TASK.md) to collect missing facts before implementing behavior.

## 2. Read the contract you need

Read the [package specification](../post-authoring/v1/SPEC.md), [guest SDK](../post-authoring/v1/sdk/wire-edm-post-sdk.d.ts), [agent instructions](../post-authoring/v1/AGENTS.md) and [schemas and fixtures](reference.md). These are downloadable directly from this site.

New posts use **post schema v2** and engine API `"1"`. Record the app version shown in the Package workbench and the versioned documentation link from [App releases](releases.md). App release numbers and schema/API numbers have separate meanings.

## 3. Write and check the post

Create a `.wireedm-post.json` document. Use the [minimal example](../post-authoring/v1/examples/minimal.wireedm-post.json) for structure only; supply your own target, commands, evidence, IDs and tests.

Set its `manifest.authoredFor` to the target `appVersion` and its HTTPS `documentationUrl` before checking the post. This records the authoring target, not compatibility with every app release or physical verification. Any later change to the post requires a new check and updated hash in its setup reference.

Map each execution event to its controller commands, prerequisites, effects and evidence. Declare only implemented capabilities. `wireSeparation` is an array of exact mechanisms; `[]` claims none. Threading is a separate capability.

The deterministic guest exports `createPost(api)` and handles `onEvent(event)`. Use `api.emitMotion` for motion/positioning, `api.emitCommand` for non-moving commands, `api.consume` for an intentionally silent event, and `api.getProperty` for setup values. The SDK defines their exact signatures. The post owns controller syntax and state; the app owns geometry and machining intent.

In **Check post**, paste the JSON or choose its file, then select **Validate post and run conformance**. Inspect the report's diagnostics and exact fixture output. Correct the inputs and repeat until checks pass. Copy `post.contentHash` from the report for the machine setup. This is the canonical JSON hash, not a hash of the formatted file bytes.

## 4. Assemble the machine package

In **Build package**, paste a complete document matching the [machine-package schema](../post-authoring/v1/schema/machine-package.schema.json). It contains:

- `format: "wire-edm-machine-package"` and `schemaVersion: 1`;
- `manifest`: the package ID, version, name and description;
- `machine`: physical identity, hardware, limits, evidence and complete setups;
- `posts`: the complete checked post documents;
- `activeBindingId`: an included setup ID.

Each setup references an exact post ID, version and canonical hash, supplies every required property and includes an explicit compatibility acknowledgement. Leave physical verification `unverified` without an exact machine test record.

Add the evidence files. Each row displays its byte SHA-256 and an editable archive path, such as `evidence/controller-manual.pdf`. Copy that exact path and digest into the document's evidence/source records. **Add text evidence** supports supplied operator notes without requiring a local text editor. Never turn a generated example into a claimed known-good program.

## 5. Build and inspect

Select **Validate and build package**. The workbench verifies document shape, machine/post bindings, evidence bytes and declared fixture conformance before offering **Download .wireedm-package**. Review the report, then download the package, package document and report.

Choose the downloaded archive in **Inspect package** and select **Validate and inspect package** to check the deliverable. For an update, you can start here with an existing package and choose **Use as build input** to retain its readable document and evidence in the builder. If inspection fails, those contents are unvalidated repair inputs and must pass a new complete build before installation.

If a check fails, fix the reported cause. Do not relax capabilities, invent fixture IDs, rewrite expected output merely to pass, or change the user's machining choices to bypass validation. Report a missing canonical fixture or unsupported API behavior as an app limitation.

## 6. Deliver and install

Return the `.wireedm-package`, editable package document, evidence files and validation report. State the exact target, supported behavior and remaining limitations. Files in your cloud browser are not automatically available in the user's browser; give them the download or attachment.

The user installs the archive through **Settings → Machines & setups → Install machine package**, reviews the preview and selects the new setup. Then generate output from the reviewed saved project. Software checks do not replace controller simulation or an evidenced physical test.
