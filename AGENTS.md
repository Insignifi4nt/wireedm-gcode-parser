# Agent Documentation

## Project Overview

Wire EDM Workbench is being rebuilt as a client-only, local-first Wire EDM app. The scaffold must stay API-first: add tested functionality before exposing UI controls for it. The root app must work without folder permissions by using a browser-cache workbench first, while keeping the File System Access folder flow as an optional persistence upgrade.

## Commands

- `npm run dev` - start Vite on port **3777**
- `npm test -- --run` - run tests once
- `npm run build` - type-check and build
- `npm run preview` - preview production build on port **3778**

## Dev Server Port

- Always run this app's Vite server on the configured obscure port **3777** (`strictPort`). Preview uses **3778**. Playwright owns **3107**.
- Never start this app on common development ports (`3000`, `3001`, `5173`, `4173`, etc.), even as a temporary fallback when 3777 is busy.
- The app registers browser workers that are not reliably cleaned up after the tab/session ends. A leftover worker bound to a previous port can interfere with other projects that later reuse that same port—which is why this app stays off commonly used ports.
- If 3777 is occupied by this app's own leftover process, stop that WireEDM process and restart on 3777. Do not fall back to another port. Do not kill unrelated projects' servers.

## Stack

- Vite
- React
- TypeScript
- Tailwind CSS
- shadcn/ui-compatible component structure
- Vitest

## Structure

- `src/app/` - shell and app-level composition
- `src/components/ui/` - shadcn-compatible UI primitives
- `src/domain/` - workbench, storage, and G-code output models
- `src/features/` - dashboard, editor tools, and their UI tests
- `docs/superpowers/` - design and implementation planning notes

## Product Rules

- Warn explicitly about breaking or potentially breaking changes to installed post processors in the PR, release compatibility record, and affected user-facing diagnostics. Cover schemas, capabilities, execution events, audit rules, output, and installation; never silently rewrite installed packages or saved revisions.
- Ship changes through reviewed pull requests. Each merged PR advances the app version once and includes a compatibility checklist; keep the app release number separate from UPID, post schema, and engine API versions. Do not push directly to main.
- Public documentation and repair prompts serve users and agents with only the hosted app and a cloud browser. Never require a repository checkout, terminal, npm command, or access to another browser's files. Expose needed authoring operations through the hosted UI and shared domain APIs. Keep deployment rationale, release-maintainer procedures and internal roadmap notes out of public authoring pages.
- WebMCP tools reuse application operations and their checks. Keep arguments narrow, distinguish drafts from saved projects, preserve cancellation and input-version checks, and update the public agent-tool guide when changing the exposed tools. Do not bypass UI-only guards by exposing a controller handler directly.

- Preserve the old editor behavior before replacing it.
- Do not add mock project names, fake library rows, or buttons that only change screens.
- DXF converted by this app is treated as clean internal geometry.
- Browser-cache and one-off imports must stay supported even when directory picker APIs are unavailable.
- External `.gcode`, `.nc`, `.iso`, and `.txt` files should keep the old cleanup/display pipeline when ported.
- V1 output is generated from a saved revision and the active machine setup supplied by a complete `.wireedm-package`. Do not add feed generation by default.
- Controller-file rules (extension, encoding, line endings, wrappers, and numbering) belong to the exact post processor inside the machine package; do not add workbench-level output preferences.

## Style

- Technical workbench UI: thin bars, small writing, dense but readable panels.
- Keep files focused and typed.
- Prefer explicit domain models over ad hoc strings for project files, output templates, and export formats.

## Context, Subagent, and Testing Discipline

- Be deliberate with context usage. Do not spawn subagents reflexively or fragment work into tiny delegated tasks. Complete a meaningful investigation or implementation chunk first; delegate only substantial, separable work or independent review.
- When a subagent finds a valid issue and its proposed fix is sound, prefer letting that same subagent implement and verify it so context is not repeatedly transferred.
- Add tests for meaningful behavior, realistic regressions, edge cases, and data integrity. Do not add tests merely to prove removed UI/code is absent unless that absence is an important invariant.
- Use the cheapest reliable verification first. After localized changes, run focused tests and relevant type/lint/build checks; expand to broader suites when changes cross systems, affect shared infrastructure, or have uncertain blast radius.
- Optimize for reliable implementation with proportionate effort, not maximum tool calls, agent count, or test count.
