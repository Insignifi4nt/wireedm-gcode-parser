import { createUpidFromDxfEntities } from '../../src/domain/upid/upidDocument';
import { compileWireEdmExecutionPlan } from '../../src/domain/execution-plan/executionPlan';
import { classifyPositioningMaterial } from '../../src/domain/path-intel/positioningMaterial';
import { minimalPostPackage } from '../../src/domain/post-processor/__tests__/postPackageFixture';
import { runCustomPost } from '../../src/domain/post-processor/custom-runtime/customPostRuntime';
import { CANONICAL_POST_PLAN_FIXTURES } from '../../src/domain/post-processor/custom-runtime/canonicalPostConformanceFixtures';
import { preflightPostCapabilities } from '../../src/domain/post-processor/postCapabilityPreflight';
import robofil from '../../examples/robofil-100-v2/cristian-robofil-100-v2.wireedm-post.json';

const circles = createUpidFromDxfEntities([
  {type:'circle', layer:'CUT', center:{x:0,y:0}, radius:5},
  {type:'circle', layer:'CUT', center:{x:0,y:0}, radius:70.5},
]);
circles.setup = { initialWirePosition: {kind:'manual',point:{x:0,y:0},review:'reviewed'}, threadingDefault:{mode:'manual',wireSeparation:'already-separated'}};
record('already-separated-crossing', JSON.stringify(compileWireEdmExecutionPlan(circles)));

const circle = createUpidFromDxfEntities([{type:'circle',layer:'CUT',center:{x:0,y:0},radius:100}]);
const poly = circle.contours[0].approximatePolygon;
const angle = (Math.atan2(poly[0].y,poly[0].x)+Math.atan2(poly[1].y,poly[1].x))/2;
const middle={x:99.9999*Math.cos(angle),y:99.9999*Math.sin(angle)};
const from={x:middle.x-0.001*Math.sin(angle),y:middle.y+0.001*Math.cos(angle)};
const to={x:middle.x+0.001*Math.sin(angle),y:middle.y-0.001*Math.cos(angle)};
record('exact-circle-interior',JSON.stringify({from,to,radiusFrom:Math.hypot(from.x,from.y),radiusTo:Math.hypot(to.x,to.y),result:classifyPositioningMaterial(circle,from,to)}));

const line=createUpidFromDxfEntities([{type:'line',layer:'CUT',start:{x:0,y:0},end:{x:10,y:0}}]);
line.setup={initialWirePosition:{kind:'manual',point:{x:-2,y:0},review:'reviewed'}};
const compiled=compileWireEdmExecutionPlan(line);
if(!compiled.ok) throw new Error(JSON.stringify(compiled));
const mixed=minimalPostPackage();
mixed.dialect.commands['motion.rapid']=structuredClone(mixed.dialect.commands['motion.linear']);
for(const parameter of Object.values(mixed.dialect.commands['motion.rapid'].parameters)) if(parameter.type==='number') parameter.format.fractionDigits={kind:'fixed',value:0};
mixed.source.code=mixed.source.code.replace("if (event.kind === 'position') return api.emitMotion('motion.linear'", "if (event.kind === 'position') return api.emitMotion('motion.rapid'").replace('y: event.end.y','y: event.end.y + 0.1');
const mixedResult=await runCustomPost({package:mixed,plan:compiled.plan,properties:{coordinatePrecision:3}});
record('mixed-precision-wrong-fine-cut',JSON.stringify(mixedResult));

const compensation=minimalPostPackage();
compensation.manifest.capabilities.controllerCompensation='left-right';
compensation.manifest.execution.compensationLifecycle='controller-native-continuous';
compensation.dialect.commands['distance.absolute'].template='G90 G40';
compensation.dialect.commands['distance.absolute'].effects.push('compensation.off');
const compPlan=CANONICAL_POST_PLAN_FIXTURES['core.single-compensated-direct.v1'];
if(compPlan) record('consumed-compensation',JSON.stringify(await runCustomPost({package:compensation,plan:compPlan,properties:{coordinatePrecision:3}})));

const manual=structuredClone(CANONICAL_POST_PLAN_FIXTURES['core.multi-compensated-manual.v1']);
if(manual) {
record('robofil-manual-preflight',JSON.stringify(preflightPostCapabilities(manual,robofil as any)));
record('robofil-manual-run',JSON.stringify(await runCustomPost({package:robofil as any,plan:manual,properties:{coordinatePrecision:3,offsetIndex:0}})));
}

circle.setup={initialWirePosition:{kind:'manual',point:{x:100,y:0},review:'reviewed'}};
const fresh=compileWireEdmExecutionPlan(circle);
record('fresh-finished-contour-no-intent',JSON.stringify({basis:circle.geometryBasis,intent:circle.plan.operations[0].compensationIntent,ok:fresh.ok,...(fresh.ok?{requirements:fresh.plan.requirements}:{diagnostics:fresh.diagnostics})}));
compensation.manifest.execution.compensationRequiredForEveryOperation=true;
record('required-compensation-ignored',JSON.stringify({preflight:preflightPostCapabilities(compiled.plan,compensation),run:await runCustomPost({package:compensation,plan:compiled.plan,properties:{coordinatePrecision:3}})}));


function record(probe: string, serialized: string) { console.log(JSON.stringify({ probe, result: JSON.parse(serialized) })); }

