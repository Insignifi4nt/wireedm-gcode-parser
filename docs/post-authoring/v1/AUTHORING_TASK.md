# Complete machine-package authoring task v1

Copy this file into an agent task and replace every bracketed value. The agent and human should resolve missing inputs before a package is built. Do not guess them.

## Required inputs

- Target app version and immutable documentation URL: `[app version]`, `[tagged documentation URL]`; record these in `manifest.authoredFor`.

- Package ID and semantic version: `[stable ID]`, `[exact SemVer]`
- Source directory and output package path: `[directory]`, `[file.wireedm-package]`
- Physical machine stable ID and name: `[ID]`, `[name]`
- Machine manufacturer, model, and serial number: `[exact values or documented unknown]`
- Controller manufacturer, model/family, and firmware: `[exact values or documented unknown]`
- X/Y travel and threading hardware: `[known measurements or explicit unknowns]`
- Machine evidence: `[local paths or URLs, identities, and supplied digests or permission to compute them]`
- Post ID and semantic version: `[stable ID]`, `[exact SemVer]`
- Controller evidence: `[local paths or URLs, identities, and supplied digests or permission to compute them]`
- Required controller behavior and lifecycle: `[commands, ordering, state, supported operations]`
- Explicitly unsupported or unknown behavior: `[list]`
- Controller-file rules: `[extension, LF/CRLF, ASCII/UTF-8, final newline yes/no]`
- Setup ID, human name, and every required post property: `[complete values]`
- Compatibility acknowledgement: `[who, when, evidence-backed notes]`
- Requested verification level: `[schema, conformance, simulation, controller dry-run, or physical test]`

If the agent no longer has any required source or exact requirement, it MUST ask the human to attach or point to it again. It MUST NOT emit a partial package for later in-UI completion.

## Work contract

1. Read the complete authoring kit and scoped `AGENTS.md`.
2. Verify every source digest. Stop if an artifact differs from its expected digest.
3. Record machine and command evidence before implementing behavior. Keep unknown facts explicitly unknown.
4. Implement the post through only the documented deterministic `createPost(api)` guest API.
5. Declare the exact controller-file rules under `manifest.output`.
6. Run post conformance and review every exact expected program against the cited evidence.
7. Compute the post's canonical content SHA-256 and place that exact reference in the machine setup. Supply every required setup property and explicit compatibility acknowledgement.
8. Create `machine-package.source.json` referencing the complete machine and every included post. Select an included setup with `activeBindingId`.
9. Run the completion gate:

   ```text
   npm run post:docs:check
   npm run post:conformance -- <source-directory>/<post-file>.wireedm-post.json
   npm run machine-package:build -- <source-directory> <output.wireedm-package>
   npm run machine-package:validate -- <output.wireedm-package>
   npm run machine-package:inspect -- <output.wireedm-package>
   npm test -- --run
   npm run build
   ```

10. Leave new or changed setups unverified unless an exact physical verification record was supplied.

## Completion report

Return these exact facts:

- package path, package ID/version, archive SHA-256, and successful validation result;
- machine ID, identity scope, physical limits, hardware, evidence identities, and verified digests;
- each post ID/version/content SHA-256 and controller/firmware scope;
- each setup, exact post reference, resolved properties, compatibility status, and active status;
- controller-file rules;
- conformance command/result and reviewed logical-program plus final-artifact fixture coverage;
- unsupported behavior and unresolved evidence, runtime, simulation, or physical-verification limits.
