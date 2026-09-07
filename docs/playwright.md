# Playwright Workflow

The browser tests build a snapshot into `tmp/playwright-dist` and serve it on port 3107. Development uses 3777; the regular production preview uses 3778. Keep these ports separate.

The repo has two Playwright paths:

- `npm run test:e2e` runs browser workflows against a production build.
- `npm run test:e2e:workbench` seeds the browser cache from a real workbench folder, then opens the newest existing project in the editor.

The seeder uses the same browser-cache namespace as the app: `wire-edm-workbench`.

By default it looks for:

1. `WIREDM_PLAYWRIGHT_WORKBENCH`
2. `USERPROFILE/Documents/WireEDM_WEB_FOLDER`

Interactive headed flow:

```bash
npm run dev -- --host 127.0.0.1
npm run pw:open
npm run pw:seed:reload
```

For a shared, foreground session in the user's existing Windows Comet profile,
see [Playwright Comet Session](./playwright-comet.md).

Run a focused browser test:

```bash
npm run test:e2e -- e2e/machine-package-install.spec.ts --workers=1
```

The `pw:*` interactive scripts require `playwright-cli` on PATH. They are optional; `test:e2e` uses the repository's Playwright dependency.

For an external workbench in PowerShell:

```powershell
$env:WIREDM_PLAYWRIGHT_WORKBENCH = 'C:\path\to\workbench'
npm run test:e2e:workbench
```

The external-workbench test skips when no fixture folder is available. Other browser tests create their own projects. Each run uses one build, so later development edits cannot reload a test page. Run the final suite after all intended changes are included in that build.
