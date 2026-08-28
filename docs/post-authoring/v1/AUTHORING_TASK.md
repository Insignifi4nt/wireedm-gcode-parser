# Post authoring task v1

Copy this file into an agent task and replace every bracketed value. Missing inputs block authoring. Do not guess them.

## Required inputs

- Package ID: `[reverse-domain-style stable ID]`
- Initial semantic version: `[exact SemVer]`
- Controller manufacturer: `[manufacturer]`
- Controller model or family: `[exact identity]`
- Applicable firmware or revision: `[exact value or documented unknown]`
- Machine models in scope: `[exact list, possibly empty]`
- Primary controller sources: `[local paths or URLs]`
- Expected SHA-256 for each source: `[digest supplied or permission to compute from the exact artifact]`
- Allowed package output path: `post-packages/[package-id]/package.wireedm-post.json`
- Required controller behaviors: `[commands and lifecycle to support]`
- Explicitly unsupported or unknown behaviors: `[list]`
- Requested verification level: `[schema, conformance, simulation, controller dry-run, or physical test]`

## Work contract

1. Read `README.md`, `SPEC.md`, `compatibility.json`, the package schema, SDK declaration, event and diagnostic catalogue, canonical plan fixtures, and `post-packages/AGENTS.md`.
2. Verify each source digest before interpreting it. Stop if the artifact differs from its supplied digest.
3. Create evidence records before implementing commands. Scope every claim to the exact controller, machine, and firmware established by the source.
4. Declare unsupported behavior conservatively. Do not infer command meaning from another controller or from familiar G-code spelling.
5. Implement only the `createPost(api)` guest API. Emit registered commands, preserve every motion event exactly, and disposition every event once.
6. Use only fixture IDs published in `compatibility.json`. If those plans cannot exercise every claimed command, capability, property boundary, lifecycle branch, and known failure, stop and report the missing fixture coverage.
7. Run:

   ```text
   npm run post:docs:check
   npm run post:conformance -- post-packages/[package-id]/package.wireedm-post.json
   ```

8. Inspect every golden-output change against the cited controller evidence. Never update expected output only to make conformance pass.
9. Report package validation and conformance diagnostics by exact code. Report runtime representation limits separately.
10. Leave every new or changed machine binding unverified. Conformance does not establish controller or physical-machine safety.

## Completion report

Return these exact facts:

- package path, ID, version, and canonical content SHA-256;
- controller, firmware, and machine scope;
- source identities and verified digests;
- supported and unsupported capabilities;
- conformance command and JSON result;
- fixture coverage reviewed by the author;
- unresolved evidence, fixture, runtime, simulation, or physical-verification limits.
