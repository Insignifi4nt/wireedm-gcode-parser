# UPID v2 manufacturing intent

UPID v2 retains the v1 geometry and document structure. The envelope and document both declare `schemaVersion: 2`. It adds two controller-neutral intent values:

- `automatic-during-positioning` for a manual rethread transition whose positioning move separates the wire;
- `after-positioning` for a stop at the destination before threading or cutting.

The host records these choices explicitly and checks exact post capabilities before generation. A post decides how to realize them. UPID carries no controller commands. New domain operations promote a v1 document to v2 when either choice is made. Readers accept valid v1 and v2 files and reject later versions or mismatched envelope and document versions. Existing saved revisions retain their exact bytes, package hash and engine version.

Engine 2 compiles new saved revisions. Engine 1 snapshots remain readable through their original compilation rules and integrity hashes; generating a controller artifact from an old snapshot requires the current compiler to accept the same plan. Otherwise the user must review and save a new revision. This keeps revision history accessible without authorizing an old unsafe route.
