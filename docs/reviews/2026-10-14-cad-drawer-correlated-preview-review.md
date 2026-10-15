# CAD view drawer and correlated feature preview review

Review date: 2026-10-14. Fixed repository baseline: `c16a15eb9f9805622ccaeda5b39dc2698ddfda8c`, with the shared, uncommitted CAD implementation on `feature/parametric-cad-workbench`. This review covers the view drawer and its canvas integration, scalar value bindings, whole-document feature candidates, and preview ownership. The source hashes below identify the reviewed snapshot; other CAD work was changing concurrently.

## Confirmed findings and repairs

### P2: Escape on the View toggle cancelled an active feature draft

Escape inside the portal controls already closed the drawer and consumed the event. The View toggle itself had no equivalent handler. With focus still on that toggle, Escape reached the workbench cancellation handler: an edited Pad length of 27 reverted to its accepted length of 10 while the drawer remained open.

The real-workbench regression failed before repair. The toggle now consumes Escape while its drawer is open and uses the existing close/focus-return operation. The tests exercise Escape from both the toggle and the Fit control. They verify that the drawer closes, focus returns, the length input and its draft survive, the viewport remains mounted, Fit is not invoked, and accepted document/version/history remain unchanged. Applying afterward accepts 27 as one history step; one Undo restores the original.

### P2: literal scientific notation normalized before input was complete

The numeric field retained raw text against its previous scalar source, then changed that scalar to a number. The next controlled render rejected the raw-text record. Typing `1`, then `e`, then `2` displayed `100` instead of retaining `1e2`. A following exponent digit could therefore change the intended magnitude by appending to the normalized value.

The real-editor regression failed with `100` before repair. A valid literal edit now records its resulting scalar as the raw text's source, so the controlled render retains the exact notation. Invalid and unchanged drafts retain their original source; named parameter bindings retain their exact expression string. The regression verifies partial notation, valid scientific notation, a subsequent out-of-range exponent, blocked Apply, unchanged accepted history, correction and a single accepted edit/Undo.

The scalar owner separately repaired the net-no-op boundary: a baseline numeric string such as ` 1e1 `, edited to 20 and back to 10, restores its exact original scalar when no explicit relation edit occurred. A deliberate formula unlink remains a real edit even when its final quantity equals the baseline. That repair uses immutable accepted scalar locations and explicit relation-edit intent; it does not infer ownership from a display label.

### P2: incomplete input discarded the last valid preview and private client

A valid provisional Pad of 27 followed by a blank numeric field previously emitted `clear`. The preview returned to the accepted solid of 10 and disposed its private client. Ordinary backspace or unfinished formula input therefore caused geometry jumps and unnecessary client recreation.

A real-editor/coordinator regression first observed the incorrect idle state. An internal `blocked` command now invalidates publication readiness, cancels queued work and aborts the active request while retaining an owner/base/feature-matched last valid preview and its private client. It publishes a validation error; that retained geometry cannot authorize Apply. A corrected full candidate receives a new serial/key and resumes on the same client. Actual Cancel still clears ownership and disposes the client.

The deferred-build regression also verifies that an obsolete build cannot publish after input becomes blocked or after a newer candidate is queued. The editor case checks blank numeric input and an unfinished `depth /` formula, disabled Apply, untouched accepted document/history, a corrected candidate using the same client, and disposal on Cancel. Factory/build/dispose counts are lifecycle evidence from a mock private kernel, not measurements of native rebuild time.

### P2: a blocked stale-base request retained obsolete preview resources

A second regression changed the accepted document, then sent a blocked command carrying the preceding document version. Before repair, the guard reported an error but retained the preceding preview and private client. The coordinator now clears those resources when its current-document assertion fails, before publishing the validation error. A corrected command against the new base creates a fresh client. Storage-switch invalidation was already correct and is covered separately.

## Reviewed invariants

- The collapsed drawer is inert and hidden from assistive technology. Its view controls use the stable portal host; opening or closing the drawer does not conditionally mount the viewport, resize the canvas or call Fit. Escape from the drawer is contained; Escape elsewhere retains the workbench's existing cancellation behavior.
- Fit reads the current tree, inspector and dock rectangles and selects the available canvas area. The focused geometry tests cover unobscured areas and obstruction combinations. The live browser remains responsible for verifying physical hit testing, scrolling and camera framing.
- A feature candidate contains the feature edit first and its sorted named-parameter edits afterward. The deterministic key covers the complete edit tuple. Preview applies this batch to the accepted document and validates the whole result; Apply uses the same batch in a single session operation.
- Preview readiness remains pinned to owner, base version, document/storage identity, serial and the complete candidate key. Raw numeric or formula input blocks readiness independently of an earlier ready candidate. Cancel, replacement, stale base and storage invalidation release obsolete resources.
- Editing a simple named binding updates its shared parameter while retaining the exact source string. Compound relations remain read-only until an explicit relation choice. Numeric quantity fields preserve precision and valid raw notation. Returning an independent literal to its accepted quantity restores the exact baseline scalar unless the user deliberately changed its relation.
- Fixed field identities follow domain scalar locations, including vector indices, independently of translated or repeated labels. Repeated Curve/path controls remain outside this value context until their precise location ownership is supported.

No further confirmed defect remains in this review scope after these repairs. This conclusion does not certify all CAD operations or the visual browser experience.

## Verification

- Drawer, Fit, sketch canvas and viewport checks: **68 tests in 5 files passed**, 3.19 seconds.
- Final focused drawer, preview, blocked-state, scalar and scientific-notation run: **37 tests in 8 files passed**, 4.70 seconds.
- Independent scalar-owner consolidated run, including the retention/blocked/scientific cases: **257 tests in 18 files passed**.
- `npx tsc -b --pretty false`: passed after the final scalar and preview changes.
- Scoped `git diff --check`: passed; Git emitted the existing CRLF notice for the editor source.

The parent task owns production build and actual browser verification. Plane-selection changes belong to the native feature owner. The icon inventory remains its earlier documented snapshot and will be refreshed by the parent after source stabilizes. This review did not start a server, control a browser, commit/push changes or mark the overall CAD goal complete.

Reviewed source SHA-256 identifiers:

| File | SHA-256 |
| --- | --- |
| `src/features/cad/CadCommandDock.tsx` | `6B18576199AB8779AF7059316FE70A08AC478B335FAD73904DC4D2F42161062F` |
| `src/features/cad/cadFeaturePreview.ts` | `A4B72626779D86027ADB5309BCE866E2E8FE64A3FDB83AFC5501A865C858E7F7` |
| `src/features/cad/CadFeatureEditor.tsx` | `075828D82CFBA17668846C2F101E0DBADF0E3074A0E915AFFDFA1399E5E51236` |
| `src/features/cad/CadFields.tsx` | `042BAB0E6A9BA25B01D60DDC107BB1E4C11253B73484CF85F0C729933A42C664` |
| `src/features/cad/cadFitArea.ts` | `7BD3BCC329A2FBA2D370DA8562D597999D2F87C0AB85E0C899D1504A6CEB833B` |
| `src/features/cad/CadWorkbench.tsx` | `851B5C946B181A6EE60568AE47B4510C4B03DF19103660551F37B6949892A18F` |
| `src/features/cad/CadSketchCanvas.tsx` | `476BDCDCA5743FC974E145C402E093754EF421434363FC56B6A712A082AED900` |
| `src/features/cad/CadViewport.tsx` | `D3ABDE1B86BC928B88036C6A9FBC03E00C07379F6CDA791EF209684CEFBBF8AE` |
