# Dependency maintenance — 2026-09-21

This checkpoint refreshed compatible lockfile resolutions for Vite, Vitest and their affected transitive dependencies without changing their package ranges. It is included in [app release 0.0.687](../releases/0.0.687.json). Vite resolves to 8.3.0 and Vitest to 4.1.11. The resolved npm advisory count decreased from eight (five high, three moderate) to zero at the checkpoint.

The installed npm 10.9.8 failed during dependency-tree planning (`edgesOut` in Arborist) without changing the lockfile. Running the official registry's npm 12.0.2 temporarily through npx completed the update; no global npm installation or system configuration was changed. Node 22.23.2 satisfies that npm version's declared engine requirement.

Vite and Vitest aliases now use `fileURLToPath(new URL(..., import.meta.url))`, avoiding the unsupported ESM `__dirname` convention and the new native-config-loader warning. Production build, documentation checks and focused tests passed after the update; the final branch review records the complete suite result.

No UPID/post/engine schema changes, controller output changes, storage migration or installed-package rewrites are part of this checkpoint. Nothing is deployed by these commands. The new Three.js and OCCT dependencies are covered separately by the simulation architecture and third-party notices.
