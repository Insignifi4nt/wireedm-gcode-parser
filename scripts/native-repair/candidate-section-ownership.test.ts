// @vitest-environment node
import { readFile, writeFile } from 'node:fs/promises';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import initialize from 'replicad-opencascadejs';
import type { TopoDS_Shape } from 'replicad-opencascadejs';
import { getOC, makeBox, measureVolume, setOC } from 'replicad';
import { sectionCadKernelShape } from '../../src/features/cad/kernel/cadKernelSection';
import { cadKernelDisposeShape } from '../../src/features/cad/kernel/cadKernelShapes';
import { buildCadKernelModel } from '../../src/features/cad/kernel/cadKernelModel';
import { createCadDocument } from '../../src/domain/cad/cadSchema';
import { exportCadKernelStep } from '../../src/features/cad/kernel/cadKernelExport';
import { prepareCadSolidImport } from '../../src/features/cad/kernel/cadKernelImport';

const evidence: { case: string; counts: Readonly<Record<string, number>>; sourceVolume: number }[] = [];
afterAll(async () => {
  await writeFile(new URL('../../tmp/cad-native-repair/lifecycle-ownership.json', import.meta.url), `${JSON.stringify(evidence, null, 2)}\n`);
});

beforeAll(async () => {
  const wasmBinary = await readFile(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));
  setOC(await initialize({ wasmBinary, print() {}, printErr() {} }));
}, 60_000);

it('releases section raw builder/explorer copies while preserving source material and exact contours', () => {
  const oc = getOC(), source = makeBox([0, 0, 0], [10, 20, 5]), rawShapes: TopoDS_Shape[] = [], deleted = new Set<object>();
  const originalDelete = oc.TopoDS_Shape.prototype.delete, current = oc.TopExp_Explorer.prototype.Current, output = oc.BRepAlgoAPI_Section.prototype.Shape;
  const released = vi.spyOn(oc.TopoDS_Shape.prototype, 'delete').mockImplementation(function(this: TopoDS_Shape) { deleted.add(this); originalDelete.call(this); });
  const traversed = vi.spyOn(oc.TopExp_Explorer.prototype, 'Current').mockImplementation(function(this: InstanceType<typeof oc.TopExp_Explorer>) { const raw = current.call(this); rawShapes.push(raw); return raw; });
  const built = vi.spyOn(oc.BRepAlgoAPI_Section.prototype, 'Shape').mockImplementation(function(this: InstanceType<typeof oc.BRepAlgoAPI_Section>) { const raw = output.call(this); rawShapes.push(raw); return raw; });
  try {
    const section = sectionCadKernelShape(source, { bodyId: 'source', plane: 'XY', offset: 2 });
    expect(section.contourCount).toBe(1); expect(section.entities).toHaveLength(4); expect(section.entities.every(entity => entity.type === 'line')).toBe(true);
    expect(measureVolume(source)).toBeCloseTo(1000, 8); expect(source.isNull).toBe(false);
    expect(rawShapes.length).toBeGreaterThan(4); expect(rawShapes.every(raw => deleted.has(raw))).toBe(true);
    evidence.push({ case: 'section-copied-handles', counts: { rawCopies: rawShapes.length, rawDeleted: rawShapes.filter(raw => deleted.has(raw)).length }, sourceVolume: measureVolume(source) });
  } finally {
    traversed.mockRestore(); built.mockRestore(); released.mockRestore();
    for (const raw of rawShapes) if (!deleted.has(raw)) { raw.Nullify(); raw.delete(); }
    cadKernelDisposeShape(source);
  }
});

it('releases the section plane when native builder construction fails without changing the borrowed body', () => {
  const oc = getOC(), source = makeBox([0, 0, 0], [10, 20, 5]);
  const failure = new Error('native section constructor failed'), Section = oc.BRepAlgoAPI_Section;
  const release = oc.gp_Pln.prototype.delete;
  let releasedPlanes = 0;
  const plane = vi.spyOn(oc.gp_Pln.prototype, 'delete').mockImplementation(function(this: InstanceType<typeof oc.gp_Pln>) {
    release.call(this); releasedPlanes++;
  });
  oc.BRepAlgoAPI_Section = new Proxy(Section, { construct() { throw failure; } });
  try {
    expect(() => sectionCadKernelShape(source, { bodyId: 'source', plane: 'XY', offset: 2 })).toThrow(failure);
    expect(releasedPlanes).toBe(1);
    expect(measureVolume(source)).toBeCloseTo(1000, 8); expect(source.isNull).toBe(false);
  } finally { oc.BRepAlgoAPI_Section = Section; plane.mockRestore(); cadKernelDisposeShape(source); }
});

it('releases the exact curve owner when section adaptor construction fails', () => {
  const oc = getOC(), source = makeBox([0, 0, 0], [10, 20, 5]), created: InstanceType<typeof oc.BRepAdaptor_Curve>[] = [];
  const failure = new Error('native section adaptor constructor failed'), Adaptor = oc.BRepAdaptor_Curve, deleted = new Set<object>();
  const release = Adaptor.prototype.delete;
  const released = vi.spyOn(Adaptor.prototype, 'delete').mockImplementation(function(this: InstanceType<typeof Adaptor>) {
    release.call(this); deleted.add(this);
  });
  let calls = 0;
  oc.BRepAdaptor_Curve = new Proxy(Adaptor, { construct(target, args) {
    if (++calls === 2) throw failure;
    const value: InstanceType<typeof Adaptor> = Reflect.construct(target, args); created.push(value); return value;
  } });
  try {
    expect(() => sectionCadKernelShape(source, { bodyId: 'source', plane: 'XY', offset: 2 })).toThrow(failure);
    expect(created).toHaveLength(1); expect(created.every(value => deleted.has(value))).toBe(true);
    expect(measureVolume(source)).toBeCloseTo(1000, 8); expect(source.isNull).toBe(false);
  } finally {
    oc.BRepAdaptor_Curve = Adaptor; released.mockRestore();
    for (const value of created) if (!deleted.has(value)) value.delete();
    cadKernelDisposeShape(source);
  }
});

