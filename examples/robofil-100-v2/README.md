# Cristian's Robofil 100 V2 test kit

Install these files in Settings, in this order:

1. `cristian-robofil-100-v2.wireedm-post.json` using **Install post package**.
2. `cristian-robofil-100.wireedm-machine.json` using **Install machine**. Its X 150 mm / Y 200 mm travel values are backed by the included prior local-machine record.

Select the imported machine and package, then create a binding with an explicit ID and
name. Enter this exact properties object:

```json
{"coordinatePrecision":3,"offsetIndex":0}
```

Enter your own compatibility acknowledgement. The machine file deliberately contains no
binding and the app will not select one automatically.

For direct contour entry and exit, leave transition geometry absent or use the reviewed
no-entry and no-exit choices. The package emits no geometric lead in that case. Generated
programs are test candidates for controller graphics, simulation, and a supervised dry run.

`no-lead-rectangle.dxf` is a 10 × 10 mm closed-contour browser test fixture. Import it as millimeters, set finished-contour geometry and controller compensation, and leave entry and exit geometry absent to exercise the direct no-lead flow.
