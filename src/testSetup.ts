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
