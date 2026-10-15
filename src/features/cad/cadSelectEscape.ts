/** Preserve native picker dismissal unless a closed select can be established. */
export function createCadSelectEscapeGuard(document: Document) {
  let functionalOpenState: boolean | undefined;
  return (select: HTMLSelectElement): boolean => {
    if (select.multiple || select.size > 1) return false;
    if (functionalOpenState === undefined) {
      functionalOpenState = false;
      if (globalThis.CSS?.supports?.('selector(select:open)')) {
        // Some older engines recognize the selector without implementing it.
        // A detached open details element verifies semantic matching once.
        const probe = document.createElement('details');
        probe.open = true;
        try { functionalOpenState = probe.matches(':open'); }
        catch { /* An unsupported selector keeps the native select guard. */ }
      }
    }
    if (!functionalOpenState) return false;
    try { return !select.matches(':open'); }
    catch { return false; }
  };
}
