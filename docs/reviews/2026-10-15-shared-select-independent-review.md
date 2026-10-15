# Shared Select independent review

Reviewed the uncommitted change against `66610357afd6d1e44ea98eb3ec5d4887b0ef8b51`, AGENTS.md, `docs/maintainers/ui-components.md`, the component/scanner tests and the recorded public WebMCP gear workflow. This was a bounded source review. No browser, application state, commit or production file was changed by this reviewer.

No material finding.

- `src/components/ui/select.tsx:10` renders one native select and forwards its ref and HTML props. There is no second selection state or value translation. Controlled/uncontrolled values, labels, options, form reset/submission, numeric size, multiple selection and disabled fieldsets retain their native contract. The five component cases cover these behaviors and event/ref forwarding.
- `src/app/MachinePostSettingsPanel.tsx:1,354` keeps its existing generic validation adapter and uses the imported `NativeSelect` underneath it. The import does not shadow or recursively invoke the local adapter. Inspected CAD, dashboard, editor and simulation replacements preserve their handlers, eligibility guards and option values.
- `src/components/ui/select.css:1` establishes layer order before component defaults, allowing existing utility sizing. Semantic tokens own trigger, opaque popup, selected/disabled/invalid and keyboard-focus appearance. Removed feature rules no longer compete for those states; remaining select rules size/place controls or apply contextual typography.
- `scripts/check-ui-controls.ts:6,25` parses production TS/TSX, reports JSX/direct factory locations and excludes tests and the sole primitive. Scanner cases distinguish comments, strings, types and shared components. Both CI workflows invoke the guard. Documentation accurately limits automated enforcement to select ownership and forbids alias/generated-control evasion.

`git diff --check` passed. The root owns the reported 219-case validation, final build and actual popup/keyboard contrast verification. No broad test/build was duplicated. Native popup rendering remains browser/OS dependent; source and DOM tests alone do not establish its appearance on every platform. No domain, persistence, package, modeling or WebMCP behavior change was introduced by this migration.
