# StatusMessage Refactor Scope

## Goals
- Split `src/components/StatusMessage.js` into focused notification modules without changing behavior.
- Keep StatusMessage as a thin orchestrator.

## Non-Goals (Phase 1)
- No visual or CSS changes; inline styles and classes remain as-is.
- No change to custom events (`STATUS_SHOW`, `STATUS_HIDE`, `STATUS_UPDATE`).

## Moduleization Plan
- `components/notifications/NotificationStyles.js` — Style helpers (container + message), HTML escaping, and content templating.
- `components/notifications/MessageQueue.js` — Queue and lifecycle (process, show/hide/hideAll, timeouts, progress updates).
- `components/notifications/ToastManager.js` — Orchestrator wiring with EventBus; thin wrapper used by StatusMessage.

## PR Sequence
0. PR0: Scaffold modules with minimal exports (no wiring changes).
1. PR1: Extract NotificationStyles (`applyContainerStyles`, `applyMessageStyles`, `escapeHtml`, content builder).
2. PR2: Extract MessageQueue (queue + process + auto-dismiss + hide/hideAll + progress updates).
3. PR3: Optional ToastManager wrapper + StatusMessage slimming; cleanup and docs.

## Acceptance Criteria
- Behavior and event semantics unchanged; status messages render and dismiss as before.
- Build passes; no duplicate listeners; performance parity.

## Validation
- Manual smoke: success/error/warning/info; progress update; persistent dismissal; hideAll; max message concurrency.

