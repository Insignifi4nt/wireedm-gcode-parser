import { describe, expect, it } from 'vitest';
import type { CadCurveFeature, CadDocument, CadFeature, CadPlane, CadSketchFeature, CadSketchProfile } from '../cadDocument';
import { CadError } from '../cadError';
import { inspectCadSweepInputs, inspectCadSweepSketch, resolveCadSweepInputs, type CadSweepFeature } from '../cadSweep';
import { cadSweepEdgeDistanceLowerBound, cadSweepProfileRadius } from '../cadSweepClearance';
import { cadOrderedCurveEntities } from '../cadAnalyticSegments';
import { resolveCadCurve } from '../cadCurve';
import { applyCadEdits } from '../cadOperations';
import { cadConsumedBodyIds, cadFeatureDependencies, cadFeatureInputs, cadFeatureProducesBody, cadVisibleBodyIds, createCadDocument, parseCadDocument } from '../cadSchema';

const feature: CadSweepFeature = { kind:'sweep',id:'sweep',name:'Sweep',suppressed:false,sketchId:'section',curveId:'rail',operation:'new',targetId:null };
function circle(x = 0, y = 0, radius: number | string = 1, id = 'circle'): CadSketchProfile {
  return {id,name:id,construction:false,geometry:{kind:'circle',x,y,radius}};
}
function section(profiles: readonly CadSketchProfile[] = [circle()], plane: CadPlane = 'YZ', offset: number | string = 0): CadSketchFeature {
  return {kind:'sketch',id:'section',name:'Section',suppressed:false,plane,offset,profiles};
}
function rail(segments: CadCurveFeature['segments'] = [{kind:'line',start:[0,0],end:[20,0]}], plane: CadPlane = 'XY', offset: number | string = 0): CadCurveFeature {
  return {kind:'curve',id:'rail',name:'Rail',suppressed:false,plane,offset,segments};
}
function resolve(sketch = section(), curve = rail(), parameters: Readonly<Record<string, number>> = {}) {
  return resolveCadSweepInputs(feature,new Map<string,CadFeature>([[sketch.id,sketch],[curve.id,curve]]),parameters);
}
function expectCode(operation: () => unknown, code: string) {
  try { operation(); throw new Error('Expected validation failure'); } catch(error) { expect(error).toBeInstanceOf(CadError); expect(error).toMatchObject({code}); }
}

