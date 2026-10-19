# Node runtime for maintenance

The repository uses Node 24 LTS. `.node-version` is the shared major selection for local tooling and both GitHub workflows; `check-latest` selects its latest available patch. The package and lock-root engine declarations must agree. The application runs on the user's device in a browser and does not require Node to author or import parts.

Use the current official Node 24 release for maintenance. The engines require Node 24.15 or newer because jsdom 30 and its dependencies do. On 19 October 2026 the local gate used the installed Node 24.20.0 with npm 11.19.0; the separate Node 22 installation was removed so shells no longer pick it up first.

GitHub jobs use `ubuntu-24.04` to keep runner image migrations separate from application changes. Checkout, setup-node, artifact and Pages actions use their current Node 24 runtime releases. Review action major upgrades and their permission/artifact contracts; do not add write permissions to the PR verification job.

Run a clean `npm ci`, tests, build, release/documentation checks and browser journeys with the selected runtime. Keep the app version independent of the Node version, post schema and engine API version. Changing Node or action runtimes alone does not authorize deployment, a version tag rewrite, package migration or modification of installed post processors.

Primary references: [Node downloads](https://nodejs.org/en/download), [official release checksums](https://nodejs.org/dist/v24.22.0/SHASUMS256.txt), [setup-node](https://github.com/actions/setup-node), [GitHub runner images](https://github.com/actions/runner-images).
