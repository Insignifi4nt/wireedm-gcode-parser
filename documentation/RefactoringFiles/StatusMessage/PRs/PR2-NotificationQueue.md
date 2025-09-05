# PR2: Extract MessageQueue

Status: Completed

## Summary
Move queue processing, DOM creation, auto-dismiss timers, progress updates, and hide/hideAll logic into `components/notifications/MessageQueue.js`.

## Scope
- In: `enqueue`, `_process`, element creation with styles/content, progress updates, animate in/out, hide/hideAll, stats.
- Out: EventBus wiring and convenience methods (stay in `StatusMessage`).

## Acceptance Criteria
- Behavior parity for queued messages, timing, progress bar, click to dismiss, and hideAll.

## Implementation Notes
- Added `MessageQueue` with dependency injection for `container`, `maxMessages`, `ANIMATION`, `STATUS` and reuse of `NotificationStyles` helpers.
- Updated `StatusMessage` to:
  - Initialize `MessageQueue` in `init()`.
  - Delegate `show()` to `queue.enqueue(messageData)`.
  - Delegate `update()`, `hide()`, and `hideAll()` to queue methods.
  - Replace in-file `processQueue`, content/style helpers, and animation/progress methods with comments (moved).

## Verification
- Manual tests show identical behavior for message display, ordering, auto-dismiss, progress updates, and dismissal. No duplicate listeners.

