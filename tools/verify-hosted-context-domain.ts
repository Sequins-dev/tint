import { verifyHostedFixture } from "./hosted-fixture.ts";
const memory = "packages/native-runtime/src/intrinsics/memory.ts";
verifyHostedFixture(
  `import {currentContextDomain} from "memory";
export function run():number{
 const domain=currentContextDomain();
 if(!Number.isSafeInteger(domain)||domain<=0||domain%4096!==0)return 1;
 for(let i=0;i<1000;i++){const garbage=new Uint32Array(8192);garbage[0]=i;if(garbage[0]!==i||currentContextDomain()!==domain)return 2;}
 return 42;
}`,
  "context-domain",
  [["memory", memory]],
  [],
  [],
  [{ module: memory, namespace: "native-memory" }],
  {
    runtimeEntry: "initializeGenerationalRuntime",
    managedBytes: 1048576,
    allocationCapacity: 65536,
    hostBindings: [
      {
        module: memory,
        name: "currentContextDomain",
        operation: "context-domain",
      },
    ],
  },
);
