Charmilles Robofil 100 v2 multi-contour test pack

Generated from: Prisma fixa 1 cog.dxf
Source SHA-256: c8b1a79dea0e239344db0194e00c68df206776505cc0d18480112c552bf89cb0
Artifact directory: artifacts/robofil-v2/prisma-fixa-1-cog

PLACEMENT (asserted by the generator)
- Part geometry X: -32.500 to +32.500 mm (centred on X0)
- Part geometry Y: 0.000 to 64.500 mm (bottom on Y0)
- Hole centres: X-17.500 Y39.600 and X+17.500 Y39.600
- Every candidate starts its first operation from one of those hole centres.
- The exterior uses an outside lead from X37.500 Y64.500 to its contour start.

CANDIDATE MACHINE PROGRAMS
- prisma-fixa-1-cog.robofil-v2-recommended.iso
- prisma-fixa-1-cog.robofil-v2-opposite-hole-first.iso
- prisma-fixa-1-cog.robofil-v2-exterior-reversed.iso

The recommended file uses the planner's default inside-out-nearest route. The opposite-hole-first
file exercises editable ordering. The exterior-reversed file exercises compensation re-resolution
after direction reversal. All three have been structurally audited so G0 occurs only after G39/G40
and before a fresh G41/G42 D0 activation for the next contour.
Automatic ordering does not yet optimize native-circle circumference starts; exact start/rapid
editing remains available in the editor without overwriting manual circle-start choices.

DO NOT START WITH A CUT.
1. Import/inspect charmilles-robofil-100-v2-candidate.wireedm-machine.json.
2. Compare the ISO geometry and coordinates against manifest.json.
3. Run controller graphics/SIM mode first (the research notes report SIM,1 for simulation).
4. Confirm G39 really cancels the Robofil compensation mode and G40 clears side selection.
5. Confirm D0 is the intended offset-table selection for this job.
6. Run a supervised air/dry test with generator disabled, then a low-risk material test.
7. Only after those checks should this v2 candidate be treated as machine-verified.

REFERENCE FILES
- prisma-fixa-1-cog.generic-wire-centre-reference.iso is geometry comparison only; do not use it
  as a Robofil compensated program.
- robofil-v1-multicontour-blocked.json documents why the older app envelope refused this job.
  It does NOT claim that the physical controller forbids multiple contours.

Regenerate from the repository root with:
npm run artifacts:prisma
