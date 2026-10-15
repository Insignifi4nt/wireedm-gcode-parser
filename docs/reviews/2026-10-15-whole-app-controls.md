# Whole-app controls implementation and acceptance

Baseline: 6e85fd8. The user rejected a native-looking selector and requested visual consistency across all fields, buttons, menus and tooltips. Implementation retains the shadcn-compatible component directory, Radix Slot/Tooltip and native form controls. Features retain domain validation, refs, events and workflow guards.

## Design choice

The shared select uses CSS customizable-select rather than introducing mirrored value state or rewriting every form adapter. The supported picker renders in the top layer with common popover tokens, compact rows and selected checkmarks. A browser-native fallback remains for engines without base-select. Actual browser inspection is required: coloring a native trigger alone was the earlier shortcoming.

Primary references: [Chrome customizable select](https://developer.chrome.com/blog/a-customizable-select), [MDN customizable select](https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Forms/Customizable_select), [Radix Tooltip](https://www.radix-ui.com/primitives/docs/components/tooltip). These document native value/form behavior, progressive support and tooltip focus/hover/collision handling. Menus reuse existing domain anchoring and lifecycle rather than introducing a second workflow state.

## Acceptance in progress

Component ownership, behavioral preservation and implementation details are recorded in the foundation and CAD migration reviews. First production build passes TypeScript/Vite, 92 documentation files and corresponding native sources. Actual open Named view picker is styled in the in-app browser, flips above the bottom dock and preserves the current Isometric value. Final integrated tests, cross-app visual checks and independent review follow; counts and completion are recorded only after they finish.

## Final visual acceptance

The final actual bundle is main-BD-uKwpT.js, opened at localhost:3778 in a separate tab. Named view renders appearance:base-select and compact density; its actual popup is inspected and captured in tmp/workbench-controls-final-picker.png. The transparent tree remains quiet when merely expanded. CAD File menu, gear configuration/tooth-root picker, project-library search/sort, CAD Settings navigation/radios, CAM workflow menu and focused tooltip were visually inspected. A native disabled Fit button displays shared help on actual pointer hover. No preferences or saved records were changed.

The saved module 3 gear remains clean with two features and storage fingerprint 68478d8934b638195b4e856c4225de0193516a852e72a3bc6cd661780b19f18d at both opening reads. Existing original gear tabs and their state remain untouched. The final updated tab is retained for the user.

Browser suite first pass:116 pass,8 fail,1 unchanged optional folder skip. Actual regressions were tooltip click interception and Escape consumption; others were native-title or old button-role observation contracts. Targeted repairs pass3 then5 journeys. All124 supported journeys have passing evidence across these runs. No timeout, retry, source geometry, guard or numerical assertion was weakened. Final unit gate is recorded below when complete.

## Completed checkpoint

Final complete unit gate:393 files /4,152 tests pass in311.93s (tmp/workbench-controls-full-final.log). Final TypeScript/Vite build,92 documentation files and exact corresponding native sources pass (tmp/workbench-controls-final-build.log). UI ownership, release compatibility and diff checks pass. All128 frozen source/test paths match after verification. The393-file earlier run's seven stale help assertions and the browser failures remain in their original logs; repairs are independently reviewed and verified. No assertions/timeouts/retries were relaxed.

Scope is complete for this shared-control consistency pass. Current in-app browser renders the styled picker; unsupported engines retain the documented native fallback. The earlier broad CAD work remains a separate continuing product effort. Publication uses existing PR12 and release0.0.697, without merging or changing installed-post/file contracts.
