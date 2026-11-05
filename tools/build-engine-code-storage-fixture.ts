import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `import {createEngineCodeStorage} from "storage";
export function run():number {
 const state={maps:0,registrations:0,writes:0,last:-1,fail:false};
 const host={domain:():number=>17,map:(length:number):number=>{state.maps++;return 4096;},register:(address:number,length:number):number=>{state.registrations++;return address===4096?0:-1;},write:(address:number,capacity:number,offset:number,bytes:Uint8Array):number=>{state.writes++;state.last=offset;return state.fail?-1:0;}};
 const storage=createEngineCodeStorage(host,64);
 if(state.maps!==0)return 1;
 if(storage.publish(new Uint8Array(4))!==4096)return 2;
 state.fail=true;if(storage.publish(new Uint8Array(4))!==undefined)return 3;
 state.fail=false;if(storage.publish(new Uint8Array(4))!==4128||state.last!==32)return 4;
 if(state.maps!==1||state.registrations!==1||state.writes!==3)return 5;
 if(storage.publish(new Uint8Array(33))!==undefined||state.writes!==3)return 6;
 const failed={calls:0};const denied=createEngineCodeStorage({domain:():number=>17,map:(length:number):number=>{failed.calls++;return -1;},register:(address:number,length:number):number=>{throw "REGISTER";},write:(address:number,capacity:number,offset:number,bytes:Uint8Array):number=>{throw "WRITE";}},64);
 if(denied.publish(new Uint8Array(4))!==undefined||denied.publish(new Uint8Array(4))!==undefined||failed.calls!==1)return 7;
 return 42;
}`,
  "engine-code-storage",
  [["storage", "packages/js-engine/src/native/code-storage.ts"]],
);
