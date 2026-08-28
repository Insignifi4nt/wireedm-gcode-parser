# Wire EDM Workbench Context

Wire EDM Workbench preserves manufacturing intent independently from the controller program used to run it. This vocabulary names the artifacts and boundaries shared by planning, machine configuration, posting, and export.

## Design and planning

**UPID document**:
A portable, controller-neutral description of geometry and reviewed manufacturing intent.
_Avoid_: G-code project, machine program

**Wire EDM job**:
An editable workbench project that combines a UPID document with job-level planning and export selections.
_Avoid_: design file, program

**Saved job revision**:
An immutable persisted revision of a Wire EDM job from which controller artifacts can be reproduced.
_Avoid_: current state, editor draft

**Execution plan**:
An immutable, ordered, controller-neutral sequence of machining events compiled from a saved job revision.
_Avoid_: intermediate G-code, post input text

## Machines and posts

**Machine definition**:
A reusable description of one physical Wire EDM machine, including its identity, working limits, and hardware capabilities but no controller commands.
_Avoid_: machine profile, post configuration

**Post package**:
A versioned, installable definition that translates an execution plan into one controller dialect and declares its contract, evidence, properties, and fixtures.
_Avoid_: template, machine settings

**Post installation**:
One exact post package version stored in the workbench post library and identified by its content hash.
_Avoid_: active post, uploaded script

**Machine post binding**:
A named association between a machine definition, an exact post installation, and machine-specific post property values.
_Avoid_: machine post, default exporter

**Dialect descriptor**:
The post-scoped vocabulary that assigns semantic effects and evidence to controller commands without claiming those meanings apply to other controllers.
_Avoid_: universal G-code table, G-code standard

**Post verification**:
A local acknowledgement tied to the exact post content, binding properties, and machine definition that records the level of evidence supporting their use together.
_Avoid_: certified post, safe post

## Output

**Controller program artifact**:
Generated controller text, structured trace, diagnostics, and provenance produced from one saved job revision and one exact post binding.
_Avoid_: saved job, source file

**Output preference**:
A file-writing choice such as extension or line ending that changes artifact serialization but not machining semantics.
_Avoid_: machine capability, controller dialect
