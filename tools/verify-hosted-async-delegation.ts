import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `import {createAsyncYieldDelegate,type IteratorHooks,type IteratorRecord} from "iterators";
export function run():number {
 let done=false,mode=0,calls=0,arity=0;
 const hooks:IteratorHooks<number>={
  undefinedValue:0,
  get:(object:number,key:string):number=>{
   if(object===1){if(key==="return")return mode===1?0:3;if(key==="throw")return mode===2?4:0;throw 90;}
   if(object!==10)throw 91;
   if(key==="done")return done?1:0;
   if(key==="value")return 42;
   throw 92;
  },
  call:(method:number,receiver:number,args:readonly number[]):number=>{
   if(receiver!==1)throw 93;calls++;arity=args.length;return 10;
  },
  isObject:(value:number):boolean=>value===10,
  isCallable:(value:number):boolean=>value>=2&&value<=4,
  isNullish:(value:number):boolean=>value===0,
  truthy:(value:number):boolean=>value!==0,
  typeError:():number=>99
 };
 const record:IteratorRecord<number>={iterator:1,nextMethod:2,done:false};
 const step=createAsyncYieldDelegate<number>(record,hooks);
 const a=step("next",0);if(a.kind!=="await"||a.value!==10||arity!==1)return 1;
 const b=step("next",10);if(b.kind!=="yield"||b.value!==42)return 2;
 step("next",19);done=true;
 const d=step("next",10);if(d.kind!=="normal"||d.value!==42)return 4;
 const returning=createAsyncYieldDelegate<number>(record,hooks);
 returning("return",19);const e=returning("next",10);if(e.kind!=="return"||e.value!==42)return 5;
 const closing=createAsyncYieldDelegate<number>(record,hooks);
 closing("throw",19);if(arity!==0)return 6;
 let error=0;try{closing("next",10);}catch(x){if(typeof x==="number")error=x;else throw x;}
 if(error!==99)return 7;
 mode=1;const missing=createAsyncYieldDelegate<number>(record,hooks);
 const f=missing("return",19);if(f.kind!=="await"||f.value!==19)return 8;
 const g=missing("next",42);if(g.kind!=="return"||g.value!==42)return 9;
 mode=2;done=false;const rejecting=createAsyncYieldDelegate<number>(record,hooks);
 rejecting("next",0);rejecting("next",10);const h=rejecting("throw",19);
 if(h.kind!=="await"||h.value!==10)return 10;
 done=true;const i=rejecting("next",10);if(i.kind!=="normal"||i.value!==42)return 11;
 return 42;
}`,
  "async-delegation-protocol",
  [["iterators", "packages/js-runtime/src/iterators/index.ts"]],
);
