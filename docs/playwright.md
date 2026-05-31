# Playwright Workflow

The repo has two Playwright paths:

- `npm run test:e2e` runs browser smoke tests against the Vite dev server.
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

Useful variants:

```bash
WIREDM_PLAYWRIGHT_WORKBENCH=/mnt/c/Users/crist/Documents/WireEDM_WEB_FOLDER npm run test:e2e:workbench
npm run pw:seed -- --project cog302000697-2026-05-31
```

`playwright-cli` is wrapped globally in `~/.local/bin/playwright-cli` so WSL browser-control sockets use `/tmp` instead of the Windows temp directory.
