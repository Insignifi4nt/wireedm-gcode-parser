# EventManager Refactor Scope

## Goals
- Reduce size and complexity by splitting responsibilities while preserving public API used across the app.
- Introduce a clear separation between EventBus (singleton), EVENT_TYPES (constants), and EventUtils (helpers).
- Maintain full backward compatibility via re-exports from `src/core/EventManager.js` during the transition.

## Non-Goals (Phase 1)
- No renaming of event types or semantics.
- No behavioral changes to subscription lifecycle, delegation, or validation.
- No removal of the default export until all imports are migrated safely.

## Constraints
- Keep imports stable for `src/main.js` and components that use `{ EventBus, EVENT_TYPES, EventUtils }` from `./core/EventManager.js`.
- Preserve validation/logging toggles and error handling paths.

## Moduleization Plan
- `core/events/EventBus.js` – EventBus singleton and wrapper helpers (on/once/off/emit/delegate).
- `core/events/EventTypes.js` – EVENT_TYPES constant (named export).
- `core/events/EventSchemas.js` – EVENT_DATA_SCHEMAS (payload schemas).
- `core/events/EventValidator.js` – Validation logic using types + schemas.
- `core/events/EventUtils.js` – Mouse/keyboard payload builders; may re-export emit controls.
- `core/events/EmitControls.js` – debounce, rateLimit, deduplicate, throttle (if separated from EventUtils).
- `core/events/index.js` – Optional barrel for direct imports later.

## PR Sequence (expanded)
0. PR0: Scaffold events module directory and optional barrel.
1. PR1: Extract `EventTypes` (constants).
2. PR2: Extract `EventSchemas` (payload schemas).
3. PR3: Extract `EventValidator` (validation logic).
4. PR4: Extract `EventBus` (singleton + wrappers).
5. PR5: Extract `DOMDelegation` (delegate + handler).
6. PR6: Extract `EmitControls` (debounce, rateLimit, deduplicate).
7. PR7: Extract `EventHistory` (history + metrics).
8. PR8: Bridge/compatibility re-exports from EventManager.
9. PR9: Cleanup and finalize single sources of truth.

## Current State Observations
- EventManager.js currently contains: EVENT_TYPES, EVENT_DATA_SCHEMAS, EventManager (bus impl with history/metrics), EventValidator, EventBus (singleton wrapper), and EventUtils (mouse/keyboard data + emit helpers).
- A separate `src/core/EventDelegator.js` is already used for UI delegation. `EventManager.delegate(...)` is not referenced by the codebase. We will preserve API compatibility but treat DOMDelegation extraction as low risk/optional, deferring any migration to use EventDelegator explicitly.
- External imports across the repo use named exports `{ EventBus, EVENT_TYPES, EventUtils }` from `./core/EventManager.js`. No default import of EventManager detected; keep default export during the transition.

## Acceptance Criteria
- Parity: events flow identically across mouse/touch/keyboard/toolbars/drawer/status.
- Compatibility: existing imports of `{ EventBus, EVENT_TYPES, EventUtils }` from `./core/EventManager.js` keep working.
- Build passes (`npm run build`); no runtime errors.
