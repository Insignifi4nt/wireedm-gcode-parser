# Playwright Comet Session

Use this workflow when an agent and the user need to share the same visible Wire EDM tab in the user's existing Windows Comet profile. It avoids WSLg rendering problems and keeps the connection limited to the tab the user approves.

## Known-good setup

- Comet executable: `C:\Program Files\Perplexity\Comet\Application\comet.exe`
- Comet user data: `C:\Users\cristian\AppData\Local\Perplexity\Comet\User Data`
- Official extension: [Playwright Extension](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm), ID `mmlmfjhmonkocbjadbfplnigmagldckm`
- Windows CLI launcher: `~/.local/bin/playwright-cli-win`
- Comet launcher: `~/.local/bin/playwright-cli-comet`
- Session name: `comet`

`playwright-cli-win` runs the Windows copy of `@playwright/cli` with Cursor's bundled Windows Node runtime. `playwright-cli-comet` adds Comet's executable and extension-directory overrides before delegating to it. Use the Comet launcher for both attachment and every later command; Playwright namespaces sessions by configuration.

No extension authentication token is stored in the repository or launchers. The token is optional and should not be printed in commands or logs. The user can approve each connection in Comet instead.

## Start or reconnect

Start Vite first:

```bash
npm run dev -- --host 127.0.0.1
```

Check whether the shared session is already connected:

```bash
playwright-cli-comet --s=comet tab-list
```

If it is not connected, start attachment:

```bash
playwright-cli-comet attach --extension=chrome --session=comet
```

`--extension=chrome` names Playwright's Chromium extension transport; the wrapper redirects discovery and launch to Comet. The user must approve the connection, select only the Wire EDM tab, and leave Playwright's connection page open in the background.

In a PTY, the Windows process may emit the cursor-position query `ESC[6n`. Reply through the active terminal session with `ESC[1;1R`; this is a console handshake, not a browser error.

Verify the selected tab immediately:

```bash
playwright-cli-comet --s=comet tab-list
playwright-cli-comet --s=comet snapshot
playwright-cli-comet --s=comet console error
```

Typical interaction commands are:

```bash
playwright-cli-comet --s=comet click e45
playwright-cli-comet --s=comet screenshot --filename='C:\Users\cristian\AppData\Local\Temp\wireedm-comet.png'
playwright-cli-comet --s=comet reload
```

Read a Windows screenshot from WSL through the equivalent `/mnt/c/Users/...` path.

## Troubleshooting notes

- A gray Linux Chromium window titled `[WARN:COPY MODE]` is a WSLg presentation failure, not an app or Playwright navigation failure. Confirm with `/mnt/wslg/weston.log`; the observed cause was an `rdp_allocate_shared_memory` input/output error. Prefer the Windows-native Comet launcher instead of changing the app.
- `Playwright Extension not found in ...Google\Chrome\User Data` means attachment used the generic Windows launcher instead of `playwright-cli-comet`.
- `"chrome" executable not found` means Comet's executable override was not present. Use `playwright-cli-comet` for the attach command.
- A successful attach followed by `browser 'comet' is not open` usually means later commands omitted the Comet wrapper and queried a different Playwright registry namespace. It can also mean the user closed Playwright's connection page.
- A firewall rule is unnecessary: the CLI, relay, extension, and Comet all run on Windows. Do not expose a remote-debugging port merely to bridge WSL and Windows.
- The HTTP page may remain usable when Vite's HMR WebSocket is disconnected. Restart Vite and keep the browser/server host spelling consistent (`localhost` versus `127.0.0.1`) before changing application code.

## Privacy boundary

Use only the tab the user explicitly approves. Do not enumerate unrelated tabs or inspect profile files, cookies, history, passwords, or stored sessions. Prefer title, URL, accessibility snapshot, console, and screenshots from the selected Wire EDM tab.
