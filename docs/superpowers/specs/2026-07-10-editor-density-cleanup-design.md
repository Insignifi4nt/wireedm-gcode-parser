# Editor Density Cleanup

Date: 2026-07-10

## Goal

Remove redundant editor chrome and nested scrolling while keeping the primary Path Project workspace panels immediately reachable from the header.

## Scope

This change is limited to editor presentation and workspace-panel composition. It does not change DXF parsing, UPID data, path editing, selection, panel placement state, persistence, machine-program cleanup, save behavior, or generated output.

## Approaches Considered

### 1. Put every workspace panel in one menu

This gives the cleanest header, but makes frequently used Path Project panels slower to reach and removes useful visible workspace state.

### 2. Keep labeled panel shortcuts

This preserves direct access, but eight text labels consume most of the application bar and compete with document commands.

### 3. Keep compact primary shortcuts and an advanced panel menu

The eight primary panel shortcuts remain as icon-only controls with state-aware hover labels. The categorized panel menu remains available for every panel and for narrow layouts. This is the selected approach.

## Header Design

The editor header becomes one visual row with three groups:

1. **Document identity** — an icon-only Back control, the truncated document title, and one compact document-context badge. The redundant eyebrow and second title line are removed. The full project/file path remains available through hover text.
2. **Workspace shortcuts** — Tree, Actions, Sequence, Transform, Diagnostics, Inspect, Measure, and Machine remain in their existing order as 28px icon-only buttons. Each button keeps an accessible name and exposes `Show <panel>` or `Hide <panel>` hover text based on current placement. A separate compact Panels control opens the existing categorized panel menu for secondary panels and placement state.
3. **Document commands** — Undo, Redo, Save, and Controls are icon-only with accessible names and hover text. Export Preview remains labeled because it is the explicit Path Project post boundary. Import Program is not rendered for `path-project`; it remains available for `empty-program` and `machine-program` contexts.

Visual separators and consistent 28px control sizes distinguish workspace navigation from document mutation commands. The document identity consumes flexible space; command groups do not wrap. At wide desktop widths all primary panel shortcuts are visible. At constrained laptop widths the direct shortcut group yields to the existing Panels menu so document commands remain reachable without horizontal scrolling.

## Contour Tree Design

The persistent Tree Map card, explanatory paragraph, and three-item legend are removed. The Contour Tree toolbar contains only the real controls, root count, and one compact information control.

Hovering or focusing the information control reveals one concise explanation:

- hovering or selecting a tree row cross-highlights the canvas;
- a contour is a whole cut loop containing ordered line/arc segments;
- each segment exposes start and end endpoint handles;
- endpoint joins are inspected through Endpoint Topology in the Panels menu or diagnostics workflow.

The Endpoint Join Map launcher is removed from the Contour Tree because it duplicates the panel menu and consumes permanent space. The Endpoint Topology panel and its behavior are unchanged.

## Workspace Panel Sizing and Scrolling

Each floating or docked workspace panel owns its content scrolling. Panel bodies must not add another height-capped scroller for their primary row collection.

- Cut Sequence removes its repeated title and nested bordered `max-h-32` list. Sequence rows render directly in the panel body while retaining the existing list selector and interactions.
- Contour Tree removes its internal `overflow-auto`; the panel frame scrolls the tree.
- Endpoint Topology and Path Diagnostics retain structural grouping, but their primary result lists lose local `max-h-*` and `overflow-auto` constraints.
- Audit every floating/docked workspace panel for the same pattern. Primary row collections lose their local height cap and scrollbar; compact point pickers, text editors, diagnostics previews, and export previews keep deliberate local bounds because they are secondary controls rather than the panel's main content.

Docking, floating, dragging, resizing, placement controls, row selection, row hovering, keyboard access, and canvas cross-highlighting remain unchanged.

## Accessibility and Interaction

- Every icon-only button has an `aria-label` and hover text.
- The longer Contour Tree explanation is available on both hover and keyboard focus.
- Disabled, active, show, and hide states continue to be communicated without relying on color alone.
- Removing Path Project import chrome does not remove Machine Program import capability.

## Verification

Add focused regression coverage for:

- primary workspace shortcuts remaining directly accessible without visible text labels;
- responsive fallback to the categorized Panels menu;
- `Import Program` being absent from a Path Project and present in empty/machine-program contexts;
- compact document identity and icon-only document commands;
- removal of persistent Tree Map/help/legend content and presence of the combined hover/focus explanation;
- Cut Sequence rows using the panel body instead of a nested capped scroller;
- other primary workspace lists no longer adding local capped scrolling.

Run only the affected Vitest files, the production build, and focused browser layout checks at a wide desktop viewport and the minimum laptop viewport. A full test-suite run is not required for this presentation-only change.

## Success Criteria

- At 1708px width, the application bar has clear document, workspace, and command groups with no crowding.
- The eight primary workspace panels remain one-click accessible and understandable on hover.
- A Path Project shows Export Preview but no machine-code Import Program action.
- The Contour Tree begins near the top of its panel and retains all hierarchy and cross-highlighting behavior.
- Floating and docked panels use one obvious primary scroll region, and Cut Sequence rows use the available panel height.
- Existing editor operations and panel-placement behavior remain intact.
