# Shared UI components

Use `src/components/ui/` for reusable controls and interaction foundations. Features compose these controls with domain labels, validation, commands and layout. They do not create another appearance or keyboard implementation for an existing control.

Existing foundations include `Button`, `Select`, `SlidingTabs`, `RailResizeHandle` and `useModalFocus`. Import the specific module, rather than introducing a barrel. Keep the native element and its props/ref where native behavior serves the task. A new reusable pattern belongs here before its first feature consumer; add behavior coverage appropriate to its contract.

## Native select

`Select` renders one native `<select>` and forwards its ref and HTML props. Keep ordinary `<option>` and `<optgroup>` children, label association, controlled `value`/`onChange`, uncontrolled `defaultValue`, native numeric `size`, `multiple`, `name`, form reset/submission and disabled fieldsets. Do not translate values or create a second selection state in the primitive. Domain-specific adapters such as CAD's `SelectField` still validate eligible choices.

The shared component owns trigger and popup colors, border, disabled/invalid states and visible keyboard focus. It uses the semantic tokens in `src/index.css`; popup options and optgroups receive explicit opaque foreground/background colors. Selected and disabled options have shared theme states. Native browser/OS popup behavior remains native, including keyboard selection and forced-colors support.

Feature classes may set width, height, spacing and contextual typography. Use `density="compact"` for a tightly constrained toolbar. They must not override shared background/text colors, borders or interaction states. If another appearance is needed by several consumers, add a shared variant with a real consumer instead of a feature-specific theme.

`npm run ui:check` parses production TS/TSX and rejects raw `<select>` or direct `createElement('select')` calls outside `src/components/ui/select.tsx`. Tests are excluded. Both review and Pages CI run the check. Its scanner tests distinguish code from comments and strings. Do not evade the standard through aliases or generated controls.

## Other controls and migration scope

Use the existing shared `Button` for new or changed reusable button patterns. Use semantic foreground/background, surface, border, ring, accent and destructive tokens; do not copy literal feature palettes into controls. Focus must remain visible, disabled state must be truthful, and accessible names/labels stay with the domain composition.

The select migration covers every production select. Existing raw buttons, text inputs and textareas remain separate migration work. `.technical-input` already supplies a shared token-based text-field appearance, but several CAD/simulation fields still have feature styles. Source/code editors, dimension/expression inputs, and native checkbox/range/file inputs have distinct interaction contracts. A future Input/Textarea migration should first identify those contracts and real consumers, then move repeated appearance into shared foundations without changing commit, selection or keyboard behavior. Do not add unused wrappers or mechanically replace specialized controls to satisfy a tag count.

The broader reuse rule is a review requirement. The current automated guard enforces select ownership only; it does not claim all legacy controls have already migrated.
