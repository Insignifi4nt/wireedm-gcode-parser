import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Value } from '@sinclair/typebox/value';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CloseIcon, ConfirmIcon } from '@wire-edm/icons-react';
import type { CadDocument, CadSketchFeature } from '@/domain/cad/cadDocument';
import type { CadEdit } from '@/domain/cad/cadOperations';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';
import type { CadSketchGraphSelection } from '@/domain/cad/cadSketchGraphSelection';
import type { CadSketchGraphControls } from './CadSketchGraphLayer';
import type { SketchPoint } from './cadSketchInteraction';
import { CadContextHelp } from './CadContextHelp';
import { useCadPreparedPreview, type CadPrepareEdits } from './useCadPreparedPreview';
import { useCadEditSubmission, type CadEditCompletion } from './useCadEditSubmission';
export interface CadSketchPlacementInteraction {
  readonly positionPick?: CadSketchGraphControls['positionPick'];
  readonly geometryPick?: CadSketchGraphControls['geometryPick'];
  readonly placement: NonNullable<CadSketchGraphControls['placement']>;
}
interface Props {
  document:CadDocument; documentVersion:string; sketch:CadSketchFeature; selections:readonly CadSketchGraphSelection[];
  interactionLocked:boolean;
  onEditMany(edits:readonly CadEdit[],signal?:AbortSignal):CadEditCompletion;
  onPrepareEdits?:CadPrepareEdits;
  onPreviewDocument(document:CadDocument|null):void;
  onPendingChange(pending:boolean):void;
  onInteractionChange(interaction:CadSketchPlacementInteraction|null):void;
  onCancel():void; onAccepted():void;
}
type Pair=readonly[string,string];
const position=(values:Pair):SketchPoint|null=>values.every(v=>v.trim()!==''&&Number.isFinite(Number(v))&&Math.abs(Number(v))<=1e9)?[Number(values[0]),Number(values[1])]:null;
/** A frozen selection, two borrowed positions, and one exact whole-detail preview. */
export function CadSketchPlacementEditor(props:Props){
 const [owner]=useState(()=>({document:props.document,version:props.documentVersion,sketch:props.sketch,selections:props.selections}));
 const [anchorText,setAnchor]=useState<Pair>(['','']),[targetText,setTarget]=useState<Pair>(['','']),[angleText,setAngle]=useState('0');
 const [picking,setPicking]=useState<'anchor'|'target'|null>('anchor'),[error,setError]=useState<string|null>(null);
 const pickOwner=useRef<object|null>(null);
 const submission=useCadEditSubmission(),ended=useRef(false),submitted=useRef<CadDocument|null>(null);
 const callbacks=useRef({...props,applying:submission.applying});callbacks.current={...props,applying:submission.applying};
 const sourceCurrent=props.document===owner.document&&props.documentVersion===owner.version;
 const ownPublication=submission.applying&&submitted.current!==null&&Value.Equal(props.document,submitted.current);
 const current=()=>!ended.current&&!callbacks.current.applying&&!callbacks.current.interactionLocked&&callbacks.current.document===owner.document&&callbacks.current.documentVersion===owner.version;
 const cancel=useCallback(()=>{if(!ended.current){ended.current=true;submission.cancel();callbacks.current.onCancel();}},[submission.cancel]);
 useLayoutEffect(()=>{if(props.interactionLocked||!sourceCurrent&&!ownPublication)cancel();},[props.interactionLocked,sourceCurrent,ownPublication,cancel]);
 useLayoutEffect(()=>{callbacks.current.onPendingChange(true);return()=>{callbacks.current.onInteractionChange(null);callbacks.current.onPendingChange(false);callbacks.current.onPreviewDocument(null);};},[]);
 const anchor=useMemo(()=>position(anchorText),[anchorText]),target=useMemo(()=>position(targetText),[targetText]);
 const angle=Number(angleText),angleValid=angleText.trim()!==''&&Number.isFinite(angle)&&Math.abs(angle)<=1e9;
 const pick=useMemo(()=>{const token={};return picking&&sourceCurrent&&!props.interactionLocked&&!submission.applying?{token,
   label:picking==='anchor'?'Choose the detail anchor':'Place the anchor',onCancel:cancel,onPick:(point:SketchPoint)=>{
    if(pickOwner.current!==token||!current()||!point.every(v=>Number.isFinite(v)&&Math.abs(v)<=1e9))return;
    props.onPreviewDocument(null);setError(null);const text:Pair=[String(point[0]),String(point[1])];
    if(picking==='anchor'){setAnchor(text);setPicking('target');}else{setTarget(text);setPicking(null);}
   }}:undefined;},[picking,sourceCurrent,props.interactionLocked,submission.applying,owner,cancel,props.onPreviewDocument]);
 pickOwner.current=pick?.token??null;
 const geometryPick=useMemo(()=>pick?{label:pick.label,eligibleEntityIds:[],eligiblePointIds:owner.sketch.graph?.points.map(p=>p.id)??[],onCancel:cancel,onPick:(selection:CadSketchGraphSelection)=>{
   if(selection.kind!=='point')return;const point=owner.sketch.graph?.points.find(p=>p.id===selection.id);if(point)pick.onPick([evaluateCadScalar(point.position[0],owner.document.parameters),evaluateCadScalar(point.position[1],owner.document.parameters)]);
 }}:undefined,[pick,owner,cancel]);
 const interaction=useMemo<CadSketchPlacementInteraction|null>(()=>sourceCurrent&&!props.interactionLocked&&!submission.applying?{positionPick:pick,geometryPick,placement:{anchor,target,angleDegrees:angleValid?angle:0}}:null,[sourceCurrent,props.interactionLocked,submission.applying,pick,geometryPick,anchor,target,angleValid,angle]);
 useLayoutEffect(()=>props.onInteractionChange(interaction),[interaction,props.onInteractionChange]);
 const edits=useMemo<readonly CadEdit[]|null>(()=>picking||!anchor||!target||!angleValid?null:[{kind:'place-sketch-geometry',sketchId:owner.sketch.id,selections:owner.selections,anchor,target,angleDegrees:angle}],[picking,anchor,target,angleValid,angle,owner]);
 const prepared=useCadPreparedPreview(owner.document,edits,props.onPrepareEdits,sourceCurrent&&!props.interactionLocked&&!submission.applying);
 const changed=prepared.kind==='ready'&&!Value.Equal(prepared.document,owner.document);
 useLayoutEffect(()=>props.onPreviewDocument(prepared.kind==='ready'?prepared.document:null),[prepared,props.onPreviewDocument]);
 const repick=(which:'anchor'|'target')=>{if(!current())return;props.onPreviewDocument(null);setError(null);setPicking(which);};
 const issue=error??(prepared.kind==='error'?prepared.message:null);
 return <form className="cad-property-form cad-sketch-profile-panel" aria-label="Place and rotate" aria-busy={submission.applying||undefined} onKeyDown={event=>{if(event.key==='Escape'&&!event.nativeEvent.isComposing){event.preventDefault();event.stopPropagation();cancel();}}} onSubmit={event=>{
  event.preventDefault();if(!current()||!edits||prepared.kind!=='ready'||!changed)return;submitted.current=prepared.document;
  submission.submit(signal=>props.onEditMany(edits,signal),()=>{if(!ended.current){ended.current=true;callbacks.current.onAccepted();}},cause=>{submitted.current=null;setError(cause instanceof Error?cause.message:'The detail could not be placed.');});
 }}>
 <div className="cad-sketch-profile-heading"><strong>Place and rotate</strong><CadContextHelp label="Place and rotate">Choose a point on the detail, then where it should go. Rotation is counterclockwise in the sketch plane. Positions are used once; no joint or constraint is added. Existing formulas and constraints stay in force.</CadContextHelp></div>
 {(['anchor','target']as const).map(which=>{const values=which==='anchor'?anchorText:targetText,set=which==='anchor'?setAnchor:setTarget,label=which==='anchor'?'Anchor':'Target';return <div key={which}>
  <div className="cad-sketch-profile-actions"><span>{label}</span><Button type="button" aria-label={`Choose ${which}`} aria-pressed={picking===which} disabled={props.interactionLocked||submission.applying} onClick={()=>repick(which)}>Pick in sketch</Button></div>
  <div className="cad-placement-row">{([0,1]as const).map(axis=><label key={axis}><span>{axis?'Y':'X'}</span><Input aria-label={`${label} ${axis?'Y':'X'}`} inputMode="decimal" value={values[axis]} disabled={props.interactionLocked||submission.applying} onChange={event=>{if(!current())return;props.onPreviewDocument(null);setError(null);set(whichValues=>axis?[whichValues[0],event.target.value]:[event.target.value,whichValues[1]]);setPicking(null);}}/></label>)}<small>mm</small></div>
 </div>;})}
 <label className="cad-field"><span>Rotation</span><span>°</span><Input aria-label="Rotation" inputMode="decimal" value={angleText} disabled={props.interactionLocked||submission.applying} onChange={event=>{setError(null);setAngle(event.target.value);}}/></label>
 <Button type="button" disabled={!anchor||props.interactionLocked||submission.applying} onClick={()=>{if(!current()||!anchor)return;props.onPreviewDocument(null);setTarget(anchorText);setPicking(null);setError(null);}}>Rotate at anchor</Button>
 {picking&&<div role="status">{pick?.label}</div>}{prepared.kind==='waiting'&&<div role="status">Preparing preview…</div>}{issue&&<p className="cad-error" role="alert">{issue}</p>}
 <div className="cad-form-actions"><Button type="button" onClick={cancel}><CloseIcon size={13}/> Cancel</Button><Button variant="primary" type="submit" disabled={!current()||!edits||prepared.kind!=='ready'||!changed}><ConfirmIcon size={13}/> Apply</Button></div>
 </form>;
}
