import { verifyHostedFixture } from "./hosted-fixture.ts";

// The continuation is handwritten until generator syntax lowers into native
// suspension frames. This fixture verifies the reusable protocol natively.
verifyHostedFixture(
  `import {createGeneratorRecord,resumeGenerator,resumeYieldDelegate,runGeneratorSteps,type GeneratorStepOutcome,type IteratorHooks,type IteratorRecord,type GeneratorHooks,type GeneratorOutcome,type GeneratorRecord} from "generators";
export function run():number {
 const hooks:GeneratorHooks<number>={undefinedValue:-1,typeError:():number=>-2,iteratorResult:(value:number,done:boolean):number=>value+(done?1000:0)};
 let phase=0,pending=0;
 const generator=createGeneratorRecord<number>((kind:string,value:number):GeneratorOutcome<number> =>{
  phase++;
  if(phase===1){if(value!==-1)throw "first next value";return {kind:"yield",result:19};}
  if(phase===2){if(kind!=="return")throw "injected completion";pending=value;return {kind:"yield",result:23};}
  return {kind:"return",value:pending};
 });
 if(phase!==0)return 1;
 if(resumeGenerator<number>(generator,"next",99,hooks)!==19)return 2;
 if(resumeGenerator<number>(generator,"return",42,hooks)!==23)return 3;
 if(generator.state!=="suspended-yield")return 4;
 if(resumeGenerator<number>(generator,"next",9,hooks)!==1042)return 5;
 if(generator.state!=="completed"||generator.continuation!==undefined)return 6;
 if(resumeGenerator<number>(generator,"next",42,hooks)!==999)return 7;
 if(resumeGenerator<number>(generator,"return",19,hooks)!==1019)return 8;
 let started=0,caught=0;
 const untouched=createGeneratorRecord<number>((kind:string,value:number):GeneratorOutcome<number> =>{started++;return {kind:"return",value};});
 try{resumeGenerator<number>(untouched,"throw",42,hooks);}catch{caught++;}
 if(started!==0||caught!==1||untouched.state!=="completed"||untouched.continuation!==undefined)return 9;
 let reentrant:GeneratorRecord<number>|undefined=undefined;
 const active=createGeneratorRecord<number>((kind:string,value:number):GeneratorOutcome<number> =>{
  const current=reentrant;if(current===undefined)throw "missing generator";
  try{resumeGenerator<number>(current,"return",42,hooks);}catch{caught++;}
  if(current===undefined)throw "missing generator";
  if(current.state!=="executing")throw "reentrant state";
  return {kind:"yield",result:42};
 });
 reentrant=active;
 if(resumeGenerator<number>(active,"next",1,hooks)!==42||caught!==2)return 10;
 if(active.state!=="suspended-yield")return 11;
 const failing=createGeneratorRecord<number>((kind:string,value:number):GeneratorOutcome<number> =>{throw "body failure";});
 try{resumeGenerator<number>(failing,"next",1,hooks);}catch{caught++;}
 if(caught!==3||failing.state!=="completed"||failing.continuation!==undefined)return 12;
 let delegatePhase=0,closeCalls=0;
 const iteratorHooks:IteratorHooks<number>={
  undefinedValue:-1,
  get:(object:number,key:string):number=>{
   if(object===10){if(key==="return")return 12;return -1;}
   if(key==="done")return object===21?1:0;
   if(key==="value")return 42;
   throw "unexpected get";
  },
  call:(method:number,receiver:number,args:readonly number[]):number=>{
   if(receiver!==10)throw "delegate receiver";
   if(method===12){if(args.length===0){closeCalls++;return 21;}return 20;}
   if(method!==11||args.length!==1)throw "delegate method";
   delegatePhase++;if(delegatePhase===1){if(args[0]!==-1)throw "delegate first argument";return 20;}
   if(args[0]!==42)throw "delegate resumed argument";return 21;
  },
  isObject:(value:number):boolean=>value>=20,
  isCallable:(value:number):boolean=>value===11||value===12,
  isNullish:(value:number):boolean=>value===-1,
  truthy:(value:number):boolean=>value!==0,
  typeError:():number=>-2
 };
 const delegate:IteratorRecord<number>={iterator:10,nextMethod:11,done:false};
 const first=resumeYieldDelegate<number>(delegate,"next",-1,iteratorHooks);
 if(first.kind!=="yield"||first.result!==20)return 13;
 const returned=resumeYieldDelegate<number>(delegate,"return",19,iteratorHooks);
 if(returned.kind!=="yield"||returned.result!==20)return 14;
 const last=resumeYieldDelegate<number>(delegate,"next",42,iteratorHooks);
 if(last.kind!=="normal"||last.value!==42)return 15;
 try{resumeYieldDelegate<number>(delegate,"throw",99,iteratorHooks);return 16;}catch{caught++;}
 if(caught!==4||closeCalls!==1)return 17;
 let steps=0;
 function advance(kind:string,value:number):GeneratorStepOutcome<number>{
  if(kind!=="next")throw "transfer kind";
  steps++;if(steps===100000)return {kind:"return",value};
  return {kind:"transfer",next:advance,inputKind:"next",value:value+1};
 }
 const transferred=runGeneratorSteps<number>(advance("next",1));
 if(transferred.kind!=="return"||transferred.value!==100000||steps!==100000)return 18;
 let innerCaught=false;
 function destination(kind:string,value:number):GeneratorStepOutcome<number>{throw value;}
 function protectedStep(kind:string,value:number):GeneratorStepOutcome<number>{
  try{return {kind:"transfer",next:destination,inputKind:"throw",value};}
  catch{innerCaught=true;return {kind:"return",value:0};}
 }
 try{runGeneratorSteps<number>(protectedStep("next",42));return 19;}catch{caught++;}
 if(innerCaught||caught!==5)return 20;
 return 42;
}`,
  "generator-protocol",
  [["generators", "packages/js-runtime/src/iterators/index.ts"]],
);