describe('Sweep input placement and conservative clearance', () => {
  it('retains exact section/curve placement, reports bounded native work and freezes numeric receipts', () => {
    const sketch = section([circle(0,0,'radius')]); const curve = rail([{kind:'line',start:[0,0],end:['length',0]}]);
    const result = resolve(sketch,curve,{radius:2,length:20});
    expect(result).toMatchObject({section:{sketch,geometry:{kind:'circle',radius:2},offset:0},curve:{startWorld:[0,0,0],endWorld:[20,0,0]},
      frame:{tangent:[1,0,0],normal:[0,1,0],binormal:[0,0,1]},sectionEdgeCount:1,nativeWork:1,
      clearance:{profileRadiusMm:expect.closeTo(2,12),transportUncertaintyMm:expect.any(Number),envelopeEdgeCount:4}});
    expect(result.clearance.enclosingRadiusMm).toBeGreaterThan(2); expect(result.clearance.minimumRadiusMarginMm).toBeNull();
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.clearance)).toBe(true);
    expect(sketch.profiles[0].geometry).toMatchObject({radius:'radius'}); expect(curve.segments[0]).toMatchObject({end:['length',0]});
  });
  it.each(['XY','XZ','YZ'] satisfies CadPlane[])('resolves signed offsets and the actual section frame on %s', plane => {
    const curve = rail(undefined,plane,12);
    const sketch = plane === 'XY' ? section([circle(0,12)],'YZ') : plane === 'XZ' ? section([circle(-12,0)],'YZ') : section([circle(12,0)],'XZ');
    const result = resolve(sketch,curve); expect(result.clearance.profileRadiusMm).toBeCloseTo(1,12);
    expect(result.frame.binormal).toEqual(plane === 'XY' ? [0,0,1] : plane === 'XZ' ? [0,-1,0] : [1,0,0]);
  });
  it.each([90,-90,270,-270])('accepts signed %s-degree exact circular rails without choosing another traversal', sweep => {
    const curve = rail([{kind:'arc',center:[0,sweep>0?10:-10],radius:10,startAngle:sweep>0?-90:90,sweep}]);
    const result = resolve(section(),curve); expect(result.curve.segments[0]).toMatchObject({sweep});
    expect(result.clearance.minimumRadiusMarginMm).toBeGreaterThan(8); expect(result.clearance.envelopeEdgeCount).toBe(4);
  });
  it('accepts a G1 line/arc/line chain and counts real analytic section edges', () => {
    const curve = rail([{kind:'line',start:[0,0],end:[10,0]},{kind:'arc',center:[10,10],radius:10,startAngle:-90,sweep:90},{kind:'line',start:[20,10],end:[20,30]}]);
    const sketch = section([{...circle(),geometry:{kind:'rectangle',x:-1,y:-1,width:2,height:2,cornerRadius:0}}]);
    expect(resolve(sketch,curve)).toMatchObject({sectionEdgeCount:4,nativeWork:12,clearance:{envelopeEdgeCount:8}});
  });
  it('accepts tangent curvature changes and adjacent pieces on the same circular support', () => {
    const inflection=rail([{kind:'arc',center:[0,10],radius:10,startAngle:-90,sweep:90},
      {kind:'arc',center:[20,10],radius:10,startAngle:180,sweep:-90}]);
    expect(resolve(section(),inflection).clearance.envelopeEdgeCount).toBe(6);
    const split=rail([{kind:'arc',center:[0,10],radius:10,startAngle:270,sweep:45},
      {kind:'arc',center:[0,10],radius:10,startAngle:315,sweep:45}]);
    expect(resolve(section(),split).curve.length).toBeCloseTo(5*Math.PI,10);
  });
  it('rejects suppressed/empty/holed/multiple material references and never discards boundaries', () => {
    expect(inspectCadSweepSketch({...section(),suppressed:true},{})).toMatchObject({eligible:false,code:'suppressed-sketch'});
    expect(inspectCadSweepSketch(section([]),{})).toMatchObject({eligible:false,code:'empty-sketch'});
    for(const profiles of [[circle(0,0,3,'outer'),circle(0,0,1,'hole')],[circle(0,0,1,'first'),circle(10,0,1,'second')]]) {
      expect(inspectCadSweepSketch(section(profiles),{})).toMatchObject({eligible:false,code:'unsupported-sweep-section'});
    }
    expectCode(()=>resolve(section(),{...rail(),suppressed:true}),'suppressed-curve');
  });
  it('reports actionable plane/offset advice without relocating or rotating the section', () => {
    const map = new Map<string,CadFeature>([['section',section(undefined,'YZ',5)],['rail',rail()]]);
    expect(inspectCadSweepInputs(feature,map,{})).toMatchObject({eligible:false,code:'unsupported-sweep-placement',message:expect.stringContaining('YZ sketch at offset 0')});
    expectCode(()=>resolve(section(undefined,'XY'),rail()),'unsupported-sweep-placement');
    expectCode(()=>resolve(section(),rail([{kind:'line',start:[0,0],end:[20,20]}])),'unsupported-sweep-placement');
  });
  it('rejects physical and dot-rounded tiny corners while retaining ordinary Curve validity', () => {
    for(const y of [10,1e-9]) expectCode(()=>resolve(section(),rail([{kind:'line',start:[0,0],end:[1,0]},{kind:'line',start:[1,0],end:[2,y]}])),'unsupported-sweep-corner');
  });
  it('encloses off-centre sections about the real rail start and rejects local folding', () => {
    const curve = rail([{kind:'arc',center:[0,2],radius:2,startAngle:-90,sweep:90}]);
    expectCode(()=>resolve(section([circle(0,0,3)]),curve),'unsupported-sweep-clearance');
    expectCode(()=>resolve(section([circle(3,0,1)]),curve),'unsupported-sweep-clearance');
  });
  it('rejects globally closing endpoint tubes even when each arc satisfies local curvature', () => {
    for(const sweep of [350,359.999]) expectCode(()=>resolve(section(),rail([{kind:'arc',center:[0,10],radius:10,startAngle:-90,sweep}])),'unsupported-sweep-clearance');
    expect(resolve(section(),rail([{kind:'arc',center:[0,10],radius:10,startAngle:-90,sweep:340}])).clearance.minimumRadiusMarginMm).toBeGreaterThan(8);
  });
  it('rejects interior return-leg overlap and uncertainty although all bend radii are safely large', () => {
    const curve=rail([{kind:'line',start:[0,0],end:[20,0]}, {kind:'arc',center:[20,10],radius:10,startAngle:270,sweep:90},
      {kind:'line',start:[30,10],end:[30,30]}, {kind:'arc',center:[20,30],radius:10,startAngle:0,sweep:90},
      {kind:'line',start:[20,40],end:[0,40]}, {kind:'arc',center:[0,30],radius:10,startAngle:90,sweep:90},
      {kind:'line',start:[-10,30],end:[-10,13]}, {kind:'arc',center:[0,13],radius:10,startAngle:180,sweep:90},
      {kind:'line',start:[0,3],end:[20,3]}]);
    expect(resolve(section([circle(0,0,1)]),curve).curve.segments).toHaveLength(9);
    for(const radius of [1.5,2]) expectCode(()=>resolve(section([circle(0,0,radius)]),curve),'unsupported-sweep-clearance');
  });
  it('keeps derived outer offset radii independent of the saved primitive radius limit', () => {
    const result=resolve(section([circle(1e6,0)],'YZ',1e6),rail([{kind:'arc',center:[1e6,2e6],radius:1e6,startAngle:270,sweep:90}]));
    expect(result.clearance.minimumRadiusMarginMm).toBeGreaterThan(999998);
    // Near the origin, subtraction of the remote support loses more than the
    // actual cap-joint tolerance. Preserve that uncertainty rejection.
    expectCode(()=>resolve(section(),rail([{kind:'arc',center:[0,1e6],radius:1e6,startAngle:270,sweep:90}])),'unsupported-sweep-precision');
  });
  it('uses actual semicircle caps for a short straight tube', () => {
    expect(resolve(section(),rail([{kind:'line',start:[0,0],end:[0.5,0]}])).clearance.envelopeEdgeCount).toBe(4);
  });
  it('rejects short edges and accumulated far-origin transport uncertainty explicitly', () => {
    expectCode(()=>resolve(section(),rail([{kind:'line',start:[0,0],end:[1e-6,0]}])),'unsupported-sweep-precision');
    expectCode(()=>resolve(section(undefined,'YZ',1e8),rail([{kind:'line',start:[1e8,0],end:[1e8+20,0]}])),'unsupported-sweep-precision');
    expectCode(()=>resolve(section([circle(0,1e8)]),rail(undefined,'XY',1e8)),'unsupported-sweep-precision');
  });
  it('accounts for accumulated accepted Curve joint gaps rather than repairing their native frame', () => {
    const origin=100000; const gap=1.7e-10;
    const segments=Array.from({length:64},(_,i)=>({kind:'line' as const,start:[origin+i+i*gap,0] as const,end:[origin+i+1+i*gap,0] as const}));
    const curve=rail(segments); expect(resolveCadCurve(curve,{}).segments).toHaveLength(64);
    expectCode(()=>resolve(section(undefined,'YZ',origin),curve),'unsupported-sweep-precision');
    const exact=rail(segments.map((_,i)=>({kind:'line',start:[origin+i,0],end:[origin+i+1,0]})));
    expect(resolve(section(undefined,'YZ',origin),exact).clearance.transportUncertaintyMm).toBeLessThan(1e-7);
  });
  it('bounds native work while the complete Curve remains reusable', () => {
    const segments = Array.from({length:65},(_,i)=>({kind:'line' as const,start:[i,0] as const,end:[i+1,0] as const}));
    expectCode(()=>resolve(section(),rail(segments)),'sweep-work-limit');
    const polygon = {...circle(),geometry:{kind:'polygon' as const,points:Array.from({length:33},(_,i)=>[Math.cos(i*2*Math.PI/33),Math.sin(i*2*Math.PI/33)] as const)}};
    expectCode(()=>resolve(section([polygon]),rail(segments.slice(0,64))),'sweep-work-limit');
    expect(resolve(section(),rail(segments.slice(0,64))).nativeWork).toBe(64);
  });
  it('rejects strict unknown fields and accessor-backed feature data before reading it', () => {
    expectCode(()=>resolveCadSweepInputs({...feature,unknown:true} as CadSweepFeature,new Map(),{}),'invalid-feature');
    let reads=0; const getter={...feature}; Object.defineProperty(getter,'sketchId',{get(){reads++;return 'section';}});
    expectCode(()=>resolveCadSweepInputs(getter,new Map(),{}),'invalid-feature'); expect(reads).toBe(0);
  });
});

