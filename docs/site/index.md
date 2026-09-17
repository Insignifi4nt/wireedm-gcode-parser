# Build a postprocessor for your machine

Wire EDM Workbench turns a saved UPID project into a controller-neutral execution plan. A post translates that plan into an exact controller program. The user installs one **complete `.wireedm-package`** containing the machine, post, setup, evidence and tests.

Start with the [authoring workflow](authoring.md) and open the [Package workbench](tools.md) to check and build files in your browser. Use the [contract reference](reference.md) while implementing. For an existing package, start with [compatibility and repairs](compatibility.md).

## What belongs where

| Surface | Owns |
| --- | --- |
| UPID and application | Geometry, contour order, machining intent, material-side decisions, entry/exit geometry, positioning and explicit stop/thread/separation events |
| Postprocessor | Controller commands, modal state, supported capabilities, command formatting, wrappers, numbering, extension, encoding and line endings |
| Physical machine and setup | Exact machine/controller identity, evidenced limits, hardware, post ID/version/hash and complete property values |

A post must not silently repair geometry, choose a contour order, insert unplanned machining strategies or assume another controller's G-code semantics.

## Give an agent this task

> Read this documentation and its current compatibility record. Help me build a complete Wire EDM machine package for my exact machine. First identify missing machine/controller information and evidence. Implement only supported behavior, validate the entire package, explain remaining limitations, and deliver the `.wireedm-package` with its source folder and test report.

The app works locally in browser cache or an optional workbench folder. Loading this documentation grants no access to those files. The user supplies the package, project and controller evidence needed for the task.
