# App releases and compatibility review

## Version sequence

Remote `main` at commit `45f142c93dfd1cbc92ddb2afa183b6b1d5d0e4f5` contained 685 reachable commits. That historical baseline is recorded as **0.0.685**. The first reviewed release PR is **0.0.686**. From here, each merged PR increments the patch once, regardless of how many commits it contains. Rebase and renumber a waiting PR when another release merges first.

App releases do not renumber UPID, the post schema, the guest API or independently distributed machine packages.

## Required review

Every PR includes `docs/releases/<app-version>.json` and the PR compatibility checklist. Review changes to schemas, execution events, capabilities, audit and output, installation and storage. State whether behavior is unchanged, additive, potentially breaking or breaking; name the affected packages/features and required action. Record actual test scope without claiming untested posts are compatible.

Check app/package-lock parity and the version increment with `npm run release:check -- origin/main`. Run generated contract parity, applicable legacy fixtures and package conformance, full tests and the build. CI repeats these gates. A future storage migration needs a separate design and recovery tests.

After a reviewed merge, the Pages workflow records the immutable `v<app-version>` source tag and publishes the app, docs and release ledger together. Packages can link to the tagged authoring docs even as the current website changes. Historical release records must not be edited by later PRs.

## Discovery design

The site publishes static HTML, Markdown alternatives, a sitemap and a scoped `llms.txt`. This follows the [llms.txt proposal](https://llmstxt.org/) and avoids requiring a crawler to execute the app to read documentation, consistent with [Google's JavaScript crawling guidance](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics). `llms.txt` is a discovery aid; it does not guarantee that every agent will read it automatically.

The GitHub Pages project lives under `/wireedm-gcode-parser/`, so discovery files are scoped there. An origin-wide `robots.txt` or `/.well-known/` policy requires control of the user-site root and is not fabricated inside the project subdirectory.
