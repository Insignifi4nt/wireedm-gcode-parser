import { expect, test as base, type Request } from '@playwright/test';

/** PlaneGCS's runtime, module and WebAssembly, as built and as served in development before 0.0.757. */
const PLANEGCS = /planegcs|cadSketchSolverRuntime|cadSketchSolverModule/i;

/**
 * CAD journeys with every sketch solve answered by the native solver. PlaneGCS was removed in
 * 0.0.757; a test fails when any page or worker in its context asks for it, so it cannot return
 * unnoticed. `solverRequests` lists the WebAssembly and PlaneGCS requests seen, for tests that check
 * the native module itself loaded.
 */
export const test = base.extend<{ solverRequests: string[] }>({
  solverRequests: [async ({ context }, use) => {
    const requests: string[] = [];
    const record = (request: Request) => {
      const { pathname } = new URL(request.url());
      if (pathname.endsWith('.wasm') || PLANEGCS.test(pathname)) requests.push(request.url());
    };
    context.on('request', record);
    await use(requests);
    context.off('request', record);
    expect(requests.filter(url => PLANEGCS.test(new URL(url).pathname)), 'PlaneGCS was requested, so native did not answer every sketch solve').toEqual([]);
  }, { auto: true }]
});

export { expect };
