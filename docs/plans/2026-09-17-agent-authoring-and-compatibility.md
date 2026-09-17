# Agent authoring and compatibility delivery

Requested by Cristian on 2026-09-17. Work on a PR branch; do not merge or deploy without review.

## Ordered scope

1. Review the working Robofil 2.5.0 post, exercise its capability/output fixtures, and publish a separately versioned package if its content changes. Preserve controller output unless evidence supports a correction.
2. Record breaking-change warnings in AGENTS.md. Establish app release tracking: remote main at 45f142c has 685 reachable commits, so the historical baseline is 0.0.685; this PR is 0.0.686. Future PRs increment the patch once, independently of commit count.
3. Add explicit post authoring app provenance, a release compatibility ledger/checklist, and PR verification. Unknown compatibility must not be presented as tested or inferred merely from a version number.
4. Give export errors a copyable agent repair prompt with app/post identity, exact diagnostics, known contract changes, source/documentation pointers, required evidence, and verification commands. Preserve a manual copy fallback; do not silently include geometry or personal files.
5. Publish a concise /documentation/ entry point with static HTML, Markdown equivalents, schemas, SDK, fixtures, llms.txt discovery, and a sitemap. Document the whole journey from an empty agent context to a validated complete .wireedm-package. Correct existing contract drift. Do not claim WebMCP is implemented.
6. Run focused regressions, generated-doc parity, package conformance, build and full tests as appropriate. Open a PR with checkpoint commits, evidence, compatibility warning, and the new package location.

## Deferred work explicitly requested

- Repository hygiene: separate personal machine/postprocessor artifacts from distributable examples and remove obsolete files after auditing test/evidence dependencies. Do not delete them as part of this work.
- Persistence audit: map browser-cache and folder layouts, identify orphaned legacy files, design safe cleanup and a versioned migration mechanism with backups, recovery, interrupted-upgrade handling, and tests. Preserve browser-cache-only and optional-folder workflows.
- After WebMCP implementation: document the actual shipped tools, permissions, discovery, inputs/outputs, and agent workflows, with examples verified against the implementation.

## Completion record

Updated at the end of implementation with verification and PR details.
