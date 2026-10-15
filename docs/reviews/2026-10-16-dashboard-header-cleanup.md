# Header and project row cleanup

Removes the storage badge and its unused presentation derivation from the shared application header on every screen. Storage connection, temporary-session warnings, errors, backup and recovery remain in Settings > Storage. English/Romanian help points there. Project rows are transparent and borderless at rest; hover and keyboard focus reveal the shared surface and edge without shifting layout.

Existing tests now inspect storage through its settings owner. The previous CI run passed 123 browser journeys and found one keyboard assertion that skipped newly added help buttons. That existing journey now checks the actual native Tab order, including help. No UI test case or file was added; storage preservation, focus, recovery and temporary-session behavior remain covered.

Local verification passes 8 files /37 unit cases, all13 affected Chromium journeys, production TypeScript/Vite,92 documentation checks, pinned native corresponding sources and UI ownership. Current production was visually inspected at1651×871, with the real project library retained and no saved data/preferences changed. Evidence: tmp/header-row-{tests,browser,build,standards}.log and tmp/dashboard-header-clean.png. User explicitly requested immediate merge before icon work; this checkpoint uses these completed local checks while the next complete GitHub run follows publication.

App version remains0.0.697. Installed post schemas, capabilities, execution events, audits, output, installation, stored revisions, pinned plugins and both storage adapters are unchanged. No migration occurs.
