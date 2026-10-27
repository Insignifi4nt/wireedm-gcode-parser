export const CAD_SKETCH_NATIVE_LOAD_FAILED = 'The sketch solver could not be loaded. Edit the sketch again to retry, or reload the page.';
export const CAD_SKETCH_NATIVE_INCOMPATIBLE = 'The sketch solver does not match this version of the app. Reload the page.';

/** Failed solves whose message tells the user how to recover; editor feedback shows them as written. */
export const cadSketchSolverRecoveryMessages: ReadonlySet<string> = new Set([CAD_SKETCH_NATIVE_LOAD_FAILED, CAD_SKETCH_NATIVE_INCOMPATIBLE]);