function document(features: readonly CadFeature[], parameters: Readonly<Record<string,number>> = {}): CadDocument {
  return parseCadDocument({...createCadDocument('Sweep part','cad_sweep'),features,parameters});
}
describe('Sweep saved history compatibility and atomic operations', () => {
  it('preserves expressions and previous immutable history when a parameter invalidates clearance', () => {
    const sketch=section([circle(0,0,'radius')]);
    const curve=rail([{kind:'arc',center:[0,10],radius:10,startAngle:-90,sweep:90}]);
    const original=document([sketch,curve,feature],{radius:1});
    const changed=applyCadEdits(original,[{kind:'set-parameter',name:'radius',value:2}]);
    expect(changed.parameters.radius).toBe(2); expect(original.parameters.radius).toBe(1);
    expect(changed.features[0]).toMatchObject({profiles:[{geometry:{radius:'radius'}}]});
    expectCode(()=>applyCadEdits(original,[{kind:'set-parameter',name:'radius',value:11}]),'unsupported-sweep-clearance');
    expect(original.parameters.radius).toBe(1);
  });
  it('validates typed preceding references and dependency-aware deletion/cascade', () => {
    const original=document([section(),rail(),feature]);
    expect(cadFeatureInputs(feature)).toEqual({sketchIds:['section'],curveIds:['rail'],bodyIds:[],datumIds:[]});
    expect(cadFeatureDependencies(feature)).toEqual(['section','rail']);
    expect(cadFeatureProducesBody(feature)).toBe(true); expect(cadVisibleBodyIds(original.features, original)).toEqual(['sweep']);
    expectCode(()=>document([feature,section(),rail()]),'invalid-reference');
    expectCode(()=>document([section(),rail(),{...feature,curveId:'section'}]),'invalid-reference');
    expectCode(()=>applyCadEdits(original,[{kind:'delete-feature',featureId:'rail',cascade:false}]),'dependent-feature');
    expect(applyCadEdits(original,[{kind:'delete-feature',featureId:'rail',cascade:true}]).features.map(f=>f.id)).toEqual(['section']);
  });
  it('allows repairing a suppressed Sweep and rejects incompatible unsuppression atomically', () => {
    const original=document([section(),rail(),{...feature,suppressed:true}]);
    const holed=section([circle(0,0,3,'outer'),circle(0,0,1,'hole')]);
    const changed=applyCadEdits(original,[{kind:'update-feature',feature:holed}]);
    expectCode(()=>applyCadEdits(changed,[{kind:'update-feature',feature}]),'unsupported-sweep-section');
    expect(changed.features[2]).toMatchObject({suppressed:true});
    expectCode(()=>document([holed,rail(),{...feature,suppressed:true,curveId:'missing'}]),'invalid-reference');
    expectCode(()=>document([section(),rail(),{...feature,suppressed:true,operation:'join'}]),'invalid-operation');
  });
  it('consumes only an active join/cut target and retains reusable source references', () => {
    const pad: CadFeature={kind:'extrude',id:'pad',name:'Pad',suppressed:false,sketchId:'section',distance:2,symmetric:false,operation:'new',targetId:null};
    const joined={...feature,operation:'join' as const,targetId:'pad'};
    const original=document([section(),rail(),pad,joined]);
    expect(cadConsumedBodyIds(joined, original)).toEqual(['pad']); expect(cadVisibleBodyIds(original.features, original)).toEqual(['sweep']);
    expectCode(()=>document([...original.features,{...joined,id:'second'}]),'unavailable-body');
    expect(cadConsumedBodyIds({...joined,suppressed:true}, original)).toEqual([]);
    expectCode(()=>document([section(),rail(),{...joined,targetId:'rail'}]),'invalid-reference');
  });
  it('counts a new generated operand plus target through nested pattern budgets', () => {
    const pad: CadFeature={kind:'extrude',id:'pad',name:'Pad',suppressed:false,sketchId:'section',distance:2,symmetric:false,operation:'new',targetId:null};
    const hundred: CadFeature={kind:'linear-pattern',id:'hundred',name:'Hundred',suppressed:false,sourceId:'pad',count:100,spacing:[2,0,0]};
    const multiplied=(count:number):CadFeature=>({kind:'linear-pattern',id:'target',name:'Target',suppressed:false,sourceId:'hundred',count,spacing:[0,2,0]});
    const joined={...feature,operation:'join' as const,targetId:'target'};
    expectCode(()=>document([section(),rail(),pad,hundred,multiplied(10),joined]),'feature-limit');
    expectCode(()=>document([section(),rail(),pad,hundred,multiplied(5),joined,{kind:'linear-pattern',id:'twice',name:'Twice',suppressed:false,sourceId:'sweep',count:2,spacing:[0,0,2]}]),'feature-limit');
    expect(document([section(),rail(),pad,hundred,multiplied(4),joined,{kind:'linear-pattern',id:'twice',name:'Twice',suppressed:false,sourceId:'sweep',count:2,spacing:[0,0,2]}]).features).toHaveLength(7);
  });
});

