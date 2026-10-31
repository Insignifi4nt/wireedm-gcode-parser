import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import type { CadDocument } from '@/domain/cad/cadDocument';
import { applyCadEdits, type CadEdit } from '@/domain/cad/cadOperations';
import { CadSketchPlacementEditor, type CadSketchPlacementInteraction } from './CadSketchPlacementEditor';
let container:HTMLDivElement,root:Root;
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers();vi.unstubAllGlobals();});
function deferred<T>(){let resolve:(value:T)=>void=()=>{throw Error('Missing deferred');};const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};}
function button(label:string){const e=[...container.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')===label||e.textContent?.trim()===label);if(!e)throw Error(`Missing ${label}`);return e;}
async function input(label:string,value:string){const e=container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);if(!e)throw Error(`Missing ${label}`);await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));});}
async function harness(prepare?:ComponentProps<typeof CadSketchPlacementEditor>['onPrepareEdits']){
 const source=parseCadDocument({...createCadDocument('D detail'),schemaVersion:2,features:[{id:'detail',kind:'sketch',name:'Detail',suppressed:false,plane:'XY',offset:0,profiles:[],graph:{points:[{id:'a',position:[-8,6]},{id:'b',position:[8,6]},{id:'c',position:[0,0]}],entities:[{id:'arc',kind:'arc',centerPointId:'c',startPointId:'a',endPointId:'b',direction:'ccw',construction:false},{id:'chord',kind:'line',startPointId:'b',endPointId:'a',construction:false}],relations:[]}}]});const sketch=source.features[0];if(sketch.kind!=='sketch')throw Error('Missing fixture');
 const completion=deferred<void>(),edit=vi.fn((_edits:readonly CadEdit[],_signal?:AbortSignal)=>completion.promise),preview=vi.fn(),interaction=vi.fn<(i:CadSketchPlacementInteraction|null)=>void>(),cancelled=vi.fn(),accepted=vi.fn();
 let props:ComponentProps<typeof CadSketchPlacementEditor>={document:source,documentVersion:'one',sketch,selections:[{kind:'entity',id:'arc'},{kind:'entity',id:'chord'}],interactionLocked:false,onEditMany:edit,onPrepareEdits:prepare??(async edits=>applyCadEdits(source,edits)),onPreviewDocument:preview,onInteractionChange:interaction,onPendingChange:vi.fn(),onCancel:cancelled,onAccepted:accepted};
 const render=async(next:Partial<typeof props>={})=>{props={...props,...next};await act(async()=>root.render(<CadSketchPlacementEditor {...props}/>));};
 const offered=()=>{const i=interaction.mock.calls.at(-1)?.[0];if(!i?.positionPick)throw Error('No position picker');return i;};
 const pick=async(p:readonly[number,number])=>{await act(async()=>offered().positionPick!.onPick(p));await act(async()=>vi.advanceTimersByTimeAsync(100));};await render();return{source,sketch,edit,completion,preview,interaction,cancelled,accepted,render,offered,pick};
}
it('owns two positions, aborts old preview on repick and accepts only its exact successful publication',async()=>{
 const requests:{edits:readonly CadEdit[];signal:AbortSignal;result:ReturnType<typeof deferred<CadDocument>>}[]=[];
 const h=await harness((edits,signal)=>{const result=deferred<CadDocument>();requests.push({edits,signal,result});return result.promise;});
 expect(h.offered().geometryPick?.eligiblePointIds).toEqual(['@origin','a','b','c']);await act(async()=>h.offered().geometryPick!.onPick({kind:'point',id:'c'}));await h.pick([30,20]);await input('Rotation','90');await act(async()=>vi.advanceTimersByTimeAsync(100));
 expect(requests.at(-1)?.edits).toEqual([{kind:'place-sketch-geometry',sketchId:'detail',selections:[{kind:'entity',id:'arc'},{kind:'entity',id:'chord'}],anchor:[0,0],target:[30,20],angleDegrees:90}]);
 const old=requests.at(-1)!;await act(async()=>button('Choose target').click());expect(old.signal.aborted).toBe(true);expect(h.preview).toHaveBeenLastCalledWith(null, null);
 await act(async()=>old.result.resolve(applyCadEdits(h.source,old.edits)));expect(h.preview).toHaveBeenLastCalledWith(null, null);expect(h.edit).not.toHaveBeenCalled();
 await h.pick([40,20]);const last=requests.at(-1)!,candidate=applyCadEdits(h.source,last.edits);await act(async()=>last.result.resolve(candidate));expect(button('Apply').disabled).toBe(false);
 await act(async()=>button('Apply').click());expect(h.edit).toHaveBeenCalledExactlyOnceWith(last.edits,expect.any(AbortSignal));const sketch=candidate.features[0];if(sketch.kind!=='sketch')throw Error('Missing candidate');await h.render({document:candidate,documentVersion:'two',sketch});expect(h.cancelled).not.toHaveBeenCalled();await act(async()=>h.completion.resolve(undefined));expect(h.accepted).toHaveBeenCalledOnce();
});
it('takes the origin as an exact anchor or target, like a sketch point',async()=>{
 const h=await harness();expect(h.offered().geometryPick?.eligiblePointIds).toContain('@origin');expect(h.offered().geometryPick?.eligibleEntityIds).toEqual([]);
 const origin={kind:'point',id:'@origin'} as const;await act(async()=>h.offered().geometryPick!.onPick(origin));await act(async()=>h.offered().geometryPick!.onPick(origin));expect(h.interaction.mock.calls.at(-1)?.[0]?.geometryPick).toBeUndefined();
 await input('Rotation','90');await act(async()=>vi.advanceTimersByTimeAsync(100));await act(async()=>button('Apply').click());
 expect(h.edit.mock.calls[0]?.[0]).toEqual([{kind:'place-sketch-geometry',sketchId:'detail',selections:[{kind:'entity',id:'arc'},{kind:'entity',id:'chord'}],anchor:[0,0],target:[0,0],angleDegrees:90}]);
});
it('aborts Apply and ignores stale position callbacks after a foreign source/version change',async()=>{
 const h=await harness();const old=h.offered().positionPick!;await h.pick([0,0]);await h.pick([30,20]);await input('Rotation','90');await act(async()=>vi.advanceTimersByTimeAsync(100));await act(async()=>button('Apply').click());const signal=h.edit.mock.calls[0]?.[1];if(!signal)throw Error('Missing Apply signal');await h.render({document:{...h.source,name:'Elsewhere'},documentVersion:'two'});expect(signal.aborted).toBe(true);expect(h.cancelled).toHaveBeenCalledOnce();await act(async()=>old.onPick([99,99]));await act(async()=>h.completion.resolve(undefined));expect(h.accepted).not.toHaveBeenCalled();
});
it('supports a stationary picked pivot and finite typed fields without creating an implicit joint',async()=>{
 const h=await harness();await h.pick([0,0]);await act(async()=>button('Rotate at anchor').click());await input('Rotation','90');await act(async()=>vi.advanceTimersByTimeAsync(100));expect(button('Apply').disabled).toBe(false);await input('Target X','');expect(button('Apply').disabled).toBe(true);await input('Target X','30');await input('Target Y','20');await act(async()=>vi.advanceTimersByTimeAsync(100));await act(async()=>button('Apply').click());expect(h.edit.mock.calls[0]?.[0]).toEqual([{kind:'place-sketch-geometry',sketchId:'detail',selections:[{kind:'entity',id:'arc'},{kind:'entity',id:'chord'}],anchor:[0,0],target:[30,20],angleDegrees:90}]);expect(h.source.features[0]).toEqual(h.sketch);
});
