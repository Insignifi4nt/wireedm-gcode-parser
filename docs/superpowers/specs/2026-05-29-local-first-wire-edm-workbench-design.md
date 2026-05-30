# Local-First Wire EDM Workbench Design

## Goal

Build a new client-only Wire EDM workbench while preserving the current vanilla JavaScript app as a reference implementation. The new app starts with a dashboard and a browser-managed local storage workbench that works without folder permissions or manual folder selection. Additional modes are exposed only after their functionality exists.

## Product Shape

The app opens to a dashboard with a cache-first workbench flow:

- Initialize `workbench.json`, required folders, and persistent header/footer templates in browser-managed local storage.
- Let the same workbench structure reconnect from browser-managed local storage automatically when the app opens or the user clicks Connect Local Storage.
- Show only real state read from the active workbench. Do not show mock project rows or dead actions.

DXF import now exists for the first supported entity set. Editor porting, verification, and export are later slices. Each slice should add a tested API layer first, then UI on top.

## Preservation Rule

The current app is preserved under `old_reference/current_app`. Its editor behavior, cleanup rules, normalization/export assumptions, canvas preview, drawer, selection, pins, and tailored machine output formatting must not be discarded. New code should port these behaviors deliberately instead of rewriting them from memory.

## V1 G-Code Output

V1 does not model feeds. The output model is:

- Header
- Body
- Footer

Header and footer are persistent user/project/machine templates. Body is generated from imported geometry or edited manually. Export can write the same generated text with `.iso`, `.nc`, `.gcode`, or a custom extension.

## Local Storage

Projects use the same file layout in browser-managed local storage:

```text
part-name.wedm/
  project.json
  operations.jsonl
  imports/
  generated/
  exports/
  templates/
    header.gcode
    footer.gcode
  machines/
    default-machine.json
  editor/
    session.json
```

Local storage is the default so one-off imports work in browsers without directory picker support or folder prompts. OPFS/IndexedDB can be added as a stronger browser-managed backend later.

## Stack

Use Vite, React, TypeScript, Tailwind CSS, and shadcn/ui-compatible component conventions. Keep it static-hostable on GitHub Pages, Cloudflare Pages, Vercel, or a subdomain. No backend is required for v1.

## Initial Scaffold Scope

The first implementation only establishes the new shell and data boundaries:

- Preserve the current app under `old_reference/current_app`.
- Replace the root app with a React/TypeScript shell.
- Add Dashboard only.
- Add workbench project/template/output extension types.
- Add a tested cache/directory storage abstraction and initialization layer.
- Add tested DXF parsing and IJ G-code body generation before exposing import UI.
- Keep editor porting for later focused tasks.
