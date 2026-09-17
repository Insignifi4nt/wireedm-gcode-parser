# Robofil 100 post semantics research

Date: 2026-09-03

## Question

What should the Robofil 100 post emit around a compensated program, and should it
cancel and restart compensation between disconnected contours when the wire side
does not change?

## Conclusion

The best Robofil 100-specific evidence supports one program-scoped compensation
lifecycle when consecutive contours use the same side and the wire remains
threaded. Applied to the operator's proposed syntax, the candidate layout is:

```text
%
N10 G92 ...
N20 G41            or G42
N30 G38 D0
... first contour ...
G0 ...              move to the next contour without machining
... next contour ...
N... G40
N... G39
N... M02
```

Do not insert `G40`, `G39`, another `G41` or `G42`, and another `G38 D0`
between such contours. A historical local program applies one `G42 D0` state to
ten closed contours separated by `G0` blocks. It has no compensation reset or
reactivation between them. This is stronger evidence for this machine than
generic cutter-compensation practice or manuals for later Robofil controls.

The exact new prologue and epilogue order above is the operator's current
Robofil 100 hypothesis; it is not yet recorded as a successful machine run. The
surviving historical programs and manuals disagree
on whether `D0` belongs with `G38` or `G41`/`G42`, and on the ordering of `G39`
and `G40`. That variation is real across the evidence. The post should therefore
treat the current operator report as machine-specific evidence, not derive the
order from another Charmilles generation.

If the side changes, or if the wire is cut and rethreaded between contours, the
available Robofil 100 evidence does not establish a safe lifecycle. The post
should fail closed for those cases until the operator supplies a known-good
program or verifies a candidate in graphics simulation and a supervised dry run.

## Exact local evidence

### Same-side multi-contour program

Archive commit `7a4681853aab3fc1184fea0e9bbfd1c0eaf924cb` contains
`old_reference/current_app/testing_gcode_files/2K-Filera-Face-12-002.gcode`.
It can be inspected without restoring the old app:

```powershell
git show 7a46818:old_reference/current_app/testing_gcode_files/2K-Filera-Face-12-002.gcode
```

Its structure is:

```text
%
G92
G60
G38
G42 D0
G90
G0 X-0.003 Y22.341
... closed contour 1 ...
G0 X-28.973 Y22.399
... closed contour 2 ...
... eight more G0-separated closed contours ...
M02 ; program end
```

There are ten `G0` starts. Each following `G1` chain closes at the coordinate
from its `G0` block. The inter-contour repositioning is therefore encoded as
automatic `G0` motion in the program; there is no stop, pause, or operator
repositioning command between contours. The file contains one `G38`, one
`G42 D0`, no `G39`, and no `G40`. It is direct evidence that the local workflow
carried the same G42 state over rapid positioning between disconnected contours.

The earlier machine-profile record says its evidence set consisted of 19
historical ISO programs from the user's Robofil workflow. It also records that a
corrected z39 program cut successfully on the physical Robofil 100 on 2026-07-13.
That record explicitly limited the old verification claim to a single contour;
the ten-contour file is strong syntax precedent, but the repository does not say
that this particular file was physically run. See the [controller-compensation
design record](specs/2026-07-13-controller-compensation-machine-profiles-design.md),
especially "Goal" and "Robofil 100 / Classic verified preset."

### Other local program variants

The same archive commit contains `ArcTestFile1.txt` and `ArcTestFile2.txt`. They begin
with `%`, `G92`, `G60`, `G38`, and `G41D0`. Near the end they use `G40` before
`M02`, but not `G39`. The current candidate package instead emits `G39`, then
`G40`, at operation boundaries and program end. See the [candidate policy
record](../../tests/fixtures/machine-packages/robofil-100-v2/evidence/candidate-policy-record.txt) and
the [three-contour candidate output](../../tests/fixtures/machine-packages/robofil-100-v2/evidence/prisma-recommended.iso).

These variants show why the existing V2 lifecycle is not evidence of controller
requirements. Its own record calls it an editable candidate and says it is not a
machine-readiness claim.

## Manual-backed meanings

These manuals cover adjacent Robofil generations, not the exact Robofil 100
controller and firmware. They are useful for command meaning, but not for
overriding the current operator's exact block order.

### `%` and `N`

