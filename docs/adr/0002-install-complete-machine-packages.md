---
status: accepted
---

# Install complete machine packages

Wire EDM Workbench accepts one complete machine package as the only user-facing installation artifact. A package contains a machine definition, one or more versioned post processors, complete machine setups, controller-file rules, evidence, and fixtures. The installer validates and reconciles the whole package atomically. Internally, machine definitions and post installations remain separate so one machine can use several post versions without duplication.

This replaces separate machine and post uploads, manual binding forms, and workbench-level output serialization preferences. When a package matches an installed machine, the installer shows the detected machine and asks whether to add the package's new post processors to it. Existing saved jobs retain their exact machine and post snapshots.
