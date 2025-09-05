# PR7: Slim main.js to Bootstrap

Status: Completed

## Summary
Refactor `src/main.js` to only bootstrap `AppOrchestrator`: instantiate, `init()`, attach to `window` for debugging if needed, and `beforeunload` → `destroy()`.

## Motivation
Keep entrypoint minimal and focused on startup/shutdown.

## Scope
- In: Move existing startup try/catch and error-fallback DOM block into the bootstrap around Orchestrator.
- Out: Any logic already handled by orchestrator.

## Acceptance Criteria
- Startup errors still render fallback UI; normal startup unchanged.
- Build passes.

## Test Plan
- Induce errors to see fallback; normal run works; window unload cleans up.

Implementation Notes
- Completed in commit b576c81 (refactor(main): PR5 slim entry to AppOrchestrator bootstrap).
- `src/main.js` now instantiates `AppOrchestrator`, awaits `init()`, sets `window.wireEDMViewer`, and registers `beforeunload` → `destroy()`.
- Preserved startup fallback UI for errors.

Verification
- Manual run confirms normal startup and error fallback behavior.
