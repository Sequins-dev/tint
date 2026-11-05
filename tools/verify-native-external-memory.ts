import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `import {createExternalMemoryRegistry} from "tracing";
export function run():number {
 const storage=new Float64Array(5);
 const registry=createExternalMemoryRegistry(storage,new Float64Array([4096,256]));
 if(registry===undefined)return 1;
 if(registry.register(4096,8)||registry.register(4088,16))return 2;
 if(!registry.register(4352,16)||!registry.register(4368,16))return 3;
 if(!registry.contains(4352,16)||!registry.contains(4360,8))return 4;
 if(registry.contains(4360,16)||registry.contains(4384,1)||registry.contains(4352,0))return 5;
 if(!registry.register(4352,16)||registry.register(8192,16)||storage[0]!==2)return 6;
 const invalid=createExternalMemoryRegistry(new Float64Array([1,0,0]),new Float64Array(0));
 if(invalid!==undefined)return 7;
 const live:{value:number}[]=[];
 for(let i=0;i<200000;i++){
  live.push({value:i});
  if(live.length>64)live.shift();
 }
 if(live[live.length-1]?.value!==199999||!registry.contains(4360,8)||storage[0]!==2)return 8;
 return 42;
}`,
  "external-memory",
  [["tracing", "packages/native-runtime/src/tracing/index.ts"]],
);