it('preserves the native STEP failure and releases remaining owners even if one cleanup throws', () => {
  const oc = getOC(), source = makeBox([0, 0, 0], [10, 20, 5]);
  const failure = new Error('native STEP transfer failed'), released = { writers: 0, sessions: 0, documents: 0 };
  const writerDelete = oc.STEPCAFControl_Writer.prototype.delete, sessionDelete = oc.XSControl_WorkSession.prototype.delete, documentDelete = oc.TDocStd_Document.prototype.delete;
  const perform = vi.spyOn(oc.STEPCAFControl_Writer.prototype, 'Perform').mockImplementation(() => { throw failure; });
  const writer = vi.spyOn(oc.STEPCAFControl_Writer.prototype, 'delete').mockImplementation(function(this: InstanceType<typeof oc.STEPCAFControl_Writer>) {
    writerDelete.call(this); released.writers++; throw new Error('secondary cleanup failure');
  });
  const session = vi.spyOn(oc.XSControl_WorkSession.prototype, 'delete').mockImplementation(function(this: InstanceType<typeof oc.XSControl_WorkSession>) { sessionDelete.call(this); released.sessions++; });
  const document = vi.spyOn(oc.TDocStd_Document.prototype, 'delete').mockImplementation(function(this: InstanceType<typeof oc.TDocStd_Document>) { documentDelete.call(this); released.documents++; });
  try {
    expect(() => exportCadKernelStep([{ shape: source, name: 'Preserved block' }])).toThrow(failure);
    expect(released).toEqual({ writers: 2, sessions: 1, documents: 1 });
    expect(measureVolume(source)).toBeCloseTo(1000, 8); expect(source.isNull).toBe(false);
  } finally { perform.mockRestore(); writer.mockRestore(); session.mockRestore(); document.mockRestore(); cadKernelDisposeShape(source); }
});

it('releases named STEP writer, work-session and document resources when export returns', async () => {
  const oc = getOC(), created: object[] = [], deleted = new Set<object>();
  const model = buildCadKernelModel({ ...createCadDocument('Named block', 'export_scope'), features: [
    { id: 'sketch', name: 'Outline', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [{ id: 'square', name: 'Square', construction: false, geometry: { kind: 'rectangle', x: 0, y: 0, width: 10, height: 10, cornerRadius: 0 } }] },
    { id: 'pad', name: 'Named block', kind: 'extrude', suppressed: false, sketchId: 'sketch', distance: 5, symmetric: false, operation: 'new', targetId: null }
  ] });
  const Writer = oc.STEPCAFControl_Writer, Session = oc.XSControl_WorkSession, Document = oc.TDocStd_Document;
  const ExtendedString = oc.TCollection_ExtendedString, Color = oc.Quantity_ColorRGBA, Progress = oc.Message_ProgressRange;
  const Types = [Writer, Session, Document, ExtendedString, Color, Progress];
  const counts = { writer: 0, session: 0, document: 0, string: 0, color: 0, progress: 0 };
  const spies = Types.map(Type => {
    const release = Type.prototype.delete;
    return vi.spyOn(Type.prototype, 'delete').mockImplementation(function(this: object) { deleted.add(this); release.call(this); });
  });
  const track = <T extends typeof Types[number]>(Type: T, kind: keyof typeof counts): T => new Proxy(Type, {
    construct(target, args) { const value: object = Reflect.construct(target, args); created.push(value); counts[kind]++; return value; }
  });
  oc.STEPCAFControl_Writer = track(Writer, 'writer'); oc.XSControl_WorkSession = track(Session, 'session'); oc.TDocStd_Document = track(Document, 'document');
  oc.TCollection_ExtendedString = track(ExtendedString, 'string'); oc.Quantity_ColorRGBA = track(Color, 'color'); oc.Message_ProgressRange = track(Progress, 'progress');
  try {
    const blob = model.export('step'), step = await blob.text();
    expect(step).toContain('Named block'); expect(step).toContain('SI_UNIT(.MILLI.,.METRE.)');
    expect(step).toContain("DRAUGHTING_PRE_DEFINED_COLOUR('red')");
    expect(step).toContain('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF');
    expect(counts).toEqual({ writer: 2, session: 1, document: 1, string: 2, color: 1, progress: 1 });
    expect(created).toHaveLength(8); expect(created.every(value => deleted.has(value))).toBe(true);
    evidence.push({ case: 'named-step-scope', counts: { ...counts, constructedTotal: created.length, deletedTotal: created.filter(value => deleted.has(value)).length }, sourceVolume: model.result.meshes[0].volume });
    const imported = prepareCadSolidImport({ format: 'step', encoding: 'utf8', fileName: 'named-block.step', data: step });
    expect(imported.solidCount).toBe(1); expect(imported.volume).toBeCloseTo(500, 8);
    imported.bounds.max.forEach((value, axis) => expect(value).toBeCloseTo([10, 10, 5][axis], 6));
    expect(model.section({ bodyId: 'pad', plane: 'XY', offset: 2 }).contourCount).toBe(1);
  } finally {
    oc.STEPCAFControl_Writer = Writer; oc.XSControl_WorkSession = Session; oc.TDocStd_Document = Document;
    oc.TCollection_ExtendedString = ExtendedString; oc.Quantity_ColorRGBA = Color; oc.Message_ProgressRange = Progress;
    spies.forEach(spy => spy.mockRestore()); model.dispose();
  }
});
