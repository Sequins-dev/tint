import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
function select(present:boolean,state:{n:number}):((n:number)=>number)|undefined {
  state.n++;
  if(!present)return undefined;
  return n=>n+state.n;
}
function argument(state:{n:number}):number{state.n=state.n*10+2;return 30;}
function runVoid(f:(()=>void)|undefined):void{f?.();}
function nested(f:(()=>(()=>number))|undefined):number|undefined{return f?.()();}
function method(o:{f:(n:number)=>number}|undefined,state:{n:number}):number|undefined{return o?.f(argument(state));}
export function run():number{
  const state={n:0};
  if(select(false,state)?.(argument(state))!==undefined||state.n!==1)return 1;
  state.n=0;
  if(select(true,state)?.(argument(state))!==42||state.n!==12)return 2;
  runVoid(undefined);if(state.n!==12)return 3;
  runVoid(()=>{state.n++;});if(state.n!==13)return 4;
  if(nested(undefined)!==undefined||nested(()=>()=>42)!==42)return 5;
  const object:{f:((n:number)=>number)|undefined}={f:undefined};
  state.n=0;if(object.f?.(argument(state))!==undefined||state.n!==0)return 6;
  object.f=n=>n+12;if(object.f?.(30)!==42)return 7;
  const throws:(()=>number)|undefined=()=>{throw 7;};
  try{throws?.();return 8;}catch(error){if(error!==7)return 9;}
  state.n=0;
  if(method(undefined,state)!==undefined||state.n!==0)return 10;
  if(method({f:n=>n+12},state)!==42||state.n!==2)return 11;
  return 42;
}`,
  "calls",
);
