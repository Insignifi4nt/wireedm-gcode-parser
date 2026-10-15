# Project navigation independent review

Reviewed the working tree against `10ac04b` in `feature/project-navigation`, including untracked routing, CAD project-library and static-fallback sources. Scope: app routing and settings, asynchronous project opening, retained CAD draft/history ownership, saved-project rename/archive/restore, and deployment asset paths. No unresolved actionable finding remains in this scope at this source revision.

## Findings repaired and independently rechecked

- First CAD save previously pushed `/cad/<id>` after `/cad`, so browser Back resumed the saved workspace and pushed forward again. `useWorkbenchRoutes.ts` now replaces generic-to-saved and same-decoded-ID normalization entries, including encoded IDs and trailing slashes; actual identity changes still create history entries.
- Opening a clean retained CAD ID previously skipped canonical storage, exposing stale renamed content or an archived snapshot. Explicit clean IDs now reload through `openDocument`; dirty same-ID drafts retain their owned edits. Generic `/cad` remains the intentional retained-workspace entry.
- A cancelled editor read could reopen its project after navigation away. The route passes its abort signal; the controller checks cancellation before and after the read and verifies adapter identity before publishing. New locations also clear stale loading state before early returns.
- Deleting every feature from a saved document made its unsaved changes appear disposable. Shared `hasUnsavedCadDraft` now recognizes a saved baseline even when document content is empty, consistently covering replacement, navigation, storage switching and unload protection.
- Dashboard CAD mutations now use controller operations with global busy, active-workflow, current-adapter and dirty-current-ID guards. Successful rename reconciles the normalized receipt name and preserves Undo when the saved baseline matches. Successful archive clears only an unchanged clean retained document after the durable commit, preventing later generic resume/save from resurrecting its saved identity. Failed or stale actions do not reset the session.

## Integrity and integration assessment

CAD archive/restore preserves exact raw file contents and fingerprints. Transactions check before-images, reject occupied archive/restore destinations, verify writes and retain recovery information after interruption. The shared mutation lock and adapters cover browser cache and folder storage. Library refreshes are adapter-owned and cancellation-aware; malformed originals are reported without destructive inference. Existing domain cases cover both adapters, conflicts, interrupted operations and exact-content round trips.

The browser router uses the configured base path. The build copies the emitted entry document to `404.html`; worker and WASM assets resolve through emitted asset URLs rather than nested document-relative paths. Missing routes/projects retain a recovery path. These source checks do not establish hosted fallback behavior or Firefox layout correctness.

## Verification boundary

This reviewer used source/diff inspection and reviewed the focused regression changes; no production source, saved records or browser state was mutated, and no duplicate build/full-suite/browser run was started. The main agent reports the four focused regression cases green. Its initial affected browser run passed five of six journeys; the remaining failure was a corrected settings locator. Final production-build, full-suite, latest-build browser and Firefox results belong to the main agent's release gate. This record makes no blanket visual, native CAD or deployment certification claim.
