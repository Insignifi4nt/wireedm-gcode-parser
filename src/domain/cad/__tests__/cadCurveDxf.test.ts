import { describe, expect, it } from 'vitest';
import { parseDxf } from '@/domain/dxf/parseDxf';
import type { CadCurveFeature, CadPathSegment } from '../cadDocument';
import { resolveCadCurve } from '../cadCurve';
import { cadCurveToDxf, exportCadCurveDxf, importCadDxfCurve, isCadDxfCurveImportResult, parseCadDxfCurveImportInput } from '../cadCurveDxf';
import { createCadDocument, parseCadDocument } from '../cadSchema';
import { importCadDxfSketch } from '../cadDxfImport';
import { cadPathClosureTolerance } from '../cadAnalyticSegments';

const curve = (segments: readonly CadPathSegment[], fields: Partial<Pick<CadCurveFeature,'plane'|'offset'|'suppressed'>> = {}): CadCurveFeature => ({
  kind: 'curve', id: 'curve', name: 'Reference', suppressed: false, plane: 'XY', offset: 0, segments, ...fields
});
const line: CadPathSegment = { kind: 'line', start: [3,4], end: [13,4] };
function dxf(body: readonly (string|number)[], units: string|number|null = 4) {
  return [...(units === null ? [] : ['0','SECTION','2','HEADER','9','$INSUNITS','70',units,'0','ENDSEC']),
    '0','SECTION','2','ENTITIES',...body,'0','ENDSEC','0','EOF',''].join('\n');
}
function polyline(vertices: readonly { x:number;y:number;bulge?:number }[], closed = false, classic = false) {
  return classic ? ['0','POLYLINE','8','Reference','66',1,'70',closed ? 1 : 0,...vertices.flatMap(v => ['0','VERTEX','8','Reference','10',v.x,'20',v.y,'42',v.bulge ?? 0]),'0','SEQEND']
    : ['0','LWPOLYLINE','8','Reference','90',vertices.length,'70',closed ? 1 : 0,...vertices.flatMap(v => ['10',v.x,'20',v.y,'42',v.bulge ?? 0])];
}
function roundtrip(original: CadCurveFeature, parameters: Readonly<Record<string,number>> = {}) {
  const before = resolveCadCurve(original, parameters); const text = exportCadCurveDxf(original,parameters);
  const result = importCadDxfCurve({fileName:'reference.dxf',text,curveId:'imported'}); const after = resolveCadCurve(result.curve,{});
  expect(isCadDxfCurveImportResult(result)).toBe(true);
  expect(after.length).toBeCloseTo(before.length,8);
  const tolerance=cadPathClosureTolerance([{x:before.start[0],y:before.start[1]},{x:before.end[0],y:before.end[1]}]);
  expect(Math.hypot(after.start[0]-before.start[0],after.start[1]-before.start[1])).toBeLessThanOrEqual(tolerance);
  expect(Math.hypot(after.end[0]-before.end[0],after.end[1]-before.end[1])).toBeLessThanOrEqual(tolerance);
  expect(after.entities.map(entity=>entity.type)).toEqual(before.entities.map(entity=>entity.type));
  expect(result.curve.source?.text).toBe(text); expect(result.sourceEntityCount).toBe(1);
  return {before,after,text,result};
}

