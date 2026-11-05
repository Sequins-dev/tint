import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createThisBinding,bindThisValue,getThisBinding,createDeclarativeEnvironment,hasBinding,createMutableBinding,createImmutableBinding,initializeBinding,getBindingValue,setMutableBinding,deleteBinding} from "environment";
export function run():number{
 const record=createDeclarativeEnvironment<number>(0);
 createMutableBinding<number>(record,"x",false);
 if(!hasBinding<number>(record,"x"))return 1;
 if(getBindingValue<number>(record,"x").error!=="reference")return 2;
 if(setMutableBinding<number>(record,"x",9,false)!=="reference")return 3;
 initializeBinding<number>(record,"x",0);
 if(getBindingValue<number>(record,"x").error!=="none")return 4;
 if(setMutableBinding<number>(record,"x",42,true)!=="none")return 5;
 if(getBindingValue<number>(record,"x").value!==42||deleteBinding<number>(record,"x"))return 6;
 createImmutableBinding<number>(record,"constant",true);
 initializeBinding<number>(record,"constant",8);
 if(setMutableBinding<number>(record,"constant",9,false)!=="type"||getBindingValue<number>(record,"constant").value!==8)return 7;
 createImmutableBinding<number>(record,"silent",false);
 initializeBinding<number>(record,"silent",7);
 if(setMutableBinding<number>(record,"silent",9,false)!=="none"||getBindingValue<number>(record,"silent").value!==7)return 8;
 if(setMutableBinding<number>(record,"silent",9,true)!=="type")return 9;
 if(setMutableBinding<number>(record,"missing",9,true)!=="reference"||hasBinding<number>(record,"missing"))return 10;
 if(setMutableBinding<number>(record,"missing",9,false)!=="none")return 11;
 if(!deleteBinding<number>(record,"missing")||hasBinding<number>(record,"missing"))return 12;
 const receiver=createThisBinding<number>(0);
 const read=():number=>getThisBinding<number>(receiver).error==="reference"?-1:getThisBinding<number>(receiver).value;
 if(read()!==-1)return 13;
 if(bindThisValue<number>(receiver,0)!=="none"||read()!==0)return 14;
 if(bindThisValue<number>(receiver,42)!=="reference"||read()!==0)return 15;
 const second=createThisBinding<number>(0);
 if(getThisBinding<number>(second).error!=="reference")return 16;
 if(bindThisValue<number>(second,42)!=="none"||getThisBinding<number>(second).value!==42)return 17;
 return 42;
}`,
  "environment-record",
  [["environment", "packages/js-runtime/src/environments/records/index.ts"]],
);
