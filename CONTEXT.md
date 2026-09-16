# Wire EDM Workbench Context

Wire EDM Workbench preserves manufacturing intent independently from the controller program used to run it. This vocabulary names the artifacts and boundaries shared by planning, machine configuration, posting, and export.

## Design and planning

**UPID document**:
A portable, controller-neutral description of geometry and reviewed manufacturing intent.
_Avoid_: G-code project, machine program

**Wire EDM job**:
An editable workbench project that combines a UPID document with job-level planning and the selected machine/setup provenance.
_Avoid_: design file, program

**Saved job revision**:
An immutable persisted revision of a Wire EDM job from which controller artifacts can be reproduced.
_Avoid_: current state, editor draft

**Execution plan**:
An immutable, ordered, controller-neutral sequence of machining events compiled from a saved job revision.
_Avoid_: intermediate G-code, post input text

**Program stop**:
An explicit operator pause attached to a position in the execution sequence or at a remaining cut distance.
_Avoid_: threading transition

**Threading transition**:
The reviewed manner in which the wire separates and is rethreaded between two operations. The exact controller pause used for manual rethreading belongs to the post processor.
_Avoid_: arbitrary program stop

## Machines and posts

**Machine definition**:
A reusable description of one physical Wire EDM machine, including its identity, working limits, and hardware capabilities but no controller commands.
_Avoid_: machine profile, post configuration

**Machine package**:
The only artifact a person installs. It contains one complete machine definition, one or more versioned post processors, their exact machine setups, controller-file rules, evidence, and conformance fixtures.
_Avoid_: setup bundle, loose machine and post files

**Post processor**:
A versioned executable definition inside a machine package that translates an execution plan into one controller program and owns the exact controller-file rules.
_Avoid_: template, machine settings, independently installed post

**Post installation**:
One exact post processor version stored internally by the workbench and identified by its content hash.
_Avoid_: active post, uploaded script

**Machine setup**:
The internal exact association between a machine definition, a post installation, and all stable machine-specific post values. The installer creates it from a complete machine package; a person never assembles it field by field.
_Avoid_: machine post binding, default exporter

**Dialect descriptor**:
The post-scoped vocabulary that assigns semantic effects and evidence to controller commands without claiming those meanings apply to other controllers.
_Avoid_: universal G-code table, G-code standard

**Post verification**:
A local acknowledgement tied to the exact post content, setup properties, and machine definition that records the level of evidence supporting their use together.
_Avoid_: certified post, safe post

## Output

**Controller program artifact**:
Generated controller text, file rules, structured trace, diagnostics, and provenance produced from one saved job revision and one exact machine setup.
_Avoid_: saved job, source file

**Controller-file rules**:
The post-owned requirements for the downloadable file, including extension, line ending, encoding, final newline, numbering, and wrapper markers.
_Avoid_: workbench output preference, editor formatting
