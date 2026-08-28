# Robofil V1 inactive reference

Robofil V1 is retained only as historical reference. The application does not install,
list, dispatch, execute, or fall back to it.

The former application-owned V1 policy was limited to one compensated operation. Its
recorded sequence was:

```text
G92 X0.000 Y0.000
G60
G38
G41 D0
G90
M02
```

Compensation remained active for the whole program, positioning used a compensated
linear approach, and multi-operation output was rejected. This behavior is unsupported
and has no compatibility promise. Any future revival must be authored and installed as
a new standalone post package.
