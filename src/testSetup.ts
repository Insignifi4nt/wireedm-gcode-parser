import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach } from 'vitest';
import { expectNoUnexpectedNativeFailures } from './features/cad/sketch-solver/__tests__/cadSketchNativeFailures';

// Each test receives a fresh browser profile. Adapter suites still inject their
// own factories when they exercise reopen, migration and blocked-upgrade cases.
beforeEach(() => {
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, writable: true, value: new IDBFactory() });
});

afterEach(expectNoUnexpectedNativeFailures);

// React's act helper needs this flag before any root renders. A shared baseline
// also survives tests that stub globals and restore them during cleanup.
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  writable: true,
  value: true
});

// jsdom has no Web Locks API. Persistence tests use the real in-realm mutation queue;
// separate Playwright tests verify the native browser and no-Web-Locks fallback.
Object.defineProperty(navigator, 'locks', {
  configurable: true,
  value: { request: async <Result>(_name: string, mutation: () => Promise<Result>) => mutation() }
});
