# Post-package authoring instructions

These instructions apply to every file under `post-packages/`.

1. Read `docs/post-authoring/v1/README.md`, `SPEC.md`, `AUTHORING_TASK.md`, `compatibility.json`, the generated package schema, SDK declaration, event and diagnostic catalogue, canonical plan fixtures, and the target controller sources before editing a package.
2. Treat the target controller and firmware as an exact scope. Do not infer semantics from another controller, a similar G-code word, a forum post, or a generic CNC reference.
3. Record every source with its real identity and SHA-256. Cite each command through a concrete evidence claim and selector. Never invent a page, quotation, digest, review, test, or verification record.
4. Keep geometry and machining decisions out of post code. Handle every neutral execution event exactly once through the documented API.
5. Declare every emitted controller command in the dialect vocabulary with parameters, state requirements, state effects, and evidence. Do not emit raw unregistered commands.
6. Set every required property explicitly in every fixture. Suggested values are not defaults.
7. Add fixtures that exercise all declared capabilities, lifecycle branches, command families, property boundaries, and known failures. If the canonical registry lacks a required execution plan, stop and report that coverage blocker.
8. Run `npm run post:docs:check` and the post conformance command named in the authoring README. Resolve every error by diagnostic code; do not suppress, normalize, or route around it.
9. Install new or changed machine bindings as unverified. Conformance is not physical machine verification.
10. Report missing evidence or unsupported behavior plainly. An explicit incomplete result is preferable to guessed machine code.
