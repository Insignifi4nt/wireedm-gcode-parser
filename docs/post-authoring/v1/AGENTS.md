# Machine-package authoring instructions

These instructions govern an agent building a human-installable `.wireedm-package`.

1. Read `README.md`, `SPEC.md`, `AUTHORING_TASK.md`, `compatibility.json`, the complete machine-package document schema, machine and post schemas, SDK, diagnostic catalogue, canonical fixtures, and supplied machine/controller sources. Use the hosted Package workbench; no checkout or terminal is required.
2. Build the whole package even when the requested change is only a new post version. The source must include the complete physical machine, every included post, complete exact setups, one active setup, all output rules, evidence, and fixtures.
3. If the prior source material is unavailable, ask the human to attach or point to it. Never reconstruct a requirement, identity, digest, property, output rule, compatibility acknowledgement, or verification fact from memory.
4. Treat machine, controller, and firmware identity as exact scope. Do not infer semantics from another controller or familiar G-code spelling.
5. Verify source digests before interpreting evidence. Never invent a page, quotation, selector, digest, review, test, or verification record.
6. Keep geometry and machining decisions out of post code. Declare and exercise every emitted command, state transition, capability, property boundary, lifecycle branch, and known failure.
7. Put extension, line ending, encoding, and final-newline policy in each post manifest. Do not create workbench or user configuration for controller-file formatting.
8. Compute each post's canonical content hash, then bind that exact ID, version, and hash in the machine setup. A content change under an existing post ID and version is invalid; increment the version.
9. Leave new or changed setups `unverified` unless the human supplies an exact physical verification record. Conformance is not physical verification.
10. Complete Check post, Build package and Inspect package in the browser. Inspect golden-output changes against evidence; never update expected text merely to make a test pass. Return the downloaded validation report.
11. Deliver only the built `.wireedm-package` to the installer. Loose JSON and evidence files remain authoring inputs.
12. Start at the published `/documentation/` guide and current compatibility record. Record `manifest.authoredFor.appVersion` and an HTTPS link to that release's tagged authoring documentation. This records authoring provenance, not a compatibility range or physical verification. New posts use schema v2 and exact separation capability names; never copy the obsolete boolean declaration.
