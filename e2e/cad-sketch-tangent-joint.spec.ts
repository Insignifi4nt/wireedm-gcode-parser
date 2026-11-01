import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures/native-sketch-solver';
import { prepareCadTools, callCadTool as call, cadContext as context, historyRow, openRelationsList, relationOffer, relationRow } from './cad-tool-helpers';

test('keeps a rounded profile tangent through radius edits, private recovery, solid/export, exact history and saved agent parity',async({page})=>{
  await prepareCadTools(page);await call(page,'cad_open_workspace');
  const sketch={id:'outline',kind:'sketch',name:'Rounded detail',suppressed:false,plane:'XY',offset:0,profiles:[],graph:{
    points:[{id:'a',position:[' -10 ','0']},{id:'j',position:[' 0 ','0']},{id:'c',position:[0,5]},{id:'e',position:[5,' bendRadius ']},{id:'top',position:[' -10 ',' bendRadius ']}],
    entities:[{id:'line',kind:'line',startPointId:'a',endPointId:'j',construction:false},{id:'arc',kind:'arc',centerPointId:'c',startPointId:'j',endPointId:'e',direction:'ccw',construction:false},
      {id:'upper',kind:'line',startPointId:'e',endPointId:'top',construction:false},{id:'left',kind:'line',startPointId:'top',endPointId:'a',construction:false}],
    relations:[{id:'radius',kind:'radial-size',entityId:'arc',quantity:'radius',value:' bendRadius '}]}};
  await call(page,'cad_edit_document',{expectedVersion:(await context(page)).version,edits:[{kind:'set-parameter',name:'bendRadius',value:5},{kind:'add-feature',feature:sketch},
    {kind:'add-feature',feature:{id:'pad',kind:'extrude',name:'Thickness',suppressed:false,sketchId:'outline',distance:' 5e0 ',symmetric:false,operation:'new',targetId:null}}]});
  const base=await context(page),read=(version:string)=>call(page,'cad_get_feature',{expectedVersion:version,featureId:'outline'}).then(r=>r.feature);
  const edit=async()=>{await (await historyRow(page, 'Rounded detail')).dblclick();await expect(page.getByRole('button',{name:'Cancel sketch edits',exact:true})).toBeVisible();};
  const apply=async()=>{await page.getByRole('button',{name:'Apply',exact:true}).click();await expect(page.getByRole('button',{name:'Apply',exact:true})).toHaveCount(0);};
  const pick=async(id:string,add=false)=>page.locator(`[data-cad-sketch-entity="${id}"]`).press(add?'Shift+Enter':'Enter');
  // Tangent applies to the private draft at once and comes off when pressed again; the radius is edited at its dimension, opened from its tree row.
  const tangent=relationOffer(page,'Tangent'),radius=relationRow(page,'Radius relation');
  await edit();await pick('line');await pick('arc',true);await tangent.click();await expect(tangent).toHaveAttribute('aria-pressed','true');
  await tangent.click();await expect(tangent).toHaveAttribute('aria-pressed','false');expect(await read(base.version)).toEqual(sketch);
  await tangent.click();await expect(tangent).toHaveAttribute('aria-pressed','true');await pick('arc');await openRelationsList(page);await radius.dblclick();
  await page.getByRole('textbox',{name:'Radius mm',exact:true}).fill('-1');await expect(page.getByRole('button',{name:'Apply',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await radius.dblclick();await page.getByRole('textbox',{name:'Radius mm',exact:true}).fill('8');await apply();expect(await read(base.version)).toEqual(sketch);
  await page.getByRole('button',{name:'Finish sketch',exact:true}).click();await expect(page.getByRole('button',{name:'Finish sketch',exact:true})).toHaveCount(0);
  let current=await context(page);const human=await read(current.version),owner=human.graph.relations[1];
  const finalPoints=[...sketch.graph.points.slice(0,2),{id:'c',position:[expect.closeTo(0,10),expect.closeTo(8,10)]},{id:'e',position:[expect.closeTo(8,10),' bendRadius ']},sketch.graph.points[4]];
  expect(human.graph).toEqual({...sketch.graph,points:finalPoints,relations:[sketch.graph.relations[0],{id:expect.any(String),kind:'tangent-joint',endpoints:[{entityId:'line',pointId:'j'},{entityId:'arc',pointId:'j'}]}]});expect(current.parameters).toEqual({bendRadius:8});
  const built=await call(page,'cad_build',{expectedVersion:current.version});expect(built.diagnostics).toEqual([]);expect(built.bodies[0]).toMatchObject({solidCount:1,boundsMm:{min:[-10,expect.closeTo(0,10),0],max:[expect.closeTo(8,10),expect.closeTo(8,10),5]}});expect(built.bodies[0].volumeMm3).toBeCloseTo(400+80*Math.PI,7);
  expect(await call(page,'cad_inspect_sketch_constraints',{expectedVersion:current.version,sketchId:'outline',section:'relations'})).toMatchObject({analysis:{degreesOfFreedom:0}});
  const section=await call(page,'cad_inspect_section',{expectedVersion:current.version,section:{bodyId:'pad',plane:'XY',offset:2.5}});expect(section.contourCount).toBe(1);
  expect(section.entities.items.filter((entity:{type:string})=>entity.type==='line')).toHaveLength(3);expect(section.entities.items.filter((entity:{type:string})=>entity.type==='arc')).toEqual([expect.objectContaining({radius:expect.closeTo(8,10)})]);
  const downloading=page.waitForEvent('download');await call(page,'cad_export_dxf',{expectedVersion:current.version,sketchId:'outline'});const downloaded=await(await downloading).path();if(!downloaded)throw Error('Missing rounded DXF');const dxf=await readFile(downloaded,'utf8');expect(dxf.match(/\nARC\r?\n/g)).toHaveLength(1);expect(dxf.match(/\nLINE\r?\n/g)).toHaveLength(3);
  await edit();await pick('arc');await pick('line',true);await expect(tangent).toHaveAttribute('aria-pressed','true');await tangent.click();await expect(tangent).toHaveAttribute('aria-pressed','false');await page.getByRole('button',{name:'Cancel sketch edits',exact:true}).click();await expect(page.getByRole('button',{name:'Cancel sketch edits',exact:true})).toHaveCount(0);expect(await read(current.version)).toEqual(human);
  await call(page,'cad_history',{expectedVersion:current.version,direction:'undo'});current=await context(page);expect(await read(current.version)).toEqual(sketch);expect(current.parameters).toEqual({bendRadius:5});
  await call(page,'cad_history',{expectedVersion:current.version,direction:'redo'});current=await context(page);expect(await read(current.version)).toEqual(human);
  await call(page,'cad_history',{expectedVersion:current.version,direction:'undo'});current=await context(page);await call(page,'cad_edit_document',{expectedVersion:current.version,edits:[{kind:'set-parameter',name:'bendRadius',value:8},{kind:'set-sketch-relation',sketchId:'outline',relation:owner}]});current=await context(page);const agent=await read(current.version);expect(agent).toEqual({...human,graph:{...human.graph,points:finalPoints}});
  expect((await call(page,'cad_build',{expectedVersion:current.version})).bodies[0].volumeMm3).toBeCloseTo(400+80*Math.PI,7);await call(page,'cad_save_document',{expectedVersion:current.version});await page.reload();await expect(page.getByRole('main',{name:'Parametric CAD workbench'})).toBeVisible();current=await context(page);expect(current.dirty).toBe(false);expect(await read(current.version)).toEqual(agent);
});
