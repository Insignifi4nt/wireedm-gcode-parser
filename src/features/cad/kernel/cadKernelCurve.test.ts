// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import initOpenCascade from 'replicad-opencascadejs';
import { setOC } from 'replicad';
import type { CadCurveFeature, CadFeature, CadPlane } from '../../../domain/cad/cadDocument';
import { createCadDocument, parseCadDocument, cadVisibleBodyIds } from '../../../domain/cad/cadSchema';
import { importCadDxfCurve, exportCadCurveDxf } from '../../../domain/cad/cadCurveDxf';
import { cadPlaneBasis } from '../../../domain/cad/cadPlanes';
import { cadKernelPlaneBasis } from './cadKernelPlane';
import { buildCadKernelModel } from './cadKernelModel';

beforeAll(async()=>{setOC(await initOpenCascade({wasmBinary:await readFile(new URL('../../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm',import.meta.url)),print:()=>undefined,printErr:()=>undefined}));},60_000);
const base=(id:string)=>({id,name:id,suppressed:false});
const curve=(plane:CadPlane='XY'):CadCurveFeature=>({...base('reference_rail'),kind:'curve',plane,offset:'offset',segments:[
  {kind:'line',start:[0,0],end:[10,0]},{kind:'arc',center:[10,5],radius:5,startAngle:270,sweep:90}
]});
const sketch:CadFeature={...base('sketch'),kind:'sketch',plane:'XY',offset:0,profiles:[{id:'profile',name:'Profile',construction:false,geometry:{kind:'rectangle',x:0,y:0,width:20,height:10,cornerRadius:0}}]};
const pad:CadFeature={...base('pad'),kind:'extrude',sketchId:'sketch',distance:5,symmetric:false,operation:'new',targetId:null};
const pattern:CadFeature={...base('pattern'),kind:'linear-pattern',sourceId:'pad',count:2,spacing:[30,0,0]};
const document=(features:readonly CadFeature[])=>parseCadDocument({...createCadDocument('Curve alongside solids','curve_solid_test'),parameters:{offset:7},features});

describe('native solids alongside exact Curve reference features',()=>{
  it.each(['XY','XZ','YZ'] satisfies CadPlane[])('keeps body geometry unchanged while skipping active/suppressed %s references',plane=>{
    const original=buildCadKernelModel(document([sketch,pad,pattern])); const withReference=document([curve(plane),sketch,pad,{...curve(plane),id:'suppressed_reference',suppressed:true},pattern]);
    const result=buildCadKernelModel(withReference);
    try {
      expect(result.result.diagnostics).toEqual([]); expect(result.result.meshes.map(mesh=>mesh.featureId)).toEqual(['pattern']);
      const before=original.result.meshes[0];const after=result.result.meshes[0];
      expect(after.volume).toBeCloseTo(2000,8); expect(after.volume).toBe(before.volume);expect(after.bounds).toEqual(before.bounds);
      expect(after.positions).toEqual(before.positions); expect(after.indices).toEqual(before.indices); expect(after.edges).toEqual(before.edges);
      expect(result.section({bodyId:'pattern',plane:'XY',offset:2}).contourCount).toBe(2);
      expect(()=>result.section({bodyId:'reference_rail',plane:'XY',offset:0})).toThrow(/unavailable/);
      expect(cadVisibleBodyIds(withReference.features, withReference)).toEqual(['pattern']); expect(cadKernelPlaneBasis(plane)).toEqual(cadPlaneBasis(plane));
    } finally {original.dispose();result.dispose();}
  });
  it('exports existing solids without including imported reference paths as STEP/STL bodies',async()=>{
    const source=exportCadCurveDxf(curve(),{offset:7});const imported=importCadDxfCurve({fileName:'rail.dxf',text:source,curveId:'imported_reference'});
    const model=buildCadKernelModel(document([sketch,pad,imported.curve,pattern]));
    try {
      expect(model.result.diagnostics).toEqual([]); expect(model.result.meshes).toHaveLength(1);
      const step=await model.export('step').text();expect(step).toContain('pattern');expect(step).not.toContain('reference_rail');expect(step).not.toContain('imported_reference');
      expect((await model.export('stl').arrayBuffer()).byteLength).toBeGreaterThan(84);
      expect(()=>parseCadDocument(document([sketch,pad,imported.curve,{...base('bad_pattern'),kind:'linear-pattern',sourceId:'imported_reference',count:2,spacing:[0,0,20]}]))).toThrow(/body|solid/i);
    } finally {model.dispose();}
  });
});
