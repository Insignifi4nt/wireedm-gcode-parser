import { expect, test } from './fixtures/native-sketch-solver';
import { prepareCadTools, callCadTool as call, cadContext as context, historyRow, relationControl } from './cad-tool-helpers';

test('persists passive dimensions through private sketch Finish and converts a diameter without losing exact geometry or Undo',async({page})=>{
  await prepareCadTools(page);await call(page,'cad_open_workspace');
  const sketch={id:'plate',kind:'sketch',name:'Measured plate',suppressed:false,plane:'XY',offset:0,profiles:[],graph:{
    points:[{id:'a',position:[' 0.00 ','0']},{id:'b',position:[' width ','0']},{id:'c',position:[' width ','20']},{id:'d',position:['0','20']},{id:'o',position:['10','10']}],
    entities:[{id:'ab',kind:'line',startPointId:'a',endPointId:'b',construction:false},{id:'bc',kind:'line',startPointId:'b',endPointId:'c',construction:false},
      {id:'cd',kind:'line',startPointId:'c',endPointId:'d',construction:false},{id:'da',kind:'line',startPointId:'d',endPointId:'a',construction:false},
      {id:'bore',kind:'circle',centerPointId:'o',radius:3,construction:false}],relations:[]}};
  await call(page,'cad_edit_document',{expectedVersion:(await context(page)).version,edits:[{kind:'set-parameter',name:'width',value:40},
    {kind:'add-feature',feature:sketch},{kind:'add-feature',feature:{id:'pad',kind:'extrude',name:'Thickness',suppressed:false,sketchId:'plate',distance:' 5e0 ',symmetric:false,operation:'new',targetId:null}}]});
  const base=await context(page);await call(page,'cad_build',{expectedVersion:base.version});
  const edit=async()=>{await (await historyRow(page, 'Measured plate')).dblclick();await expect(page.getByRole('button',{name:'Cancel sketch edits',exact:true})).toBeVisible();};
  const apply=async()=>{await page.getByRole('button',{name:'Apply',exact:true}).click();await expect(page.getByRole('button',{name:'Apply',exact:true})).toHaveCount(0);};
  const finish=async()=>{await page.getByRole('button',{name:'Finish sketch',exact:true}).click();await expect(page.getByRole('button',{name:'Finish sketch',exact:true})).toHaveCount(0);};
  await edit();await page.getByRole('button',{name:'Point 1 in Measured plate',exact:true}).press('Enter');
  await page.getByRole('button',{name:'Point 3 in Measured plate',exact:true}).press('Shift+Enter');
  await (await relationControl(page, 'button', 'Reference distance')).click();await apply();
  await page.locator('[data-cad-sketch-entity="bore"]').press('Enter');await (await relationControl(page, 'button', 'Reference diameter')).click();await apply();
  expect((await call(page,'cad_get_feature',{expectedVersion:base.version,featureId:'plate'})).feature).toEqual(sketch);
  await finish();let current=await context(page);
  const measured=(await call(page,'cad_get_feature',{expectedVersion:current.version,featureId:'plate'})).feature;
  expect(measured).toMatchObject({graph:{points:sketch.graph.points,entities:sketch.graph.entities,relations:[
    expect.objectContaining({kind:'reference-dimension',measurement:{kind:'point-distance',pointIds:['a','c']}}),
    expect.objectContaining({kind:'reference-dimension',measurement:{kind:'radial-size',entityId:'bore',quantity:'diameter'}})]}});
  await call(page,'cad_edit_document',{expectedVersion:current.version,edits:[{kind:'set-parameter',name:'width',value:60}]});current=await context(page);
  await edit();await expect(page.getByRole('button',{name:'Reference dimension distance 63.245553 mm, press Enter to edit',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Reference dimension diameter 6 mm, press Enter to edit',exact:true}).dblclick();
  await page.getByRole('button',{name:'Make driving',exact:true}).click();await page.getByRole('textbox',{name:'Diameter mm',exact:true}).fill('8');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  expect((await call(page,'cad_get_feature',{expectedVersion:current.version,featureId:'plate'})).feature).toEqual(measured);
  await page.getByRole('button',{name:'Reference dimension diameter 6 mm, press Enter to edit',exact:true}).dblclick();await page.getByRole('button',{name:'Make driving',exact:true}).click();
  await page.getByRole('textbox',{name:'Diameter mm',exact:true}).fill('8');await apply();await finish();current=await context(page);
  const driven=(await call(page,'cad_get_feature',{expectedVersion:current.version,featureId:'plate'})).feature;
  expect(driven).toMatchObject({graph:{points:sketch.graph.points,entities:[...sketch.graph.entities.slice(0,4),{...sketch.graph.entities[4],radius:4}],relations:[
    measured.graph.relations[0],{id:measured.graph.relations[1].id,kind:'radial-size',entityId:'bore',quantity:'diameter',value:8}]}});
  const built=await call(page,'cad_build',{expectedVersion:current.version});expect(built.diagnostics).toEqual([]);expect(built.bodies[0].volumeMm3).toBeCloseTo((1200-16*Math.PI)*5,6);
  await call(page,'cad_history',{expectedVersion:current.version,direction:'undo'});current=await context(page);
  expect((await call(page,'cad_get_feature',{expectedVersion:current.version,featureId:'plate'})).feature).toEqual(measured);
  await call(page,'cad_history',{expectedVersion:current.version,direction:'redo'});current=await context(page);
  await call(page,'cad_save_document',{expectedVersion:current.version});await page.reload();await expect(page.getByRole('main',{name:'Parametric CAD workbench'})).toBeVisible();current=await context(page);
  expect((await call(page,'cad_get_feature',{expectedVersion:current.version,featureId:'plate'})).feature).toEqual(driven);expect(current.dirty).toBe(false);
});
