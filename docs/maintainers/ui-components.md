# Shared UI components

Use the focused modules in `src/components/ui/` for all buttons, inputs, textareas, selects, menus and tooltips. Features own domain labels, eligibility, validation, commands and layout. Shared controls own appearance, keyboard focus, disabled/invalid states and reusable interaction. The common semantic palette is `theme.css`, imported by both application entry points.

## Fields and buttons

`Button`, `Input` and `Textarea` forward native props and refs. Preserve controlled and uncontrolled values, labels, form submission/reset, fieldset disability, native file selection, selection ranges and owner keyboard handlers. Button retains the native default type; command menu items explicitly use `type="button"`. Use an explicit primary variant for the main action. Default buttons are compact and quiet. Use the shared scrim variant for real dismissal overlays.

Code editors, expression fields, checkboxes, sliders and file inputs keep their native contracts. Multiline source rows can use automatic height and monospace type. Layout classes may adjust size, spacing and alignment; feature classes must not supply another control palette, border or focus implementation. Add a shared variant only for a real recurring need.

## Selects

`Select` renders one native select with ordinary options/optgroups. Keep native values, refs, names, multiple/size, form behavior and domain adapters. There is no mirrored selection state. Compact toolbar selects have a transparent trigger until interaction.

Supporting browsers use the CSS customizable-select picker: a styled top-layer surface, common rows, selected checkmark, scrolling and browser collision positioning. Option explanations use `data-description`. Unsupported browsers retain an accessible native picker with explicit theme colors; identical popup rendering across browsers is not promised. Multiple and expanded listboxes keep native listbox behavior.

## Menus and help

Use `MenuSurface`, `MenuItem`, `MenuCheckboxItem`, `MenuLabel` and `MenuSeparator` for command surfaces. The shared layer handles row appearance and fallback Arrow/Home/End/typeahead navigation. Existing feature key handlers run first. Domain owners retain anchoring, outside dismissal, workflow locking and focus return. Checkbox menu rows expose `aria-checked` without nesting a second interactive control.

`Tooltip` uses Radix with portal collision handling, focus/hover and Escape. Button/field `title` props become shared accessible help; native hover-title attributes belong only to the primitive. Keep labels and accessible command names independent of help. Tooltip changes must never replace the underlying field: edits, focus, refs and selected files survive help/disabled changes. Rich CAD diagrams remain explicit click-help disclosures while sharing control styling.

## Enforcement and verification

`npm run ui:check` parses production TS/TSX and rejects raw button/input/textarea/select elements and factories, raw menu/tooltip roles, and native hover-title attributes outside their specific owner modules. Tests and semantic SVG title elements are not controls. Both review and Pages CI run the guard; do not evade it through aliases or generated elements.

Behavior coverage checks native refs/forms/edited-state preservation, disabled fields, help focus/Escape, selection and menu navigation. Visual acceptance must also inspect actual open popups and ordinary field/button/menu/help combinations in CAD, CAM, the library and settings. A tag migration alone does not establish visual consistency.
