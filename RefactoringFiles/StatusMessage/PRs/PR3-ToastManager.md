# PR3: Extract ToastManager + Cleanup

Status: Completed

## Summary
Move EventBus wiring for STATUS_* events out of `StatusMessage.js` into `components/notifications/ToastManager.js`. Slim `StatusMessage` to orchestrate container, queue, and convenience API.

## Scope
- In: `ToastManager` subscribes to `STATUS_SHOW`, `STATUS_HIDE`, `STATUS_UPDATE` and delegates to `StatusMessage` API (`show`, `hideAll`, `update`).
- In: `StatusMessage.init()` now instantiates ToastManager and MessageQueue, and skips its old `bindEvents()` path.
- Out: Behavior or event semantics changes.

## Acceptance Criteria
- Behavior parity for all status flows; EventBus contracts unchanged.

## Implementation Notes
- Added `src/components/notifications/ToastManager.js` with `init()`/`destroy()` managing EventBus subscriptions.
- Updated `src/components/StatusMessage.js` to import and initialize `ToastManager` and to call `queue.destroy()` and `toastManager.destroy()` in `destroy()`.
- Left moved methods replaced by small stubs/comments to keep diffs focused.

## Verification
- Manual tests confirm identical behavior on STATUS_SHOW/HIDE/UPDATE, including queueing, timing, progress updates, and dismiss interactions.

