# PR7: Slim main.js to Bootstrap

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

