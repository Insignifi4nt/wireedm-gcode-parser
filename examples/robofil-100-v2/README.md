# Cristian's Robofil 100 V2 candidate machine package

The human-installable artifact is `cristian-robofil-100-v2.wireedm-package`. In Workbench Settings, open **Machines & setups**, choose **Install machine package**, review the detected machine and post, then confirm the installation. Do not install the loose machine or post JSON files separately; they are reproducible authoring inputs.

The package includes:

- the complete physical definition for Cristian's Charmilles Robofil 100, including evidenced 150 mm X and 200 mm Y travel;
- the exact `cristian.robofil-100.v2-candidate@2.3.0` post;
- the `Robofil V2 candidate 2.3.0` setup with `coordinatePrecision: 3` and `offsetIndex: 0`;
- all machine and controller evidence plus the post's exact fixtures;
- post-owned `.iso`, CRLF, ASCII, final-newline, leading `%`, and sequential `N10` block-numbering rules.

Package version 2.3.0 adds the operator-reported cut-on-rapid/manual-rethread route. The workbench checks the straight route against finished-part solid regions, including holes and islands, before allowing a continuous transition. Finished DXF contours do not describe the stock outside the part or fixtures. Existing installations and saved revisions are not rewritten. The new sequence remains a candidate for controller graphics and a supervised dry run; M00 and physical wire separation have not been verified by a known-good program.

The post emits `G92` for program setup. Compensation starts with `G41` or `G42`, followed by `G38 D0`, and finishes with `G40`, `G39`, then final `M02`. Same-side contours may share one compensation lifecycle through a continuous `G0` only if the route does not cross known finished material. For the new manual rethread route, the post emits the separating `G0`, `G40`, `G39`, `M00` at the destination, then starts the next contour with its own compensation side. Manual threading inserts this M00 automatically; adding a user-authored stop at the same point would insert another M00. Manual separation before positioning and automatic threading remain unsupported.

For direct contour entry and exit, leave transition geometry absent or use the reviewed no-entry and no-exit choices. The package emits no geometric lead in that case. Generated programs remain candidates for controller graphics, simulation, and a supervised dry run; the setup is deliberately `unverified`.

To reproduce the package:

```text
npm run post:conformance -- examples/robofil-100-v2/cristian-robofil-100-v2.wireedm-post.json
npm run machine-package:validate-source -- examples/robofil-100-v2
npm run machine-package:build -- examples/robofil-100-v2 examples/robofil-100-v2/cristian-robofil-100-v2.wireedm-package
npm run machine-package:validate -- examples/robofil-100-v2/cristian-robofil-100-v2.wireedm-package
npm run machine-package:inspect -- examples/robofil-100-v2/cristian-robofil-100-v2.wireedm-package
```

`no-lead-rectangle.dxf` is a 10 × 10 mm closed-contour browser fixture. Import it as millimeters, set finished-contour geometry and controller compensation, and leave entry and exit geometry absent to exercise the direct no-lead flow.
