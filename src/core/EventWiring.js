/**
 * EventWiring
 * Cross-component EventBus subscriptions and global listeners (scaffold).
 *
 * Responsibilities (future PRs):
 * - Centralize event subscriptions across components
 * - Expose attach() / detach() for deterministic cleanup
 * - Handle window-level listeners (resize, unload) in one place
 */

import { EventBus, EVENT_TYPES } from './EventManager.js';

/**
 * Attach event wiring given the app context.
 * @param {Object} app - App context with components and state
 * @returns {Function} cleanup - Detaches all listeners
 */
export function attachEventWiring(app) {
  const bus = EventBus.getInstance();
  const cleanups = [];

  // Example scaffold subscription (no-op for now)
  cleanups.push(bus.on(EVENT_TYPES.APP_READY, () => {}));

  // Return cleanup to detach all listeners
  return function detach() {
    cleanups.forEach((off) => {
      try { typeof off === 'function' && off(); } catch (_) {}
    });
    cleanups.length = 0;
  };
}

export default { attachEventWiring };