describe('Sweep analytic enclosure and separation predicates', () => {
  it('bounds circle offsets and interior arc radius extrema rather than sampling endpoints', () => {
    expect(cadSweepProfileRadius({kind:'circle',x:3,y:0,radius:2},{x:0,y:0})).toBeGreaterThanOrEqual(5);
    const geometry={kind:'path' as const,segments:[{kind:'arc' as const,center:[-1,0] as const,radius:2,startAngle:90,sweep:180},{kind:'line' as const,start:[-1,-2] as const,end:[-1,2] as const}]};
    expect(cadSweepProfileRadius(geometry,{x:0,y:0})).toBeGreaterThanOrEqual(3);
    expect(cadSweepProfileRadius(geometry,{x:0,y:0})).toBeLessThan(3.0000000001);
    expect(cadSweepProfileRadius({kind:'polygon',points:[[-2,-2],[2,-2],[2,2],[0,0],[-2,2]]},{x:0,y:0})).toBeGreaterThanOrEqual(Math.sqrt(8));
  });
  it('finds interior line/arc and arc/arc stationary minima and handles concentric supports', () => {
    const line=cadOrderedCurveEntities([{kind:'line',start:[-5,5],end:[5,5]}])[0];
    const first=cadOrderedCurveEntities([{kind:'arc',center:[0,0],radius:1,startAngle:0,sweep:180}])[0];
    expect(cadSweepEdgeDistanceLowerBound(line,first,1e-7)).toBeCloseTo(4-1e-7,10);
    const pair=cadOrderedCurveEntities([{kind:'arc',center:[0,0],radius:1,startAngle:-20,sweep:40},{kind:'arc',center:[5,0],radius:1,startAngle:160,sweep:40}]);
    expect(cadSweepEdgeDistanceLowerBound(pair[0],pair[1],1e-7)).toBeCloseTo(3-1e-7,10);
    const concentric=cadOrderedCurveEntities([{kind:'arc',center:[0,0],radius:9,startAngle:0,sweep:270},{kind:'arc',center:[0,0],radius:11,startAngle:0,sweep:270}]);
    expect(cadSweepEdgeDistanceLowerBound(concentric[0],concentric[1],1e-7)).toBeCloseTo(2-1e-7,10);
  });
  it('returns no safety certificate for tangency/crossing or uncertain concentric coincidence', () => {
    const lines=cadOrderedCurveEntities([{kind:'line',start:[-1,0],end:[1,0]},{kind:'line',start:[0,-1],end:[0,1]}]);
    expect(cadSweepEdgeDistanceLowerBound(lines[0],lines[1],1e-7)).toBe(0);
    const arcs=cadOrderedCurveEntities([{kind:'arc',center:[0,0],radius:1,startAngle:0,sweep:180},{kind:'arc',center:[0,0],radius:1,startAngle:180,sweep:180}]);
    expect(cadSweepEdgeDistanceLowerBound(arcs[0],arcs[1],1e-7)).toBe(0);
  });
});