describe('exact ordered open Curve DXF exchange', () => {
  it('exports a standard open polyline in local millimetres without a closing edge', () => {
    const {text,result} = roundtrip(curve([line],{plane:'XZ',offset:17})); const parsed=parseDxf(text); const entity=parsed.entities[0];
    expect(entity.type).toBe('lwpolyline'); if(entity.type!=='lwpolyline') throw new Error('Expected polyline');
    expect(entity.closed).toBe(false); expect(entity.vertices).toEqual([{x:3,y:4,bulge:0},{x:13,y:4,bulge:0}]);
    expect(parsed.unitDeclaration).toMatchObject({status:'recognized',units:{code:4}});
    expect(result.curve).toMatchObject({plane:'XY',offset:0,segments:[line]}); expect(text).not.toContain('1001');
  });
  it('exports datum Curve coordinates locally without resolving or baking the world frame', () => {
    const imported = importCadDxfCurve({ fileName: 'original.dxf', text: dxf(polyline([{ x: 5, y: 0, bulge: Math.tan(-270 * Math.PI / 720) }, { x: 0, y: 5 }])) });
    const placed: CadCurveFeature = { ...imported.curve, plane: { kind: 'datum-plane', featureId: 'datum' }, offset: 'height' };
    const expected = exportCadCurveDxf(imported.curve, {});
    expect(exportCadCurveDxf(placed, { height: 19 })).toBe(expected);
    const document = parseCadDocument({ ...createCadDocument('Datum Curve'), parameters: { height: 19 }, features: [
      { kind: 'datum-plane', id: 'datum', name: 'Tilt', suppressed: false, definition: { kind: 'world', basePlane: 'XZ', origin: [37, -24, 11], rotation: [23, -37, 61] } }, placed,
    ] });
    expect(cadCurveToDxf(document, placed.id)).toBe(expected);
    const accepted = document.features[1]; if (accepted.kind !== 'curve') throw new Error('Expected Curve');
    expect(accepted.source?.text).toBe(imported.curve.source?.text);
    expect(accepted.plane).toEqual(placed.plane); expect(accepted.offset).toBe('height');
  });
  it.each([90,-90,270,-270,2,-2,358,-358])('preserves signed %s-degree traversal, circular support and endpoints', sweep => {
    const {before,after,text}=roundtrip(curve([{kind:'arc',center:[5,-2],radius:3,startAngle:359,sweep}]));
    const original=before.entities[0]; const imported=after.entities[0];
    expect(imported.type).toBe('arc'); if(original.type!=='arc'||imported.type!=='arc') throw new Error('Expected arcs');
    expect(imported.center.x).toBeCloseTo(original.center.x,11); expect(imported.center.y).toBeCloseTo(original.center.y,11);
    expect(imported.radius).toBeCloseTo(original.radius,11); expect(imported.sweepRadians).toBeCloseTo(sweep*Math.PI/180,12);
    expect(imported.clockwise).toBe(sweep<0);
    const poly=parseDxf(text).entities[0]; if(poly.type!=='lwpolyline') throw new Error('Expected polyline');
    expect(Math.sign(poly.vertices[0].bulge)).toBe(Math.sign(sweep)); expect(poly.vertices[1].bulge).toBe(0);
  });
  it('preserves supplied polyline start direction, mixed line/arc order and expressions after evaluation', () => {
    const original=curve([{kind:'line',start:[0,0],end:['run',0]},{kind:'arc',center:['run',5],radius:5,startAngle:270,sweep:90},{kind:'line',start:['run+5',5],end:['run+5',10]}]);
    const {after}=roundtrip(original,{run:10}); expect(after.start).toEqual([0,0]); expect(after.end).toEqual([15,10]);
    expect(after.segments.map(segment=>segment.kind)).toEqual(['line','arc','line']);
    const reversed=importCadDxfCurve({fileName:'backwards.dxf',text:dxf(polyline([{x:20,y:0},{x:10,y:0},{x:0,y:0}]))});
    expect(resolveCadCurve(reversed.curve,{}).start).toEqual([20,0]); expect(resolveCadCurve(reversed.curve,{}).end).toEqual([0,0]);
  });
  it.each([false,true])('imports standard authored CW major bulges, classic=%s',classic=>{
    const result=importCadDxfCurve({fileName:'original.dxf',text:dxf(polyline([{x:5,y:0,bulge:Math.tan(-270*Math.PI/720)},{x:0,y:5}],false,classic))});
    const resolved=resolveCadCurve(result.curve,{}); expect(resolved.start[0]).toBeCloseTo(5,12); expect(resolved.end[1]).toBeCloseTo(5,12);
    const arc=resolved.segments[0]; expect(arc.kind).toBe('arc'); if(arc.kind!=='arc') throw new Error('Expected arc');
    expect(arc.sweep).toBeCloseTo(-270,12); expect(arc.radius).toBeCloseTo(5,12); expect(arc.center[0]).toBeCloseTo(0,12);
  });
  it('assembles every separate exact LINE/ARC in one open connected chain',()=>{
    const text=dxf(['0','ARC','10',10,'20',5,'40',5,'50',270,'51',0,'0','LINE','10',0,'20',0,'11',10,'21',0]);
    const result=importCadDxfCurve({fileName:'entities.dxf',text}); const resolved=resolveCadCurve(result.curve,{});
    expect(resolved.entities).toHaveLength(2); expect(resolved.length).toBeCloseTo(10+2.5*Math.PI,10); expect(result.sourceEntityCount).toBe(2);
  });
  it('converts declared or explicit units and retains the exact BOM/CRLF original',()=>{
    const text='\uFEFF'+dxf(polyline([{x:0,y:0},{x:2,y:0}]),1).replace(/\n/g,'\r\n');
    const result=importCadDxfCurve({fileName:'inches.DXF',text,units:'inch',curveId:'curve_input',name:'Inches'});
    expect(result).toMatchObject({scaleToMillimeters:25.4,curve:{id:'curve_input',name:'Inches',source:{text,fileName:'inches.DXF',units:'inch'}}});
    expect(resolveCadCurve(result.curve,{}).length).toBe(50.8);
    expect(()=>importCadDxfCurve({fileName:'units.dxf',text,units:'mm'})).toThrow(/conflict/);
    const missing=dxf(polyline([{x:0,y:0},{x:2,y:0}]),null);
    expect(()=>importCadDxfCurve({fileName:'missing.dxf',text:missing})).toThrow(/units/);
    expect(resolveCadCurve(importCadDxfCurve({fileName:'missing.dxf',text:missing,units:'cm'}).curve,{}).length).toBe(20);
  });
  it('applies negative-Z OCS reflection without reversing supplied traversal',()=>{
    const body=polyline([{x:5,y:0,bulge:Math.tan(Math.PI/8)},{x:0,y:5}]);body.push('210',0,'220',0,'230',-1);
    const result=importCadDxfCurve({fileName:'reflected.dxf',text:dxf(body)}); const resolved=resolveCadCurve(result.curve,{});
    expect(resolved.start[0]).toBeCloseTo(-5,12);expect(resolved.start[1]).toBeCloseTo(0,12);
    expect(resolved.end[0]).toBeCloseTo(0,12);expect(resolved.end[1]).toBeCloseTo(5,12);
    const arc=resolved.segments[0];if(arc.kind!=='arc') throw new Error('Expected arc');expect(arc.sweep).toBeCloseTo(-90,12);
  });
  it('rejects a physical gap without bridging it during chain assembly',()=>{
    const text=dxf(['0','LINE','10',0,'20',0,'11',10,'21',0,'0','LINE','10',10+1e-9,'20',0,'11',20,'21',0]);
    expect(()=>importCadDxfCurve({fileName:'gap.dxf',text})).toThrow(/connected/);
  });
  it.each([
    polyline([{x:0,y:0},{x:10,y:0},{x:0,y:0}]),
    polyline([{x:0,y:0},{x:10,y:0}],true),
    [...polyline([{x:0,y:0},{x:10,y:0}]),...polyline([{x:20,y:0},{x:30,y:0}])],
    [...polyline([{x:0,y:0},{x:10,y:0}]),'0','LINE','10',10,'20',0,'11',20,'21',0],
    ['0','LINE','10',0,'20',0,'11',10,'21',0,'0','LINE','10',10,'20',0,'11',20,'21',0,'0','LINE','10',10,'20',0,'11',10,'21',10],
    polyline([{x:0,y:0},{x:10,y:10},{x:0,y:10},{x:10,y:0}]),
    ['0','CIRCLE','10',0,'20',0,'40',5],
    ['0','SPLINE','70',0],
    ['0','LINE','10',0,'20',0,'30',2,'11',10,'21',0],
    [...polyline([{x:0,y:0},{x:10,y:0}]),'38',1],
  ].map(body=>({body})))('rejects closed, multiple, branched, crossing, omitted and nonplanar data without partial import (%#)',({body})=>{
    expect(()=>importCadDxfCurve({fileName:'invalid.dxf',text:dxf(body)})).toThrow();
  });
  it('does not weaken the existing closed-sketch import boundary',()=>{
    const text=exportCadCurveDxf(curve([line]),{});
    expect(()=>importCadDxfSketch({fileName:'open.dxf',text})).toThrow(/closed/);
    const closed=dxf(polyline([{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}],true));
    expect(importCadDxfSketch({fileName:'closed.dxf',text:closed}).contourCount).toBe(1);
    expect(()=>importCadDxfCurve({fileName:'closed.dxf',text:closed})).toThrow(/open/);
  });
  it.each([2,4])('rejects classic fitted/spline polyline flags=%s rather than importing control points as lines',flags=>{
    const body=polyline([{x:0,y:0},{x:10,y:10},{x:20,y:0}],false,true); body[7]=flags;
    expect(()=>importCadDxfCurve({fileName:'fitted.dxf',text:dxf(body)})).toThrow(/fitted|spline/);
    const vertexFlags=polyline([{x:0,y:0},{x:10,y:0}],false,true);vertexFlags.splice(vertexFlags.length-2,0,'70',1);
    expect(()=>importCadDxfCurve({fileName:'fitted-vertex.dxf',text:dxf(vertexFlags)})).toThrow(/control vertices/);
  });
  it.each([
    {classic:false,code:43,value:2},{classic:false,code:40,value:2},{classic:false,code:41,value:2},
    {classic:true,code:40,value:2},{classic:true,code:41,value:2},{classic:false,code:43,value:'invalid'},
    {classic:false,code:43,value:''}
  ])('rejects discarded polyline widths classic=$classic/code=$code/value=$value',({classic,code,value})=>{
    const body=polyline([{x:0,y:0},{x:10,y:0}],false,classic);
    if(classic) body.splice(body.length-2,0,String(code),value); else body.push(String(code),value);
    expect(()=>importCadDxfCurve({fileName:'width.dxf',text:dxf(body)})).toThrow(/width/);
  });
  it('retains zero-width classic/modern paths and ordinary ARC radius fields',()=>{
    for(const classic of [false,true]) {
      const body=polyline([{x:0,y:0},{x:10,y:0}],false,classic);
      const widths=['40',0,'41',0,'43',0];if(classic) body.splice(body.length-2,0,...widths);else body.push(...widths);
      expect(importCadDxfCurve({fileName:'zero.dxf',text:dxf(body)}).curve.segments).toHaveLength(1);
    }
    const arc=importCadDxfCurve({fileName:'arc.dxf',text:dxf(['0','ARC','10',0,'20',0,'40',2,'50',0,'51',90])});
    expect(arc.curve.segments[0]).toMatchObject({kind:'arc',radius:2,sweep:90});
  });
  it('rejects classic header and inserted block widths before tolerant parsing can omit them',()=>{
    const classic=polyline([{x:0,y:0},{x:10,y:0}],false,true);classic.splice(8,0,'40',2);
    expect(()=>importCadDxfCurve({fileName:'header-width.dxf',text:dxf(classic)})).toThrow(/width/);
    const body=polyline([{x:0,y:0},{x:10,y:0}]);body.push('43',2);
    const block=['0','SECTION','2','BLOCKS','0','BLOCK','2','rail','10',0,'20',0,...body,'0','ENDBLK','0','ENDSEC'].join('\n')+'\n';
    const text=block+dxf(['0','INSERT','2','rail','10',0,'20',0]);
    expect(()=>importCadDxfCurve({fileName:'block-width.dxf',text})).toThrow(/width/);
  });
  it('preserves large exact originals while rejecting malformed files and unsafe own-data inputs',()=>{
    const text=dxf(polyline([{x:0,y:0},{x:10,y:0}]));
    expect(()=>importCadDxfCurve({fileName:'broken.dxf',text:text.replace('0\nEOF\n','')})).toThrow(/complete/);
    let accessed=0; const hostile={fileName:'evil.dxf',get text(){++accessed;return text;}};
    expect(()=>parseCadDxfCurveImportInput(hostile)).toThrow(); expect(accessed).toBe(0);
    expect(()=>parseCadDxfCurveImportInput({fileName:'bad.dxf',text,unknown:true})).toThrow();
    const large = dxf([...Array.from({length:1000},()=>[999,'孔😀'.repeat(320)]).flat(),...polyline([{x:0,y:0},{x:10,y:0}])]);
    expect(new TextEncoder().encode(large).length).toBeGreaterThan(2*1024*1024);
    const imported=importCadDxfCurve({fileName:'large.dxf',text:large});
    expect(imported.curve.source?.text).toBe(large); expect(isCadDxfCurveImportResult(imported)).toBe(true);
    expect(resolveCadCurve(imported.curve,{}).length).toBe(10);
    const hostileCurve={...curve([line]),get suppressed(){++accessed;return false;}};
    expect(()=>exportCadCurveDxf(hostileCurve,{})).toThrow(/own complete/);expect(accessed).toBe(0);
  });
  it('retains a complete edge chain beyond the former 2048-edge ceiling and rejects uncertain bulge support instead of flattening it',()=>{
    const tooLarge=dxf(polyline(Array.from({length:2050},(_,index)=>({x:index,y:0}))));
    const imported=importCadDxfCurve({fileName:'large.dxf',text:tooLarge});
    expect(imported.curve.segments).toHaveLength(2049); expect(imported.curve.source?.text).toBe(tooLarge);
    expect(isCadDxfCurveImportResult(imported)).toBe(true); expect(resolveCadCurve(imported.curve,{}).length).toBe(2049);
    const again=importCadDxfCurve({fileName:'again.dxf',text:exportCadCurveDxf(imported.curve,{})});
    expect(again.curve.segments).toHaveLength(2049); expect(resolveCadCurve(again.curve,{}).end).toEqual([2049,0]);
    const tinyArc=curve([{kind:'arc',center:[0,500000],radius:500000,startAngle:270-0.00001,sweep:0.00002}]);
    expect(()=>exportCadCurveDxf(tinyArc,{})).toThrow(/precision|bulge/);
    roundtrip(curve([{kind:'arc',center:[100000000,100000000],radius:5,startAngle:0,sweep:180}]));
  });
  it('guards detached import result geometry, canonical units and source cardinality',()=>{
    const result=importCadDxfCurve({fileName:'guard.dxf',text:dxf(polyline([{x:0,y:0},{x:10,y:0}]))});
    expect(isCadDxfCurveImportResult(result)).toBe(true);
    expect(isCadDxfCurveImportResult({...result,scaleToMillimeters:25.4})).toBe(false);
    expect(isCadDxfCurveImportResult({...result,sourceEntityCount:2})).toBe(false);
    expect(isCadDxfCurveImportResult({...result,curve:{...result.curve,suppressed:true}})).toBe(false);
    expect(isCadDxfCurveImportResult({...result,unitDeclaration:{status:'recognized',units:{source:'dxf-insunits',code:4,label:'fake',scaleToMillimeters:1}}})).toBe(false);
    expect(isCadDxfCurveImportResult(Object.create(result))).toBe(false);
    expect(cadCurveToDxf(parseCadDocument({...createCadDocument('Curve'),features:[result.curve]}),result.curve.id)).toContain('LWPOLYLINE');
    expect(()=>exportCadCurveDxf({...result.curve,suppressed:true},{})).toThrow(/Unsuppress/);
  });
});