The original Charmilles Robofil 190/290P/310P/510P NC manual says `N` block
numbers are optional, must be first on their line when present, and may contain
one to eight digits. It also says `%` must be the sole word in the first block,
`G92` must precede geometry, and `M02` terminates the program. See sections
7.1.13 and 7.1.14 (mirror PDF pages 84 to 85) in the [Robofil NC manual](https://pdfcoffee.com/robofil-190-290p-310p-510p-part-2-3-pdf-free.html).

The local historical programs consistently start with `%`, while line numbering
is inconsistent. `2K-Filera-Face-12-002.gcode` has no `N` numbers and
`ArcTestFile2.txt` numbers some blocks but not others. Therefore:

- emit the leading `%` because both manual and local-file evidence support it;
- emit normalized line numbers because the operator requests them and the editor
  already owns this formatting behavior;
- do not describe line numbers as necessary for compensation or execution.

### `G92`

Charmilles manual 5 949 030/E/26.01.1998 defines `G92 Xx Yy` as the wire position
relative to the program origin. It permits `G92` at the beginning or during a
program and defaults the initial wire position to the program origin. See
"G92 Origin data," page 7.2.38 in the [Robofil 190/290P/310P/510P NC manual,
part 2](https://pdfcoffee.com/robofil-190-290p-310p-510p-part-2-3-pdf-free.html).

The later CT-Millennium manual likewise defines `G92` as the Part coordinate
system origin relative to the machining start point. See "G92 Definition of the
Part system of coordinates," page 2.36 in the [Charmilles ROBOFIL programming
manual 205 976 310/en](https://www.scribd.com/document/459168666/FIX40-cc-SL-program-vH-en-pdf).

### `G41`, `G42`, and `D0`

The CT-Millennium manual defines `G41` as moving the wire center left and `G42`
as moving it right. It says `G40`, `G41`, and `G42` are modal until another of
the three is issued or the NC is reset. See "Offset programming," page 2.15 in
the [CT-Millennium manual](https://www.scribd.com/document/459168666/FIX40-cc-SL-program-vH-en-pdf).

Charmilles manual 5 949 080/E/26.01.1998 says `D` selects the register containing
the offset value and associates `D` with `G41`, `G42`, and `G43`. See "D,
Associated code," page 7.3.5 in the [Robofil NC manual](https://pdfcoffee.com/robofil-190-290p-310p-510p-part-2-3-pdf-free.html).
The local machine record selects register zero. `D0` is therefore an offset-table
index, not an offset distance written into the program.

The operator now proposes that this Robofil 100 expects `G41` or `G42`, followed
by `G38 D0`. That placement differs from both the old local files and the adjacent
manuals. It should be encoded only as candidate exact-machine syntax and verified
as such.

### `G38` and `G39`

The original Charmilles Robofil NC manual describes `G38` as creating a
perpendicular entry when no previous segment supplies the compensated
intersection. It requires one of `G40`, `G41 Dd`, `G42 Dd`, or `G43 Dd` in the
same or next block. It describes `G39` as the corresponding exit and documents
the program-end form as `G39G40A0`. Its examples use `G38G43Dd` at entry and
`G39G40A0` at exit. See sections 7.2.21 to 7.2.25 (mirror PDF pages 108 to
112) in the [Robofil NC manual](https://pdfcoffee.com/robofil-190-290p-310p-510p-part-2-3-pdf-free.html).

A field report containing a program generated automatically by a Charmilles
machine shows a different family variant: `G38D0` followed by `G42`, then `G40`
near the end and `M02`. See the machine-generated listing on PDF page 22 of the
[BH Automation training report](https://www.bh-automation.fr/Download/Automaticiens/rapport-stage-assistance-devissage-NDH.pdf).
A reported working user program uses separate `G42 D0`, `G60`, and `G38` blocks
at the start, then `G40G39A0` at the end. See the [2004 Charmilles program
example](https://www.emastercam.com/forums/topic/13445-programming-taper-in-charmilles-wire/).
The field sources are machine evidence rather than manufacturer specifications.
Together these sources confirm that adjacent Charmilles examples disagree on
`D0` placement and block order.

### `G0`

The Robofil 290 guide defines `G00` as rapid movement without machining. It says
the command temporarily disables machining and its auxiliary functions, then
restores them when the rapid finishes. See "G00, rapid movement without
machining," page 18 in the [Robofil 290 guide](https://www.scribd.com/document/944739143/manual-charmilles-robofil-290).

This behavior fits the local ten-contour file: `G42` remains modal while each
`G0` supplies non-machining travel to the next contour. The exact Robofil 100
program is the reason to allow this pattern, not the adjacent manual alone.

### `G40` and `M02`

The Robofil 290 guide defines `G40` as cancellation of wire offset. When no
following segment exists for the normal intersection calculation, it calls for
the special end transition with `G39`. See pages 20 to 21 of the [guide](https://www.scribd.com/document/944739143/manual-charmilles-robofil-290).

Charmilles manual 5 949 080/E/26.01.1998 says `M02` ends all operations in
progress and prevents machining from resuming. It may appear alone or in the
last block and executes after other commands in that block. See "M02 End of
program," page 7.3.15 in the [Robofil NC manual](https://pdfcoffee.com/robofil-190-290p-310p-510p-part-2-3-pdf-free.html).

The operator's proposed `G40`, `G39`, `M02` ending should be emitted once after
the last contour in the candidate. Because the original close-family Charmilles
manual documents `G39G40A0`, the Robofil 100 ordering still needs graphics
simulation and a supervised dry run before the package makes a machine-readiness
claim.

## Recommended post policy

1. Add `%` and normalized `N` numbers as final controller-file formatting. Keep
   unnumbered internal program lines so editor cleanup remains a separate task.
2. Emit only the requested Robofil 100 setup: `G92`, resolved `G41` or `G42`, then
   `G38 D0`. Remove the current V2-only `G60`, standalone `G38`, `G90`, and initial
   `G39`/`G40` sequence.
3. Keep compensation active across `G0` travel between consecutive contours only
   when the resolved side is unchanged and no wire separation or rethread occurs.
4. Emit `G40`, `G39`, and `M02` once after the final contour.
5. If the next contour changes from G41 to G42 or vice versa, fail closed until a
   side-change sequence is verified on this Robofil 100.
6. If a transition cuts or rethreads the wire, fail closed until its compensation
   lifecycle is verified.
7. Keep the package marked as a candidate until the new order passes the
   controller's graphics simulation and a supervised dry run with the correct D0
   table value.
