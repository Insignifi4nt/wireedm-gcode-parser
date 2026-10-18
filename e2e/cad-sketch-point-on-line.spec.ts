import { expect, test } from '@playwright/test';
import { prepareCadTools, callCadTool as call, cadContext as context } from './cad-tool-helpers';

test('slides a bore on an angled guide, locates it and follows guide edits through private Finish, history, agent parity and save',async({page})=>{
  await prepareCadTools(page);await call(page,'cad_open_workspace');
  const sketch={id:'plate',kind:'sketch',name:'Guided bore plate',suppressed:false,plane:'XY',offset:0,profiles:[],graph:{
    points:[{id:'a',position:[' 0.00 ','0']},{id:'b',position:['70','0']},{id:'c',position:['70','30']},{id:'d',position:['0','30']},
      {id:'guide-a',position:['0.000','0']},{id:'guide-b',position:['60.00',' guideHeight ']},{id:'center',position:[20,14]}],
    entities:[{id:'ab',kind:'line',startPointId:'a',endPointId:'b',construction:false},{id:'bc',kind:'line',startPointId:'b',endPointId:'c',construction:false},
      {id:'cd',kind:'line',startPointId:'c',endPointId:'d',construction:false},{id:'da',kind:'line',startPointId:'d',endPointId:'a',construction:false},
      {id:'guide',kind:'line',startPointId:'guide-a',endPointId:'guide-b',construction:true},{id:'bore',kind:'circle',centerPointId:'center',radius:' 3.00 ',construction:false}],relations:[]}};
  await call(page,'cad_edit_document',{expectedVersion:(await context(page)).version,edits:[{kind:'set-parameter',name:'guideHeight',value:30},{kind:'add-feature',feature:sketch},
    {kind:'add-feature',feature:{id:'pad',kind:'extrude',name:'Thickness',suppressed:false,sketchId:'plate',distance:' 5e0 ',symmetric:false,operation:'new',targetId:null}}]});
  const base=await context(page),read=(version:string)=>call(page,'cad_get_feature',{expectedVersion:version,featureId:'plate'}).then(r=>r.feature);
  const edit=async()=>{await page.getByRole('button',{name:'Select Guided bore plate in history',exact:true}).dblclick();await expect(page.getByRole('button',{name:'Cancel sketch edits',exact:true})).toBeVisible();};
  const apply=async()=>{await page.getByRole('button',{name:'Apply',exact:true}).click();await expect(page.getByRole('button',{name:'Apply',exact:true})).toHaveCount(0);};
  const pick=async(kind:'point'|'entity',id:string,add=false)=>page.locator(`[data-cad-sketch-${kind}="${id}"]`).press(add?'Shift+Enter':'Enter');
  await edit();await pick('point','center');await pick('entity','guide',true);await page.getByRole('checkbox',{name:'Point on line',exact:true}).check();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();expect(await read(base.version)).toEqual(sketch);
  await page.getByRole('checkbox',{name:'Point on line',exact:true}).check();await apply();
  const marker=page.locator('[data-cad-sketch-point="center"] .cad-sketch-point-mark'),box=await marker.boundingBox();if(!box)throw Error('Missing bore grip');
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+80,box.y+box.height/2-60,{steps:5});await page.mouse.up();
  const position=()=>marker.evaluate(el=>{const origin=el.closest('svg')?.querySelector('[data-cad-sketch-point="guide-a"] .cad-sketch-point-mark');if(!origin)throw Error('Missing guide origin');return ['cx','cy'].map(axis=>Number(el.getAttribute(axis))-Number(origin.getAttribute(axis)));});
  await expect.poll(async()=>{const p=await position();return Math.abs(p[1]-p[0]/2);}).toBeLessThan(1e-9);
  const moved=await position();expect(moved[0]).toBeGreaterThan(25);
  await pick('point','center');await page.getByRole('checkbox',{name:'Fix X',exact:true}).check();await page.getByRole('textbox',{name:'Fix X mm',exact:true}).fill('30');await apply();
  await pick('point','guide-b');await page.getByRole('textbox',{name:'Y mm',exact:true}).fill('24');await apply();expect(await read(base.version)).toEqual(sketch);
  await page.getByRole('button',{name:'Finish sketch',exact:true}).click();await expect(page.getByRole('button',{name:'Finish sketch',exact:true})).toHaveCount(0);
  let current=await context(page);const human=await read(current.version),finalPoints=[...sketch.graph.points.slice(0,6),{id:'center',position:[expect.closeTo(30,10),expect.closeTo(12,10)]}];expect(human.graph.points).toEqual(finalPoints);
  expect(human.graph.entities).toEqual(sketch.graph.entities);expect(human.graph.relations).toEqual([{id:expect.any(String),kind:'point-on-line',pointId:'center',lineId:'guide'},
    {id:expect.any(String),kind:'fixed-axis',pointId:'center',axis:'x',value:30}]);expect(current.parameters).toEqual({guideHeight:24});
  let built=await call(page,'cad_build',{expectedVersion:current.version});expect(built.diagnostics).toEqual([]);expect(built.bodies[0]).toMatchObject({solidCount:1,boundsMm:{min:[0,0,0],max:[70,30,5]}});expect(built.bodies[0].volumeMm3).toBeCloseTo(10500-45*Math.PI,6);
  expect(await call(page,'cad_inspect_sketch_constraints',{expectedVersion:current.version,sketchId:'plate',section:'relations'})).toMatchObject({analysis:{degreesOfFreedom:0}});
  await edit();await pick('entity','guide');await pick('point','center',true);await expect(page.getByRole('checkbox',{name:'Point on line',exact:true})).toBeChecked();
  await page.getByRole('checkbox',{name:'Point on line',exact:true}).uncheck();await apply();await page.getByRole('button',{name:'Cancel sketch edits',exact:true}).click();await expect(page.getByRole('button',{name:'Cancel sketch edits',exact:true})).toHaveCount(0);expect(await read(current.version)).toEqual(human);
  await call(page,'cad_history',{expectedVersion:current.version,direction:'undo'});current=await context(page);expect(await read(current.version)).toEqual(sketch);expect(current.parameters).toEqual({guideHeight:30});
  await call(page,'cad_history',{expectedVersion:current.version,direction:'redo'});current=await context(page);expect(await read(current.version)).toEqual(human);
  await call(page,'cad_history',{expectedVersion:current.version,direction:'undo'});current=await context(page);
  await call(page,'cad_edit_document',{expectedVersion:current.version,edits:[{kind:'set-parameter',name:'guideHeight',value:24},...human.graph.relations.map((relation:unknown)=>({kind:'set-sketch-relation',sketchId:'plate',relation}))]});current=await context(page);const agent=await read(current.version);expect(agent).toEqual({...human,graph:{...human.graph,points:finalPoints}});
  built=await call(page,'cad_build',{expectedVersion:current.version});expect(built.diagnostics).toEqual([]);expect(built.bodies[0].volumeMm3).toBeCloseTo(10500-45*Math.PI,6);
  await call(page,'cad_save_document',{expectedVersion:current.version});await page.reload();await expect(page.getByRole('main',{name:'Parametric CAD workbench'})).toBeVisible();current=await context(page);expect(current.dirty).toBe(false);expect(await read(current.version)).toEqual(agent);
});
