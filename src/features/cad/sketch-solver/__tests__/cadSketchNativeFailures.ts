// Native failures the shared test solver met in a suite that did not allow them. The solve that met
// one rejects, but a test expecting a rejection could pass on that, so the setup files also fail
// the test after it ends.
const failures: string[] = [];

export function recordUnexpectedNativeFailure(failure: string) { failures.push(failure); }

/** Fails with every unexpected native failure since the last call, forgetting them. */
export function expectNoUnexpectedNativeFailures() {
  const met = failures.splice(0);
  if (met.length) throw new Error(`A sketch solve met ${met.length} native failure(s) the suite did not allow:\n${met.join('\n')}`);
}
