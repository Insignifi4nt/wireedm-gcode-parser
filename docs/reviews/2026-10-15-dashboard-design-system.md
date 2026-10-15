# Dashboard and shared design delivery

Baseline: `e62cb882804c0b998b670031a3a4c3d9e17129fd`, branch `feature/parametric-cad-workbench`, existing PR12, release `0.0.697`. That baseline has green GitHub verification. This checkpoint addresses the library annotations and formalizes the shared design direction; it does not mark the broader CAD audit complete.

## Delivered behavior

The library sits directly on the page without its former outer panel. Title, count, expanding search and compact filters share a header. Real project cards distinguish name, source and update time while preserving Open, Rename, Delete, Revisions and Export. At narrow widths controls wrap and actions move below the project identity. No sample projects or navigation-only actions were added.

Start work uses sentence-case headings with named info buttons instead of permanent explanatory paragraphs. The native import inputs, guards and menu owner remain unchanged. Shared SearchField keeps one controlled query and a stable input; active filters remain visible, opening focuses the field, and Escape clears it and returns focus without consuming composing input. InfoTip reuses shared accessible help. Joined action styling and select chevron alignment belong to shared CSS.

The design contract is `docs/maintainers/ui-components.md`, linked from AGENTS. Theme tokens define type, spacing, control density, corners, icon sizes and motion. Production guards reject unshared controls/help/menus, forced-uppercase styles, literal shared-control colors outside the theme and feature paint overrides of reserved shared selectors. Deliberate geometry/status colors, source text and measured technical layouts remain supported. The guard establishes code ownership; actual visual behavior still requires review.

## Verification and test scope

No UI test file, UI test case, visual snapshot or copy-specific case was added. Existing dashboard behavior coverage now exercises expanding search and Escape. Existing navigation checks use stable accessible commands. The architecture guard gained three fixtures for actual enforcement boundaries, including positive examples that must remain accepted.

The complete existing unit run passed 392 files and 4,154 cases, with one failure caused by an obsolete uppercase `MIDPOINT` assertion. That assertion was replaced with exact candidate coordinates `(5, 0)` in SVG space; the focused case and complete affected 106-case suite pass. All 393 files / 4,155 cases have passing evidence across the complete run and that bounded rerun; this is not a claim of a second complete invocation. Production application logic was unchanged by this repair. No broad rerun is needed for that test-only change.

All five affected Chromium journeys pass: wide dashboard, 1024px layout, compact populated library, project action focus/cancellation and trash restore after reload. Production TypeScript/Vite build, all 92 documentation checks and pinned native corresponding sources pass. Final UI ownership, release compatibility and whitespace gates pass; generated docs and the complete icon catalogue are refreshed, including each new help/search call site. Independent source review found no actionable regression; its contract/guard proof is `2026-10-15-dashboard-design-review.md`. The separate case migration record is `2026-10-15-interface-sentence-case.md`.

Actual current production at localhost3778 was inspected in the in-app browser at 1651×871. The header aligns, document width equals viewport width, the actual open source picker is styled, heading help opens on keyboard focus, search filters and Escape restores the library. No saved project, preference or draft was modified by this pass. The updated dashboard remains open. Temporary visual evidence: `tmp/dashboard-design-final.png`, `tmp/dashboard-design-help.png`, `tmp/dashboard-design-picker.png`. Logs: `tmp/dashboard-design-{build,full,focused,browser-tests,midpoint-suite}.log`.

Installed posts, schemas, capabilities, execution events, audits, output, installation, saved CAM revisions, pinned CAD plugin definitions and storage adapters are unchanged. No migration, merge, deployment or second release increment occurs.
