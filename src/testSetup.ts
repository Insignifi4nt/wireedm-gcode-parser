// jsdom has no Web Locks API. Persistence tests use the real in-realm mutation queue;
// separate Playwright tests verify the native browser and no-Web-Locks fallback.
Object.defineProperty(navigator, 'locks', {
  configurable: true,
  value: { request: async <Result>(_name: string, mutation: () => Promise<Result>) => mutation() }
});
