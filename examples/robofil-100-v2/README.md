# Cristian's Robofil 100 V2 candidate machine package

The human-installable artifact is `cristian-robofil-100-v2.wireedm-package`. In Workbench Settings, open **Machines & setups**, choose **Install machine package**, review the detected machine and post, then confirm the installation. Do not install the loose machine or post JSON files separately; they are reproducible authoring inputs.

The package includes:

- the complete physical definition for Cristian's Charmilles Robofil 100, including evidenced 150 mm X and 200 mm Y travel;
- the exact `cristian.robofil-100.v2-candidate@2.2.0` post;
- the `Robofil V2 candidate 2.2.0` setup with `coordinatePrecision: 3` and `offsetIndex: 0`;
- all machine and controller evidence plus the post's exact fixtures;
- post-owned `.iso`, CRLF, ASCII, final-newline, leading `%`, and sequential `N10` block-numbering rules.

Package version 2.2.0 adds explicit command-owned arc directions and a separately identified setup; it retains the controller text and evidence of 2.1.0. Existing packages and saved revisions are not rewritten. Clockwise arcs and M00 remain unverified physical-machine paths, as recorded in the candidate-policy evidence.

The post emits only `G92` for program setup. Compensation starts with `G41` or `G42`, followed by `G38 D0`, and finishes with `G40`, `G39`, then final `M02`. Disconnected contours may share one compensation lifecycle only when the operator marks the transition continuous and every contour resolves to the same side. The post then uses `G0` between contours and cancels compensation only after the final contour. Mixed sides and cut/rethread transitions remain blocked until an exact Robofil 100 sequence is verified.

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
