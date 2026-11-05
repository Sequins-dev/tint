import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createDeclarativeEnvironment,createMutableBinding,createImmutableBinding,createImportBinding,initializeBinding,getBindingValue,setMutableBinding,deleteBinding,type DeclarativeEnvironment} from "records";
function retainedImport():DeclarativeEnvironment<string>{
 const source=createDeclarativeEnvironment<string>(""),a=createDeclarativeEnvironment<string>(""),b=createDeclarativeEnvironment<string>("");
 createImmutableBinding<string>(source,"value",true);
 createImportBinding<string>(a,"a",source,"value");createImportBinding<string>(b,"b",a,"a");
 let value="";for(let i=0;i<100;i++)value=value+"x";
 initializeBinding<string>(source,"value",value);
 return b;
}
export function run():number{
 const source=createDeclarativeEnvironment<number>(0),target=createDeclarativeEnvironment<number>(0);
 createMutableBinding<number>(source,"value",true);createImportBinding<number>(target,"alias",source,"value");
 if(getBindingValue<number>(target,"alias").error!=="reference")return 60;
 if(setMutableBinding<number>(target,"alias",7,false)!=="type"||setMutableBinding<number>(target,"alias",7,true)!=="type")return 61;
 if(getBindingValue<number>(source,"value").error!=="reference")return 62;
 let caught=false;try{initializeBinding<number>(target,"alias",7);}catch(e){caught=e==="INITIALIZE_BINDING_INVARIANT";}
 if(!caught||deleteBinding<number>(target,"alias"))return 63;
 initializeBinding<number>(source,"value",19);if(getBindingValue<number>(target,"alias").value!==19)return 64;
 if(setMutableBinding<number>(source,"value",42,true)!=="none"||getBindingValue<number>(target,"alias").value!==42)return 65;
 const retained=retainedImport();
 for(let i=0;i<1024;i++){const data=new Uint32Array(8192);data[0]=i;if(data[0]!==i)return 66;}
 const read=getBindingValue<string>(retained,"b");if(read.error!=="none"||read.value.length!==100||read.value[0]!=="x"||read.value[99]!=="x")return 67;
 if(setMutableBinding<string>(retained,"b","bad",true)!=="type")return 68;
 return 42;
}`,
  "module-import-bindings",
  [["records", "packages/js-runtime/src/environments/records/index.ts"]],
);
