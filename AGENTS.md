# Agent Documentation

## Project Overview

Wire EDM Workbench is being rebuilt as a client-only, local-first Wire EDM app. The scaffold must stay API-first: add tested functionality before exposing UI controls for it. The root app must work without folder permissions by using a browser-cache workbench first, while keeping the File System Access folder flow as an optional persistence upgrade.

## Commands

- `npm run dev` - start Vite on port 3000
- `npm test -- --run` - run tests once
- `npm run build` - type-check and build
- `npm run preview` - preview production build

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
- `src/features/` - feature UI; only Dashboard is active until backing functionality exists
- `docs/superpowers/` - design and implementation planning notes

## Product Rules

- Preserve the old editor behavior before replacing it.
- Do not add mock project names, fake library rows, or buttons that only change screens.
- DXF converted by this app is treated as clean internal geometry.
- Browser-cache and one-off imports must stay supported even when directory picker APIs are unavailable.
- External `.gcode`, `.nc`, `.iso`, and `.txt` files should keep the old cleanup/display pipeline when ported.
- V1 output is header/body/footer G-code. Do not add feed generation by default.
- Output extension is a file-writing choice; it should not change the generated program text by itself.

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
