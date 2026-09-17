# Machine-package authoring task

Use this checklist with a user. Work in the hosted [Package workbench](../../site/tools.md); all schemas and reference files are available through the [contract index](../../site/reference.md).

## Collect these inputs

- Exact machine manufacturer, model, stable ID, known travel and threading hardware.
- Exact controller manufacturer/model and firmware, or explicit unknowns.
- Controller manual, supplied programs and operator records supporting required behavior.
- Required operations and explicitly unsupported behavior.
- File extension, encoding, line endings, final newline, wrappers, numbering and setup properties.
- Stable package/post/setup IDs, new semantic versions and user-facing names.
- Compatibility acknowledgement: who reviewed the target scope, when and on what evidence.
- Target app version and its versioned documentation link for `manifest.authoredFor`.
- Requested verification scope and any supplied exact physical test record.

Ask for missing facts or source files. Do not invent requirements or return a partial package for later configuration.

## Work and completion gate

1. Read the specification, SDK, schemas, fixtures and agent instructions.
2. Add supplied evidence in **Build package** to calculate its byte hashes; match source records to those exact files and paths.
3. Write the deterministic post and exact output rules. In **Check post**, validate and run conformance. Inspect fixture output against evidence.
4. Copy the canonical post hash into a complete machine setup with every required property. Include the full physical machine and all posts in the package document; select an included active setup.
5. In **Build package**, validate/build and download the `.wireedm-package`, package document and report.
6. In **Inspect package**, choose the downloaded archive and validate it. Deliver only after checks pass; report missing app support rather than bypassing it.
7. Keep physical verification unverified without an exact supplied record. Return the target scope, supported behavior, hashes, results, limitations and installation instructions.

For an existing package, start with **Inspect package → Use as build input**. Readable contents from a rejected package are unvalidated repair inputs, not an installable result. Changed post content requires a new version and exact setup reference.
