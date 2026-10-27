/**
 * Fetches and compiles the native solver module once, for every instance a worker creates. A
 * response that is not OK, a failed download or a failed compilation is not kept, so the next
 * load fetches again.
 */
export function createCadSketchNativeModuleLoader(url: string | URL, fetchModule: typeof fetch = fetch) {
  let compiled: Promise<WebAssembly.Module> | undefined;
  return () => compiled ??= (async () => {
    const response = await fetchModule(url);
    if (!response.ok) throw new Error(`The sketch solver module could not be downloaded (HTTP ${response.status}).`);
    return WebAssembly.compile(await response.arrayBuffer());
  })().catch(error => { compiled = undefined; throw error; });
}
